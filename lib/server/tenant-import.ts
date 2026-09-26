import {createHash} from 'node:crypto';
import type {Sql,TransactionSql,JSONValue} from 'postgres';
import {tenantIdentity,TenantConfigurationError} from './tenant-identity.ts';
import type {LegacyPhotoBundle,LegacyPhoto} from './legacy-photo-bundle.ts';
import {validateAsset} from './asset-content.ts';

type RecordData=Record<string,JSONValue>;
type Snapshot={company:string;business:RecordData;products:RecordData[];entries:RecordData[];movements:RecordData[]};
type Job={id:string;company_id:string;requested_by:string;correlation_id:string;status:string};
type ImportReport={source_digest:string;target_digest:string;counts:Record<string,number>;job_id:string;company:string};
type Query=Sql|TransactionSql;

/** JSON numbers never carry money/quantities: PostgreSQL exports those as exact decimals. */
async function snapshot(sql:Query,company:string):Promise<Snapshot> {
 const business=await sql<{data:RecordData}[]>`select to_jsonb(b) as data from public.business_units b where id=${company}`;
 if(business.length!==1)throw new TenantConfigurationError('SOURCE_MISSING','Cadastro empresarial ausente na origem.');
 const products=await sql<{data:RecordData}[]>`select to_jsonb(p)||jsonb_build_object('cost',cost::text,'price',price::text,'stock',stock::text,'min_stock',min_stock::text) as data from public.products p where business_id=${company} order by id`;
 const entries=await sql<{data:RecordData}[]>`select to_jsonb(e)||jsonb_build_object('amount',amount::text) as data from public.entries e where business_id=${company} order by id`;
 const movements=await sql<{data:RecordData}[]>`select to_jsonb(m)||jsonb_build_object('delta',delta::text,'balance',balance::text) as data from public.stock_movements m join public.products p on p.id=m.product_id where p.business_id=${company} order by m.id`;
 return {company,business:business[0].data,products:products.map(r=>r.data),entries:entries.map(r=>r.data),movements:movements.map(r=>r.data)};
}
function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
 return JSON.stringify(value);
}
function digest(value:unknown){return createHash('sha256').update(canonical(value)).digest('hex');}

/** RFC 9562 UUIDv5: stable IDs for defaults and opening records make retries deterministic. */
export function importId(namespace:string,name:string) {
 const input=Buffer.from(namespace.replaceAll('-',''),'hex');
 if(input.length!==16)throw new Error('Invalid import namespace');
 const bytes=createHash('sha1').update(input).update(name).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
 const hex=bytes.toString('hex');return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}

/** Operator-only copy. It requires an MFA-authorized cutover already frozen centrally. */
export async function importLegacyCompany(source:Sql,target:Sql,jobId:string,photoBundle?:LegacyPhotoBundle):Promise<ImportReport> {
 return source.begin('isolation level repeatable read',async origin=>{
  await origin`set local timezone='UTC'`;
  const jobs=await origin<Job[]>`select id,company_id,requested_by,correlation_id,status from erp_control.cutovers where id=${jobId}`;
  const job=jobs[0];if(!job||!['running','verified'].includes(job.status))throw new TenantConfigurationError('SOURCE_NOT_FROZEN','Solicite e inicie uma migração autorizada antes de copiar os dados.');
  const expected=tenantIdentity(job.company_id);
  const control=await origin`select data_location from erp_control.companies where id=${expected.company} for share`;
  if(control[0]?.data_location!=='migrating')throw new TenantConfigurationError('SOURCE_NOT_FROZEN','As gravações da origem precisam estar bloqueadas.');
  // Refuse an incomplete port if the shared v2 engine was used before this cutover.
  const operationalTables=await origin<{name:string}[]>`select table_name as name from information_schema.columns where table_schema='public' and table_name like 'erp_%' and column_name='business_id'`;
  for(const table of operationalTables)if((await origin`select exists(select 1 from ${origin('public.'+table.name)} where business_id=${expected.company}) as used`)[0].used)throw new TenantConfigurationError('UNSUPPORTED_SOURCE','A origem já possui cadastros ou operações v2; use um migrador completo desse esquema.');
  const data=await snapshot(origin,expected.company);
  const photoPaths=[...new Set(data.products.filter(p=>p.image_path!==null).map(p=>String(p.image_path)))].sort();
  const photos=photoBundle?[...photoBundle.photos].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0):[];
  if((photoBundle&&photoBundle.company!==expected.company)||digest(photoPaths)!==digest(photos.map(p=>p.name)))throw new TenantConfigurationError('ASSET_BUNDLE_REQUIRED','Forneça um pacote verificado com exatamente as fotos referenciadas por esta empresa.');
  // Preserve the digest format for previously reconciled companies without files.
  const counts={businesses:1,products:data.products.length,entries:data.entries.length,movements:data.movements.length,...(photos.length?{photos:photos.length}:{})};
  return target.begin(async destination=>{
   await destination`set local timezone='UTC'`;
   const marker=await destination`select company_id,database_name,operational_state from tenant.identity where singleton for update`;
   if(marker.length!==1||marker[0].company_id!==expected.company||marker[0].database_name!==expected.database||(await destination`select current_database() as name`)[0].name!==expected.database)throw new TenantConfigurationError('IDENTITY_MISMATCH','O banco de destino não corresponde à empresa.');
   const previous=await destination`select id,source_digest,target_digest,counts from tenant.reconciliations`;
   let importActor=job.requested_by;
   if(previous.length&&photos.length){
    const audit=await destination`select actor_id from tenant.audit where action='tenant.import' and entity=${job.id} and company_id=${expected.company}`;
    if(audit.length!==1)throw new TenantConfigurationError('RECONCILIATION_FAILED','Auditoria original da importação ausente ou divergente.');
    importActor=audit[0].actor_id;
   }
   const sourceDigest=digest(photos.length?{...data,photos:photos.map(p=>({...p,created_by:importActor}))}:data);
   if(previous.length) {
    if(previous.length!==1||previous[0].id!==job.id||previous[0].source_digest!==sourceDigest)throw new TenantConfigurationError('SOURCE_CHANGED','A origem mudou ou o destino pertence a outra migração. Não houve sobrescrita.');
    // Re-read the reviewed bundle on retry, detecting changed/missing bytes as well.
    for(const photo of photos)await readPhoto(photoBundle!,photo);
    const targetDigest=await targetSnapshotDigest(destination,expected.company,photos.length>0);
    if(targetDigest!==sourceDigest)throw new TenantConfigurationError('RECONCILIATION_FAILED','Os dados previamente copiados foram alterados. Não houve sobrescrita.');
    await verifyDerived(destination,expected.company);
    return {source_digest:sourceDigest,target_digest:targetDigest,counts,job_id:job.id,company:expected.company};
   }
   if(marker[0].operational_state!=='preparing')throw new TenantConfigurationError('TARGET_IN_USE','O destino não está em preparação.');
   if((await destination`select exists(select 1 from tenant.assets) or exists(select 1 from tenant.uploads) as present`)[0].present)throw new TenantConfigurationError('TARGET_IN_USE','O destino já contém arquivos; importação recusada.');
   // Only an empty destination can receive the first legacy copy.
   const tables=await destination<{name:string}[]>`select tablename as name from pg_tables where schemaname='public' order by tablename`;
   for(const table of tables) {
    const existing=await destination`select exists(select 1 from ${destination('public.'+table.name)}) as present`;
    if(existing[0].present)throw new TenantConfigurationError('TARGET_IN_USE','O destino já contém dados operacionais; importação recusada.');
   }
   const authors=new Set([String(data.business.owner_id),job.requested_by,...data.products.map(p=>String(p.owner_id)),...data.entries.map(e=>String(e.owner_id)),...data.movements.map(m=>String(m.owner_id))]);
   for(const author of authors)await destination`insert into tenant.actors(id) values(${author}) on conflict do nothing`;
   // One bounded file at a time, in the same transaction as its product references.
   // The ADM is the importer of the file; original product authors remain unchanged.
   for(const photo of photos){
    const bytes=await readPhoto(photoBundle!,photo);
    await destination`insert into tenant.assets(id,bucket_id,name,filename,mime,content,created_by) values(${importId(expected.company,'legacy/photo/'+photo.name)},'product-photos',${photo.name},${photo.filename},${photo.mime},${Buffer.from(bytes)},${job.requested_by})`;
    await destination`insert into tenant.uploads(bucket_id,name,size_bytes) values('product-photos',${photo.name},${photo.size_bytes})`;
   }
   await destination`insert into public.business_units select * from jsonb_populate_record(null::public.business_units,${destination.json(data.business)})`;
   // Batch size bounds statement/parameter size while preserving one transaction.
   for(const [table,records] of [['products',data.products],['entries',data.entries],['stock_movements',data.movements]] as const) {
    for(let i=0;i<records.length;i+=500) {
     const relation=destination('public.'+table);
     await destination`insert into ${relation} select * from jsonb_populate_recordset(null::${relation},${destination.json(records.slice(i,i+500))})`;
    }
   }
   const warehouse=importId(expected.company,'legacy/main-warehouse');
   await destination`insert into public.erp_warehouses(id,business_id,name) values(${warehouse},${expected.company},'Depósito principal')`;
   await destination`insert into public.erp_terms(id,business_id,name) values(${importId(expected.company,'legacy/cash-terms')},${expected.company},'À vista')`;
   if((await destination`select exists(select 1 from public.products where item_type='service' and stock<>0) as invalid`)[0].invalid)throw new TenantConfigurationError('RECONCILIATION_FAILED','Há serviços com estoque físico na origem. Corrija os registros antes de migrar.');
   await destination`insert into public.erp_balances(business_id,product_id,warehouse_id,quantity) select business_id,id,${warehouse},stock from public.products where item_type<>'service'`;
   // Old stock movements stay historical. Exactly one opening imports today's balance.
   for(const product of data.products) {
    await destination`insert into public.erp_stock_ledger(id,business_id,product_id,warehouse_id,delta,balance,kind,reason,actor_id)
     select ${importId(String(product.id),'legacy/opening')},business_id,id,${warehouse},stock,stock,'opening','Saldo conciliado na migração; histórico anterior não reaplicado.',${job.requested_by}
     from public.products where id=${String(product.id)} and item_type<>'service' and stock>0`;
   }
   const currencies=[...new Set(data.entries.map(e=>String(e.currency)))];
   for(const currency of currencies)await destination`insert into public.erp_accounts(id,business_id,name,currency) values(${importId(expected.company,'legacy/account/'+currency)},${expected.company},'Conta legada',${currency})`;
   await destination`insert into public.erp_titles(id,business_id,description,type,currency,amount,paid,competence_date,due_date,category,cancelled_at,legacy_id,created_at)
    select id,business_id,description,type,currency,amount,case when status='paid' and deleted_at is null then amount else 0 end,date,date,category,deleted_at,id,created_at from public.entries`;
   await destination`insert into public.erp_payments(id,business_id,title_id,account_id,amount,date,method,actor_id,reason,created_at)
    select e.id,e.business_id,e.id,a.id,e.amount,e.date,e.payment_method,e.owner_id,'Importação legada: data e autoria preservadas.',e.created_at from public.entries e join public.erp_accounts a on a.business_id=e.business_id and a.currency=e.currency where e.status='paid' and e.deleted_at is null`;
   await verifyDerived(destination,expected.company);
   const targetDigest=await targetSnapshotDigest(destination,expected.company,photos.length>0);
   if(targetDigest!==sourceDigest)throw new TenantConfigurationError('RECONCILIATION_FAILED','A cópia difere dos registros originais. A transação foi desfeita.');
   await destination`insert into tenant.reconciliations(id,source,source_digest,target_digest,counts) values(${job.id},'legacy',${sourceDigest},${targetDigest},${destination.json(counts)})`;
   await destination`insert into tenant.audit(actor_id,company_id,action,entity,after_data,result,correlation_id) values(${job.requested_by},${expected.company},'tenant.import',${job.id},${destination.json({counts,source_digest:sourceDigest})},'success',${job.correlation_id})`;
   return {source_digest:sourceDigest,target_digest:targetDigest,counts,job_id:job.id,company:expected.company};
  });
 });
}

async function readPhoto(bundle:LegacyPhotoBundle,photo:LegacyPhoto){
 try{
  const bytes=await bundle.read(photo);
  if(bytes.length!==photo.size_bytes||createHash('sha256').update(bytes).digest('hex')!==photo.sha256||validateAsset(bytes,'product-photos',photo.filename)!==photo.mime)throw new Error('invalid');
  return bytes;
 }catch{throw new TenantConfigurationError('ASSET_BUNDLE_INVALID','Foto ausente, inválida ou alterada no pacote de migração. A cópia foi desfeita.');}
}

async function targetSnapshotDigest(sql:TransactionSql,company:string,withPhotos:boolean){
 const data=await snapshot(sql,company);
 // Include every asset, not just referenced ones, to detect unexpected additions.
 const rows=await sql<{data:RecordData}[]>`select jsonb_build_object('name',name,'filename',filename,'mime',mime,'size_bytes',size_bytes,'sha256',sha256,'created_by',created_by) as data from tenant.assets`;
 const photos=rows.map(r=>r.data).sort((a,b)=>String(a.name)<String(b.name)?-1:String(a.name)>String(b.name)?1:0);
 return digest(withPhotos||photos.length?{...data,photos}:data);
}

async function verifyDerived(sql:TransactionSql,company:string) {
 const check=await sql`select
 exists(select 1 from public.products p where business_id=${company} and p.stock<>(select coalesce(sum(quantity),0) from public.erp_balances b where b.product_id=p.id)) as stock_mismatch,
 exists(select 1 from public.products p where business_id=${company} and p.stock<>(select coalesce(sum(delta),0) from public.erp_stock_ledger l where l.product_id=p.id)) or
 (select count(*) from public.erp_stock_ledger where business_id=${company})<>(select count(*) from public.products where business_id=${company} and stock>0) as ledger_mismatch,
 exists(select 1 from public.products p where business_id=${company} and image_path is not null and not exists(select 1 from tenant.uploads u join tenant.assets a on a.name=u.name and a.bucket_id=u.bucket_id and a.size_bytes=u.size_bytes where u.bucket_id='product-photos' and u.name=p.image_path)) as file_reference_mismatch,
 exists(select 1 from public.entries e left join public.erp_titles t on t.legacy_id=e.id where e.business_id=${company} and (t.id is null or t.amount<>e.amount or t.currency<>e.currency or t.type<>e.type or t.paid<>case when e.status='paid' and e.deleted_at is null then e.amount else 0 end or t.cancelled_at is distinct from e.deleted_at)) as title_mismatch,
 (select count(*) from public.erp_titles where business_id=${company})<>(select count(*) from public.entries where business_id=${company}) as title_count_mismatch,
 exists(select 1 from public.entries e where e.business_id=${company} and
  (select coalesce(sum(p.amount),0) from public.erp_payments p where p.title_id=e.id and p.reversed_at is null)<>case when e.status='paid' and e.deleted_at is null then e.amount else 0 end) as payment_mismatch,
 exists(select 1 from public.erp_payments p join public.entries e on e.id=p.title_id where p.business_id=${company} and (p.actor_id<>e.owner_id or p.date<>e.date or p.amount<>e.amount)) as authorship_mismatch`;
 if(Object.values(check[0]).some(Boolean))throw new TenantConfigurationError('RECONCILIATION_FAILED','Saldos, títulos, pagamentos ou autoria não conferem com a origem.');
}
