// Operator-only: never import maintenance credentials or native utilities into a web route.
import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,lstat,readFile,writeFile,rename,unlink,rmdir,open} from 'node:fs/promises';
import {basename,isAbsolute,join,resolve,relative} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {Sql,TransactionSql} from 'postgres';
import {z} from 'zod';
import {tenantIdentity,TenantConfigurationError} from './tenant-identity.ts';
import {tenantMigrations} from './tenant-database.ts';

const hashSchema=z.string().regex(/^[a-f0-9]{64}$/);
const tableSchema=z.object({schema:z.enum(['public','tenant','erp_private']),name:z.string(),rows:z.number().int().nonnegative(),digest:hashSchema}).strict();
const manifestSchema=z.object({version:z.literal(1),id:z.string().uuid(),company:z.string().uuid(),database:z.string(),created_at:z.string().datetime(),retention_until:z.string().datetime(),verified_at:z.string().datetime().nullable(),key_id:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),iv:z.string().regex(/^[a-f0-9]{24}$/),tag:z.string().regex(/^[a-f0-9]{32}$/),bytes:z.number().int().positive(),sha256:hashSchema,tables:z.array(tableSchema).min(1),schema_digest:hashSchema,mac:hashSchema}).strict();
export type BackupManifest=z.infer<typeof manifestSchema>;
export type BackupKey={id:string;value:Buffer};
export type PgTools={dump:string;restore:string};
export type PgConnection={host:string;port:number;username:string;password:string;sslRootCert?:string;allowLocalTest?:boolean};
type Store={directory:string;key:BackupKey};
type Snapshot={tables:BackupManifest['tables'];schema_digest:string};
type BackupOptions=Store&{company:string;id?:string;source:Sql;connection:PgConnection;tools:PgTools;retentionDays:number;maxBytes?:number};
type RecoveryOptions=Store&{company:string;backup:string;maintenance:Sql;connectMaintenanceDatabase:(database:string)=>Sql;connection:PgConnection;tools:PgTools};
const fail=(code:string,message:string)=>new TenantConfigurationError(code,message);
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
 return JSON.stringify(value);
}
function keyCheck(key:BackupKey){if(key.value.length!==32||!/^[A-Za-z0-9_-]{1,64}$/.test(key.id))throw fail('BACKUP_KEY','Configure uma chave de backup de 32 bytes e seu identificador de rotação.');}
function signature(body:Omit<BackupManifest,'mac'>,key:BackupKey){return createHmac('sha256',key.value).update('fluxo/backup-manifest/v1\0').update(canonical(body)).digest('hex');}
function authenticatedData(m:Pick<BackupManifest,'id'|'company'|'database'>){return Buffer.from(canonical({version:1,id:m.id,company:m.company,database:m.database}));}
async function location(directory:string,id:string){
 if(!isAbsolute(directory)||!z.string().uuid().safeParse(id).success)throw fail('BACKUP_PATH','Diretório privado ou identificador de backup inválido.');
 const root=resolve(directory),publicRoot=resolve(process.cwd(),'public');
 if(root===publicRoot||(!relative(publicRoot,root).startsWith('..')&&!isAbsolute(relative(publicRoot,root))))throw fail('BACKUP_PATH','Backups não podem ser armazenados no diretório público.');
 await mkdir(root,{recursive:true,mode:0o700});
 if((await lstat(root)).isSymbolicLink())throw fail('BACKUP_PATH','O diretório de backup não pode ser um link.');
 const folder=join(root,id.toLowerCase());
 if(relative(root,folder)!==id.toLowerCase())throw fail('BACKUP_PATH','Caminho de backup inválido.');
 return {folder,archive:join(folder,'archive.enc'),manifest:join(folder,'manifest.json')};
}
function toolEnvironment(connection:PgConnection,database:string){
 const local=connection.allowLocalTest===true&&['127.0.0.1','::1'].includes(connection.host);
 if(!connection.host||!connection.username||!connection.password||!Number.isInteger(connection.port)||connection.port<1||connection.port>65535)throw fail('BACKUP_CONNECTION','Conexão de manutenção inválida.');
 // Do not inherit unrelated application secrets or PGOPTIONS/PGSERVICE overrides.
 return {NODE_ENV:process.env.NODE_ENV||'production',SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:process.env.TEMP,TMP:process.env.TMP,HOME:process.env.HOME,
  PGHOST:connection.host,PGPORT:String(connection.port),PGUSER:connection.username,PGPASSWORD:connection.password,PGDATABASE:database,
  PGSSLMODE:local?'disable':'verify-full',...(connection.sslRootCert?{PGSSLROOTCERT:connection.sslRootCert}:{}),
  PGCONNECT_TIMEOUT:'10',PGAPPNAME:'fluxo-backup-operator',PGCLIENTENCODING:'UTF8',PGOPTIONS:'-c statement_timeout=0 -c lock_timeout=15000'};
}
function nativeTool(binary:string,kind:'pg_dump'|'pg_restore',args:string[],environment:NodeJS.ProcessEnv){
 if(!isAbsolute(binary)||![kind,kind+'.exe'].includes(basename(binary)))throw fail('BACKUP_TOOL','Configure os executáveis oficiais do PostgreSQL por caminho absoluto.');
 const child=spawn(binary,args,{env:environment,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
 // Native diagnostics can contain user records/SQL. Never forward them to logs or API responses.
 child.stderr.resume();
 const timer=setTimeout(()=>child.kill(),15*60*1000);
 const done=new Promise<void>((yes,no)=>{child.once('error',()=>no(fail('BACKUP_TOOL',`Não foi possível iniciar ${kind}.`)));child.once('close',code=>{clearTimeout(timer);if(code===0)yes();else no(fail('BACKUP_TOOL',`${kind} não concluiu a operação. Confira conectividade, versão e privilégios.`));});});
 return {child,done};
}
async function fingerprint(sql:TransactionSql):Promise<Snapshot>{
 await sql`set local timezone='UTC'`;await sql`set local search_path=''`;
 const list=await sql<{schema:'public'|'tenant'|'erp_private';name:string}[]>`select schemaname as schema,tablename as name from pg_tables where schemaname in ('public','tenant','erp_private') order by schemaname collate "C",tablename collate "C"`;
 const tables:BackupManifest['tables']=[];
 for(const table of list){
  const digest=createHash('sha256');let count=0;
  for await(const batch of sql`select to_jsonb(t)::text as value from ${sql(table.schema+'.'+table.name)} t order by (to_jsonb(t)::text) collate "C"`.cursor(200)){
   for(const row of batch){digest.update(row.value).update('\n');count++;}
  }
  tables.push({...table,rows:count,digest:digest.digest('hex')});
 }
 const definitions=await sql<{definition:string}[]>`select pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','tenant','erp_private') and p.prokind in ('f','p') order by (p.oid::regprocedure::text) collate "C"`;
 const digest=createHash('sha256');for(const fn of definitions)digest.update(fn.definition).update('\n');
 return {tables,schema_digest:digest.digest('hex')};
}
async function validateSource(sql:TransactionSql,company:string){
 const identity=tenantIdentity(company);
 const info=await sql`select i.company_id,i.database_name,i.runtime_role,current_database() as actual,pg_get_userbyid(d.datdba) as owner from tenant.identity i join pg_database d on d.datname=current_database() where singleton`;
 if(info.length!==1||info[0].company_id!==identity.company||info[0].database_name!==identity.database||info[0].actual!==identity.database||info[0].owner!==identity.owner||info[0].runtime_role!==identity.runtime)throw fail('IDENTITY_MISMATCH','O banco não corresponde à empresa selecionada para backup.');
 const unknown=await sql`select 1 from pg_namespace where nspname not in ('public','tenant','erp_private','information_schema') and nspname not like 'pg_%' limit 1`;
 if(unknown.length)throw fail('BACKUP_SCHEMA','O banco possui esquemas adicionais; revise o escopo antes do backup.');
 if((await sql`select exists(select 1 from pg_largeobject_metadata) as present`)[0].present)throw fail('BACKUP_SCHEMA','O banco possui objetos binários fora do esquema do ERP; revise o escopo antes do backup.');
 const required=await tenantMigrations(),installed=await sql`select version,checksum from tenant.migrations`;
 if(required.length!==installed.length||required.some(m=>!installed.some(r=>r.version===m.version&&r.checksum===m.checksum)))throw fail('MIGRATION_PENDING','Backup exige o pacote de migrações correspondente ao banco.');
 return identity;
}
async function saveManifest(path:string,body:Omit<BackupManifest,'mac'>,key:BackupKey){
 const manifest={...body,mac:signature(body,key)};
 await writeFile(path+'.tmp',JSON.stringify(manifest),{encoding:'utf8',flag:'wx',mode:0o600});
 const file=await open(path+'.tmp','r+');try{await file.sync();}finally{await file.close();}
 await rename(path+'.tmp',path);return manifest;
}

/** Produces encrypted bytes, then atomically publishes an authenticated manifest. */
export async function createTenantBackup(options:BackupOptions):Promise<BackupManifest>{
 keyCheck(options.key);
 if(!Number.isInteger(options.retentionDays)||options.retentionDays<1||options.retentionDays>3650)throw fail('BACKUP_RETENTION','Retenção deve ser de 1 a 3650 dias.');
 const maxBytes=options.maxBytes??2*1024**3;if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw fail('BACKUP_SIZE','Limite de backup inválido.');
 const id=options.id??randomUUID(),paths=await location(options.directory,id);
 try{await mkdir(paths.folder,{mode:0o700});}catch(error){
  if(error instanceof Error&&'code' in error&&error.code==='EEXIST')return inspectBackup({...options,backup:id});
  throw error;
 }
 try{return await options.source.begin('isolation level repeatable read read only',async sql=>{
  const identity=await validateSource(sql,options.company);
  const snapshot=(await sql`select pg_export_snapshot() as id`)[0].id;
  const inventory=await fingerprint(sql),created=new Date(),iv=randomBytes(12);
  const fields={version:1 as const,id,company:identity.company,database:identity.database,created_at:created.toISOString(),retention_until:new Date(created.getTime()+options.retentionDays*86400000).toISOString(),verified_at:null,key_id:options.key.id,iv:iv.toString('hex')};
  const cipher=createCipheriv('aes-256-gcm',options.key.value,iv);cipher.setAAD(authenticatedData(fields));
  const hash=createHash('sha256');let bytes=0;
  const meter=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;if(bytes>maxBytes)return callback(fail('BACKUP_SIZE','Backup excede o limite configurado.'));hash.update(chunk);callback(null,chunk);}});
  const dump=nativeTool(options.tools.dump,'pg_dump',['--no-password','--format=custom','--schema=public','--schema=tenant','--schema=erp_private','--strict-names','--no-publications','--no-subscriptions','--no-security-labels','--no-tablespaces','--lock-wait-timeout=15000',`--snapshot=${snapshot}`],toolEnvironment(options.connection,identity.database));
  dump.child.stdin.end();
  try{await Promise.all([dump.done,pipeline(dump.child.stdout,cipher,meter,createWriteStream(paths.archive,{flags:'wx',mode:0o600}))]);}
  finally{if(dump.child.exitCode===null)dump.child.kill();}
  const archive=await open(paths.archive,'r+');try{await archive.sync();}finally{await archive.close();}
  return saveManifest(paths.manifest,{...fields,...inventory,bytes,sha256:hash.digest('hex'),tag:cipher.getAuthTag().toString('hex')},options.key);
 });}catch(error){
  // Exact paths created by this call only. No recursive deletion or caller-supplied filenames.
  for(const path of [paths.archive,paths.manifest+'.tmp',paths.manifest])await unlink(path).catch(()=>{});
  await rmdir(paths.folder).catch(()=>{});throw error;
 }
}

export async function inspectBackup(options:Store&{company:string;backup:string}):Promise<BackupManifest>{
 keyCheck(options.key);const paths=await location(options.directory,options.backup);
 if((await lstat(paths.folder)).isSymbolicLink()||(await lstat(paths.manifest)).isSymbolicLink()||(await lstat(paths.archive)).isSymbolicLink())throw fail('BACKUP_PATH','O backup não pode conter links.');
 if((await lstat(paths.manifest)).size>1024*1024)throw fail('BACKUP_MANIFEST','Manifesto de backup inválido.');
 const parsed=manifestSchema.safeParse(JSON.parse(await readFile(paths.manifest,'utf8')));if(!parsed.success)throw fail('BACKUP_MANIFEST','Manifesto de backup inválido.');
 const {mac,...body}=parsed.data,identity=tenantIdentity(options.company);
 if(body.key_id!==options.key.id||!timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(signature(body,options.key),'hex')))throw fail('BACKUP_AUTHENTICATION','A assinatura do backup não confere com a chave selecionada.');
 if(body.company!==identity.company||body.database!==identity.database||body.id!==options.backup.toLowerCase())throw fail('IDENTITY_MISMATCH','Este backup pertence a outra empresa ou solicitação.');
 const hash=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(paths.archive)){bytes+=chunk.length;hash.update(chunk);}
 if(bytes!==body.bytes||hash.digest('hex')!==body.sha256)throw fail('BACKUP_INTEGRITY','O arquivo de backup está incompleto ou foi alterado.');
 return parsed.data;
}

/** Real recovery drill in a newly created private DB. Never overwrites a running company. */
export async function verifyTenantRecovery(options:RecoveryOptions):Promise<BackupManifest>{
 const manifest=await inspectBackup(options),identity=tenantIdentity(options.company),paths=await location(options.directory,options.backup);
 const recoveryDatabase='erp_verify_'+manifest.id.replaceAll('-','')+'_'+randomBytes(4).toString('hex');
 let created=false,target:Sql|undefined;
 try{
  await options.maintenance.unsafe(`create database ${quote(recoveryDatabase)} owner ${quote(identity.owner)} template template0 encoding 'UTF8' allow_connections false`);created=true;
  await options.maintenance.unsafe(`revoke all on database ${quote(recoveryDatabase)} from public`);
  await options.maintenance.unsafe(`alter database ${quote(recoveryDatabase)} allow_connections true`);
  target=options.connectMaintenanceDatabase(recoveryDatabase);
  // Verify the connection factory actually reached the new, empty DB before restoring.
  const actual=await target`select current_database() as name,pg_get_userbyid(datdba) as owner from pg_database where datname=current_database()`;
  const occupied=await target`select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','tenant','erp_private') limit 1`;
  if(actual[0]?.name!==recoveryDatabase||actual[0]?.owner!==identity.owner||occupied.length)throw fail('IDENTITY_MISMATCH','Destino de recuperação não é o banco temporário vazio autorizado.');
  // pg_dump --schema=public includes CREATE SCHEMA; remove only the empty default.
  await target.begin(async sql=>{await sql.unsafe(`set local role ${quote(identity.owner)}`);await sql.unsafe('drop schema public');});
  const restore=nativeTool(options.tools.restore,'pg_restore',['--no-password','--exit-on-error','--single-transaction','--no-owner','--no-privileges',`--role=${identity.owner}`,`--dbname=${recoveryDatabase}`],toolEnvironment(options.connection,recoveryDatabase));
  restore.child.stdout.resume();
  const decipher=createDecipheriv('aes-256-gcm',options.key.value,Buffer.from(manifest.iv,'hex'));decipher.setAAD(authenticatedData(manifest));decipher.setAuthTag(Buffer.from(manifest.tag,'hex'));
  try{await Promise.all([restore.done,pipeline(createReadStream(paths.archive),decipher,restore.child.stdin)]);}
  finally{if(restore.child.exitCode===null)restore.child.kill();}
  const restored=await target.begin('isolation level repeatable read read only',fingerprint);
  if(canonical(restored.tables)!==canonical(manifest.tables)||restored.schema_digest!==manifest.schema_digest)throw fail('BACKUP_RECONCILIATION','A recuperação diverge dos registros ou rotinas da cópia original.');
  const {mac:ignored,...body}=manifest;void ignored;
  return await saveManifest(paths.manifest,{...body,verified_at:new Date().toISOString()},options.key);
 }finally{
  await target?.end({timeout:2});
  // The generated name is never accepted from the caller, and DROP runs only after this call created it.
  if(created)await options.maintenance.unsafe(`drop database ${quote(recoveryDatabase)} with (force)`);
 }
}
