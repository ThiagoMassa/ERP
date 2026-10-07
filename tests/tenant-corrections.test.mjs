// Real isolated PostgreSQL databases. Administrative contexts are fixtures;
// this verifies the tenant transaction boundary, not central MFA or the HTTP flow.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import postgres from 'postgres';
import {provisionTenant,tenantMigrations} from '../lib/server/tenant-database.ts';
import {tenantIdentity,tenantConnectionOptions} from '../lib/server/tenant-identity.ts';
const password=await readFile(new URL('../work/pg-test-password',import.meta.url),'utf8');
const base={host:'127.0.0.1',port:55439,username:'erp_test_admin',password,ssl:false,max:1,prepare:false,onnotice:()=>{},connect_timeout:5};
const admin=postgres({...base,database:'postgres'}),ids=[randomUUID(),randomUUID()],fixtures=ids.map(tenantIdentity),secrets=ids.map(()=>randomBytes(36).toString('base64url')),opened=[];
const permissions=Object.fromEntries(['overview','sales','purchases','catalog','stock','finance','production','settings'].map(m=>[m,Object.fromEntries(['available','visible','read','create','edit','delete','approve','cancel','reverse','export'].map(a=>[a,{allowed:true}]))]));
const author=randomUUID(),adm=randomUUID();
try{
 assert.equal((await admin`select current_user as name`)[0].name,'erp_test_admin');
 const maintenance=[],runtime=[];
 const options=i=>tenantConnectionOptions(`postgres://${fixtures[i].runtime}:${secrets[i]}@127.0.0.1:55439/${fixtures[i].database}`,ids[i],{allowLocalTest:true});
 for(let i=0;i<2;i++){
  await provisionTenant({companyId:ids[i],runtimePassword:secrets[i],maintenance:admin,connectMaintenanceDatabase:database=>postgres({...base,database}),migrations:await tenantMigrations()});
  const db=postgres({...base,database:fixtures[i].database}),app=postgres(options(i));maintenance.push(db);runtime.push(app);opened.push(db,app);
  await db`insert into tenant.actors(id) values(${author})`;
  await db`insert into public.business_units(id,owner_id,name,model) values(${ids[i]},${author},'Correções de catálogo','printing')`;
  await db`insert into public.erp_warehouses(business_id,name) values(${ids[i]},'Principal')`;
  await db`update tenant.identity set operational_state='active'`;
 }
 const context=(i=0,user=adm)=>({company:ids[i],actor:user,epoch:'00000000-0000-0000-0000-000000000000',expires_at:new Date(Date.now()+25000).toISOString(),permissions,administrative:true,admin_action:'admin.product.correct'});
 const call=async(operation,data,key=randomUUID(),ctx=context(),sql=runtime[0],mode='command')=>(await sql`select tenant.dispatch(${sql.json(ctx)},${mode},${operation},${sql.json(data)},${key}) as data`)[0].data;
 const productData={name:'Peça original',category:'Impressão',item_type:'finished',unit:'un',currency:'BRL',cost:10.25,price:23.90,stock:0};
 const product=await call('product.save',productData,randomUUID(),context(0,author));
 const db=maintenance[0];
 const get=async()=> (await db`select * from public.products where id=${product.id}`)[0];
 const before=await get();assert.equal(before.record_version,1);
 const data={id:product.id,version:1,patch:{name:'Peça revisada',description:'Contorno descrito corretamente'},reason:'Correção da descrição comercial cadastrada.'},key=randomUUID();
 const result=await call('admin.product.correct',data,key);assert.equal(result.version,2);
 const after=await get();
 for(const field of ['owner_id','cost','price','stock','currency','unit','item_type','business_id','created_at'])assert.deepEqual(after[field],before[field]);
 assert.equal(after.name,'Peça revisada');
 const audit=async()=>await db`select * from tenant.audit where action='admin.product.correct'`;
 const events=await audit();assert.equal(events.length,1);assert.equal(events[0].actor_id,adm);assert.equal(events[0].subject_id,author);assert.equal(events[0].reason,data.reason);assert.equal(events[0].before_data.name,before.name);assert.equal(events[0].after_data.name,after.name);assert.equal(events[0].correlation_id,key);
 assert.deepEqual(await call('admin.product.correct',data,key),result);assert.equal((await audit()).length,1);
 await assert.rejects(call('admin.product.correct',{...data,patch:{name:'Outro'}},key),/outra correção/);
 await assert.rejects(call('admin.product.correct',data,randomUUID()),e=>e.code==='40001');
 for(const patch of [{cost:9},{stock:2},{owner_id:adm},{price:30},{name:''},{name:null},{category:'  '},{description:'x'.repeat(2001)},{sku:42},{}])await assert.rejects(call('admin.product.correct',{...data,version:2,patch}));
 for(const overrides of [{reason:'curto'},{version:null},{version:0},{extra:true},{id:randomUUID()}])await assert.rejects(call('admin.product.correct',{...data,version:2,...overrides}));
 for(const ctx of [{...context(),administrative:false},{...context(),admin_action:'product.save'},{...context(),expires_at:new Date(Date.now()-1000).toISOString()},{...context(),epoch:randomUUID()},context(1)])await assert.rejects(call('admin.product.correct',data,key,ctx),e=>e.code==='42501'||e.code==='28000');
 for(const mode of ['read',null])await assert.rejects(call('admin.product.correct',data,key,context(),runtime[0],mode),e=>e.code==='42501');
 const denied=structuredClone(context());denied.permissions.catalog.edit.allowed=false;
 await assert.rejects(call('admin.product.correct',data,key,denied),e=>e.code==='42501');
 await assert.rejects(call('admin.product.correct',data,key,context(1),runtime[1]),/não encontrado/);
 assert.equal((await get()).record_version,2);assert.equal((await audit()).length,1);
 // Ordinary ERP editing also invalidates the version held by an administrator.
 await call('product.save',{...productData,id:product.id,name:'Edição empresarial'},randomUUID(),context(0,author));
 assert.equal((await get()).record_version,3);
 await assert.rejects(call('admin.product.correct',{...data,version:2}),e=>e.code==='40001');
 // Different request IDs still serialize on the same row and cannot both win.
 const peer=postgres(options(0));opened.push(peer);
 const concurrent=await Promise.allSettled([runtime[0],peer].map((sql,i)=>call('admin.product.correct',{...data,version:3,patch:{name:'Concorrente '+i}},randomUUID(),context(),sql)));
 assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(concurrent.find(r=>r.status==='rejected').reason.code,'40001');
 assert.equal((await get()).record_version,4);assert.equal((await audit()).length,2);
 // A failure while writing the audit rolls back the product and retry receipt.
 await db.unsafe("create function tenant.reject_correction_audit() returns trigger language plpgsql as $$begin if new.action='admin.product.correct' then raise exception 'fixture audit failure';end if;return new;end$$;create trigger reject_correction_audit before insert on tenant.audit for each row execute function tenant.reject_correction_audit()");
 const rollbackKey=randomUUID(),rollbackBefore=await get();
 await assert.rejects(call('admin.product.correct',{...data,version:4},rollbackKey),/fixture audit failure/);
 assert.deepEqual(await get(),rollbackBefore);assert.equal((await db`select count(*)::int n from tenant.admin_requests where id=${rollbackKey}`)[0].n,0);
 await db.unsafe('drop trigger reject_correction_audit on tenant.audit;drop function tenant.reject_correction_audit()');
 const scoped={...context(),permissions:{catalog:{available:{allowed:true},edit:{allowed:true}}}};
 assert.equal((await call('admin.product.correct',{...data,version:4},rollbackKey,scoped)).version,5);
 // The administrative history combines ERP and tenant events without rounding bigint IDs.
 const today=new Date().toISOString().slice(0,10),readCorrelation=randomUUID();
 const historyContext=()=>({...context(),administrative_read:true,admin_read_operation:'record_history',read_correlation:readCorrelation});
 const history=async(filters={},ctx=historyContext(),sql=runtime[0])=>call('record_history',{id:product.id,start:today,end:today,...filters},null,ctx,sql,'read');
 await db`insert into tenant.audit(id,actor_id,company_id,action,entity,subject_id,result) overriding system value select 9007199254740993+n,${adm},${ids[0]},'test.history',${product.id},${author},'success' from generate_series(1,24) n`;
 await db`insert into public.erp_audit(business_id,actor_id,action,entity_id,detail) select ${ids[0]},${author},'test.history',${product.id},jsonb_build_object('reason','Evento operacional existente') from generate_series(1,2)`;
 const first=await history({action:'test.history',size:20});assert.equal(first.rows.length,20);assert.ok(first.next_cursor);assert.equal(first.company,ids[0]);assert.equal(first.entity,product.id);
 assert.equal(typeof first.rows.find(row=>row.source==='tenant').id,'string');assert.ok(first.rows.some(row=>BigInt(row.source==='tenant'?row.id:'0')>9007199254740991n));
 await db`insert into tenant.audit(actor_id,company_id,action,entity,result) values(${adm},${ids[0]},'test.history',${product.id},'success')`;
 const second=await history({action:'test.history',size:20,upper:first.upper,cursor:first.next_cursor});assert.equal(second.rows.length,6);assert.equal(second.next_cursor,null);assert.equal(new Set([...first.rows,...second.rows].map(row=>row.audit_key)).size,26);
 const authorHistory=await history({actor:author,action:'test.history'});assert.equal(authorHistory.rows.length,2);assert.ok(authorHistory.rows.every(row=>row.source==='erp'&&row.before_data===null&&row.after_data===null));
 const subjectHistory=await history({subject:author,action:'test.history',size:50});assert.equal(subjectHistory.rows.length,24);
 const corrections=await history({action:'admin.product.correct'});assert.equal(corrections.rows.length,3);assert.ok(corrections.rows.every(row=>row.subject_id===author&&row.actor_id===adm&&row.reason===data.reason&&row.before_data&&row.after_data));
 assert.equal((await db`select count(*)::int n from tenant.audit where action='record.history' and correlation_id=${readCorrelation}`)[0].n,5);
 await assert.rejects(history({},context()),e=>e.code==='42501');
 await assert.rejects(history({}, {...historyContext(),admin_read_operation:'products'}),e=>e.code==='42501');
 await assert.rejects(history({size:51}));await assert.rejects(history({end:'2030-01-01'}));
 await assert.rejects(history({}, {...historyContext(),company:ids[1]}),e=>e.code==='42501');
 assert.equal((await history({}, {...historyContext(),company:ids[1]},runtime[1])).rows.length,0);
 for(const statement of ['select * from tenant.admin_requests',"update public.products set name='forged'","delete from tenant.audit","select tenant.dispatch_before_corrections('{}','read','products','{}',null)"])await assert.rejects(runtime[0].unsafe(statement),e=>e.code==='42501');
 // Administrative lifecycle delegates to ordinary ERP integrity rules, with version/audit.
 const item=await call('product.save',{...productData,name:'Produto para inativação'});
 const current=async()=>(await db`select * from public.products where id=${item.id}`)[0];
 const lifecycle=(op,version,key=randomUUID(),ctx)=>call(op,{id:item.id,version,reason:'Revisão administrativa da situação do catálogo'},key,ctx||{...context(),admin_action:op});
 const warehouse=(await db`select id from public.erp_warehouses limit 1`)[0].id;
 await call('stock.adjust',{product_id:item.id,warehouse_id:warehouse,quantity:5,reason:'Entrada para ensaio de integridade'});
 await assert.rejects(lifecycle('admin.product.archive',(await current()).record_version),/Conclua os pedidos/);
 assert.equal((await current()).deleted_at,null);
 await call('stock.adjust',{product_id:item.id,warehouse_id:warehouse,quantity:-5,reason:'Saída para ensaio de integridade'});
 const partner=await call('partner.save',{name:'Cliente do ensaio',customer:true,supplier:false});
 const order=await call('order.save',{kind:'sale',partner_id:partner.id,currency:'BRL',date:today,due_date:today,installments:1,interval_days:30,items:[{product_id:item.id,quantity:1,price:20,discount:0}]});
 await assert.rejects(lifecycle('admin.product.archive',(await current()).record_version),/Conclua os pedidos/);
 await call('order.cancel',{id:order.id,reason:'Cancelamento do pedido de ensaio'});
 const printer=(await db`insert into public.erp_printers(business_id,name,model) values(${ids[0]},'Impressora do ensaio','A1') returning id`)[0].id;
 const spool=(await db`insert into public.erp_spools(business_id,product_id,warehouse_id,name,remaining_g,cost_kg) values(${ids[0]},${item.id},${warehouse},'Bobina do ensaio',1000,10) returning id`)[0].id;
 const job=(await db`insert into public.erp_print_jobs(business_id,name,product_id,printer_id,spool_id,quantity,estimated_g,estimated_hours,estimated_cost,kwh_price,watts,hourly_cost,cost_kg,due_date) values(${ids[0]},'Produção pendente',${item.id},${printer},${spool},1,10,1,1,1,100,0,10,current_date) returning id`)[0].id;
 await assert.rejects(lifecycle('admin.product.archive',(await current()).record_version),/Conclua os pedidos/);
 await db`update public.erp_print_jobs set status='cancelled' where id=${job}`;
 const initial=await current(),archiveKey=randomUUID(),version=initial.record_version;
 await assert.rejects(lifecycle('admin.product.archive',version,archiveKey,context()),e=>e.code==='42501');
 const archived=await lifecycle('admin.product.archive',version,archiveKey);
 assert.ok((await current()).deleted_at);
 assert.ok((await call('products',{status:'archived'},null,context(),runtime[0],'read')).rows.some(r=>r.id===item.id));
 assert.ok(!(await call('products',{status:'active'},null,context(),runtime[0],'read')).rows.some(r=>r.id===item.id));
 assert.deepEqual(await lifecycle('admin.product.archive',version,archiveKey),archived);
 assert.equal((await db`select count(*)::int n from tenant.audit where correlation_id=${archiveKey}`)[0].n,1);
 await assert.rejects(lifecycle('admin.product.restore',version),e=>e.code==='40001');
 const deniedStatus={...context(),admin_action:'admin.product.archive',permissions:{catalog:{available:{allowed:false},delete:{allowed:true}}}};
 await assert.rejects(lifecycle('admin.product.archive',version,archiveKey,deniedStatus),e=>e.code==='42501');
 const restored=await lifecycle('admin.product.restore',archived.version);
 const final=await current();assert.equal(final.deleted_at,null);assert.equal(final.record_version,restored.version);
 for(const field of ['owner_id','cost','price','stock','currency','unit','item_type','business_id','created_at'])assert.deepEqual(final[field],initial[field]);
 const statusAudit=await db`select * from tenant.audit where entity=${item.id} and action like 'admin.product.%' order by id`;
 assert.equal(statusAudit.length,2);assert.ok(statusAudit.every(e=>e.actor_id===adm&&e.subject_id===author&&e.reason.length>=10));
 assert.equal(statusAudit[0].before_data.deleted_at,null);assert.ok(statusAudit[0].after_data.deleted_at);
 assert.ok(statusAudit[1].before_data.deleted_at);assert.equal(statusAudit[1].after_data.deleted_at,null);
 // Audit failure rolls back the core command, both receipts and the product update.
 await db.unsafe("create function tenant.reject_status_audit() returns trigger language plpgsql as $$begin if new.action='admin.product.archive' then raise exception 'fixture status audit failure';end if;return new;end$$;create trigger reject_status_audit before insert on tenant.audit for each row execute function tenant.reject_status_audit()");
 const failedKey=randomUUID();await assert.rejects(lifecycle('admin.product.archive',restored.version,failedKey),/fixture status audit failure/);
 assert.deepEqual(await current(),final);
 assert.equal((await db`select count(*)::int n from erp_private.requests where key=${failedKey}`)[0].n,0);
 await db.unsafe('drop trigger reject_status_audit on tenant.audit;drop function tenant.reject_status_audit()');
 const statusConcurrent=await Promise.allSettled([runtime[0],peer].map(sql=>call('admin.product.archive',{id:item.id,version:restored.version,reason:'Inativação administrativa concorrente'},randomUUID(),{...context(),admin_action:'admin.product.archive'},sql)));
 assert.equal(statusConcurrent.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(statusConcurrent.find(r=>r.status==='rejected').reason.code,'40001');
 // Administrative search filters the full dataset, not just the current page.
 const search=async(operation,filters={},overrides={},sql=runtime[0])=>call(operation,filters,null,{...context(),administrative_read:true,admin_read_operation:operation,read_correlation:readCorrelation,...overrides},sql,'read');
 const allProducts=await search('products',{start:today,end:today,size:50});
 assert.ok(allProducts.rows.some(r=>r.id===product.id));
 assert.equal((await search('products',{id:product.id})).count,1);
 assert.equal((await search('products',{id:randomUUID()})).count,0);
 assert.equal((await search('products',{id:product.id,actor:adm})).count,1);
 assert.equal((await search('products',{id:product.id,actor:author})).count,1);
 assert.equal((await search('products',{id:product.id,actor:randomUUID()})).count,0);
 assert.equal((await search('products',{id:product.id,start:'2000-01-01',end:'2000-01-01'})).count,0);
 const secondPage=await search('products',{size:1,page:1});
 assert.equal(secondPage.count,allProducts.count);assert.ok(secondPage.rows.length<=1);
 assert.equal((await search('products',{id:item.id,status:'archived'})).count,1);
 assert.equal((await search('products',{id:item.id,status:'active'})).count,0);
 for(const operation of ['partners','orders','titles','stock','movements','jobs','spools','printers','recipes']){
  const response=await search(operation,{size:1});assert.ok(Array.isArray(response.rows));
  assert.equal((await search(operation,{id:randomUUID(),actor:randomUUID(),start:today,end:today})).count,0);
 }
 assert.ok((await search('movements',{actor:adm,query:'Entrada para ensaio',currency:'BRL'})).count>0);
 assert.equal((await search('movements',{actor:adm,query:'Entrada para ensaio',currency:'USD'})).count,0);
 assert.equal((await search('products',{id:product.id},{...context(1),administrative_read:true},runtime[1])).count,0);
 await assert.rejects(search('products',{}, {admin_read_operation:'titles'}),e=>e.code==='42501');
 const noRead=structuredClone(permissions);noRead.catalog.read.allowed=false;
 await assert.rejects(search('products',{}, {permissions:noRead}),e=>e.code==='42501');
 for(const filters of [{size:51},{start:today},{page:-1},{actor:'invalid'},{start:'2000-01-01',end:'2050-01-01'}])await assert.rejects(search('products',filters));
 assert.ok((await db`select count(*)::int n from tenant.audit where action='records.read' and correlation_id=${readCorrelation}`)[0].n>0);
 await db`update tenant.identity set operational_state='maintenance'`;
 await assert.rejects(call('admin.product.correct',data,key),e=>e.code==='55000');
 assert.equal((await maintenance[1]`select count(*)::int n from public.products`)[0].n,0);
 console.log('PASS: correção de metadados com autoria preservada, auditoria antes/depois, concorrência real, repetição idempotente, permissões antes da repetição, rollback integral e isolamento entre bancos. Contextos administrativos simulados; sem validação central/MFA.');
}finally{
 await Promise.all(opened.map(sql=>sql.end({timeout:1})));
 for(const f of fixtures){await admin.unsafe(`drop database if exists "${f.database}" with (force)`);await admin.unsafe(`drop role if exists "${f.runtime}"`);await admin.unsafe(`drop role if exists "${f.owner}"`);}
 await admin.end({timeout:1});
}
