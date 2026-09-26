// Real native dump/recovery in a local disposable PostgreSQL cluster only.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile,readdir,unlink,rmdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import postgres from 'postgres';
import {zipSync,strToU8} from 'fflate';
import {validateAsset} from '../lib/server/asset-content.ts';
import {tenantIdentity} from '../lib/server/tenant-identity.ts';
import {provisionTenant,tenantMigrations} from '../lib/server/tenant-database.ts';
import {createTenantBackup,inspectBackup,verifyTenantRecovery,restoreTenantBackup} from '../lib/server/tenant-backup.ts';

const password=await readFile(new URL('../work/pg-test-password',import.meta.url),'utf8');
const base={host:'127.0.0.1',port:55439,username:'erp_test_admin',password,ssl:false,max:1,prepare:false,onnotice:()=>{},connect_timeout:5};
const admin=postgres({...base,database:'postgres'}),opened=[];
const companyIds=[randomUUID(),randomUUID()],fixtures=companyIds.map(tenantIdentity);
const runtimePasswords=companyIds.map(()=>randomBytes(36).toString('base64url'));
const root=resolve('work','backup-test-'+randomUUID()),key={id:'test-key',value:randomBytes(32)};
const tools={dump:resolve('work/postgresql/pgsql/bin/pg_dump.exe'),restore:resolve('work/postgresql/pgsql/bin/pg_restore.exe')};
const connection={host:base.host,port:base.port,username:base.username,password,allowLocalTest:true};
let backup;
const safety=randomUUID();
try{
 assert.equal((await admin`select current_user as name`)[0].name,'erp_test_admin');
 const migrations=await tenantMigrations();
 for(let i=0;i<companyIds.length;i++)await provisionTenant({companyId:companyIds[i],runtimePassword:runtimePasswords[i],maintenance:admin,connectMaintenanceDatabase:database=>postgres({...base,database}),migrations});
 const a=postgres({...base,database:fixtures[0].database}),b=postgres({...base,database:fixtures[1].database});opened.push(a,b);
 const author=randomUUID(),product=randomUUID(),otherProduct=randomUUID();
 for(let i=0;i<2;i++){
  const sql=[a,b][i];await sql`insert into tenant.actors(id) values(${author})`;
  await sql`insert into public.business_units(id,owner_id,name,model) values(${companyIds[i]},${author},${'Empresa '+i},'printing')`;
  await sql`insert into public.products(id,owner_id,business_id,name,category,cost,price,stock,currency) values(${[product,otherProduct][i]},${author},${companyIds[i]},${'Peça confidencial '+i},'Peças','123.4567','987.6543',5,'CLF')`;
  await sql`update tenant.identity set operational_state='active' where singleton`;
 }
 const assetId=randomUUID(),photoBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=','base64'),photoPath=companyIds[0]+'/'+assetId+'.png';
 await a`insert into tenant.assets(id,bucket_id,name,filename,mime,content,created_by) values(${assetId},'product-photos',${photoPath},'foto.png','image/png',${photoBytes},${author})`;
 await a`insert into tenant.uploads(bucket_id,name,size_bytes) values('product-photos',${photoPath},${photoBytes.length})`;
 await a`update public.products set image_path=${photoPath} where id=${product}`;
 const modelId=randomUUID(),modelPath=companyIds[0]+'/'+modelId+'.3mf';
 const modelBytes=Buffer.from(zipSync({
  '[Content_Types].xml':strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>'),
  '_rels/.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel0" Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
  '3D/3dmodel.model':strToU8('<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="1" v2="2" v3="3"/><triangle v1="2" v2="0" v3="3"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>'),
 }));
 assert.equal(validateAsset(photoBytes,'product-photos','foto.png'),'image/png');
 assert.equal(validateAsset(modelBytes,'erp-models','peca.3mf'),'model/3mf');
 await a`insert into tenant.assets(id,bucket_id,name,filename,mime,content,created_by) values(${modelId},'erp-models',${modelPath},'peca.3mf','model/3mf',${modelBytes},${author})`;
 await a`insert into tenant.uploads(bucket_id,name,size_bytes) values('erp-models',${modelPath},${modelBytes.length})`;
 await a`insert into public.erp_files(business_id,product_id,name,path,size_bytes,created_by) values(${companyIds[0]},${product},'Peça original',${modelPath},${modelBytes.length},${author})`;
 const otherAsset=randomUUID();await b`insert into tenant.assets(id,bucket_id,name,filename,mime,content,created_by) values(${otherAsset},'erp-models',${companyIds[1]+'/'+otherAsset+'.3mf'},'outro.3mf','model/3mf',${Buffer.from('Arquivo exclusivo B')},${author})`;
 const options={company:companyIds[0],source:a,directory:root,key,connection,tools,retentionDays:30};
 backup=await createTenantBackup(options);
 assert.equal(backup.verified_at,null);assert.ok(backup.bytes>1000);
 assert.equal(backup.tables.find(t=>t.schema==='public'&&t.name==='products').rows,1);
 assert.equal(new Date(backup.retention_until)-new Date(backup.created_at),30*86400000);
 const archivePath=join(root,backup.id,'archive.enc'),manifestPath=join(root,backup.id,'manifest.json');
 const encrypted=await readFile(archivePath),manifestText=await readFile(manifestPath,'utf8');
 assert.equal(encrypted.includes(Buffer.from('Peça confidencial')),false);
 assert.deepEqual(await inspectBackup({company:companyIds[0],backup:backup.id,directory:root,key}),backup);
 assert.equal(backup.tables.find(t=>t.schema==='tenant'&&t.name==='assets').rows,2);
 // Live data changes after the snapshot must not alter the artifact or a recovery drill.
 await a`update public.products set stock=17,name='Registro posterior ao backup' where id=${product}`;
 // Privileged fixture mutation verifies that recovery really replaces file bytes.
 await a`update tenant.assets set content=${Buffer.alloc(photoBytes.length,1)} where id=${assetId}`;
 await a`update tenant.assets set content=${Buffer.alloc(modelBytes.length,2)} where id=${modelId}`;
 assert.deepEqual(await createTenantBackup({...options,id:backup.id}),backup);
 assert.equal((await readdir(root)).length,1);
 const databaseCount=(await admin`select count(*)::int as n from pg_database`)[0].n;
 const verified=await verifyTenantRecovery({company:companyIds[0],backup:backup.id,directory:root,key,maintenance:admin,connectMaintenanceDatabase:database=>postgres({...base,database}),connection,tools});
 assert.ok(verified.verified_at);assert.equal(verified.sha256,backup.sha256);
 assert.equal((await a`select stock::text as n from public.products where id=${product}`)[0].n,'17.000');
 assert.equal((await b`select stock::text as n from public.products where id=${otherProduct}`)[0].n,'5.000');
 assert.equal((await admin`select count(*)::int as n from pg_database`)[0].n,databaseCount);
 await assert.rejects(inspectBackup({company:companyIds[1],backup:backup.id,directory:root,key}),e=>e.code==='IDENTITY_MISMATCH');
 await assert.rejects(inspectBackup({company:companyIds[0],backup:backup.id,directory:root,key:{id:key.id,value:randomBytes(32)}}),e=>e.code==='BACKUP_AUTHENTICATION');
 const changed=Buffer.from(encrypted);changed[40]^=1;await writeFile(archivePath,changed);
 await assert.rejects(verifyTenantRecovery({company:companyIds[0],backup:backup.id,directory:root,key,maintenance:admin,connectMaintenanceDatabase:database=>postgres({...base,database}),connection,tools}),e=>e.code==='BACKUP_INTEGRITY');
 assert.equal((await admin`select count(*)::int as n from pg_database`)[0].n,databaseCount);
 await writeFile(archivePath,encrypted);
 const forged=JSON.parse(manifestText);forged.retention_until='2100-01-01T00:00:00.000Z';await writeFile(manifestPath,JSON.stringify(forged));
 await assert.rejects(inspectBackup({company:companyIds[0],backup:backup.id,directory:root,key}),e=>e.code==='BACKUP_AUTHENTICATION');
 await writeFile(manifestPath,manifestText);
 const before=await readdir(root);await assert.rejects(createTenantBackup({...options,maxBytes:1}),e=>e.code==='BACKUP_SIZE');assert.deepEqual(await readdir(root),before);
 await assert.rejects(createTenantBackup({...options,directory:resolve('public/backups')}),e=>e.code==='BACKUP_PATH');
 const adminActor=randomUUID(),job={id:randomUUID(),epoch:randomUUID(),actor:adminActor,reason:'Recuperação autorizada em teste isolado',safety,confirmCompany:companyIds[0],confirmBackup:backup.id};
 const restoreOptions={company:companyIds[0],backup:backup.id,directory:root,key,maintenance:admin,connectMaintenanceDatabase:database=>postgres({...base,database}),connection,tools,target:a,psql:resolve('work/postgresql/pgsql/bin/psql.exe'),job,authorize:async()=>{}};
 await assert.rejects(restoreTenantBackup({...restoreOptions,authorize:async()=>{throw new Error('MFA revogado');}}),/MFA revogado/);
 assert.equal((await a`select operational_state from tenant.identity`)[0].operational_state,'active');
 let authorizations=0;
 // Fixture-only DDL failure after DROP SCHEMA, during the restoring transaction.
 await assert.rejects(restoreTenantBackup({...restoreOptions,authorize:async()=>{
  if(++authorizations===3)await a.unsafe("create schema restore_test_failure;create function restore_test_failure.reject() returns event_trigger language plpgsql as $$begin raise exception 'Injected restore failure';end$$;create event trigger reject_restore on ddl_command_start when tag in ('CREATE SCHEMA') execute function restore_test_failure.reject();");
 }}));
 assert.equal((await a`select stock::text as n from public.products where id=${product}`)[0].n,'17.000');
 assert.equal((await a`select operational_state from tenant.identity`)[0].operational_state,'maintenance');
 assert.ok((await inspectBackup({company:companyIds[0],backup:safety,directory:root,key})).verified_at);
 await a.unsafe('drop event trigger reject_restore;drop function restore_test_failure.reject();drop schema restore_test_failure;');
 const restored=await restoreTenantBackup(restoreOptions);assert.equal(restored.repeated,false);
 assert.deepEqual((await a`select content from tenant.assets where id=${assetId}`)[0].content,photoBytes);
 assert.equal((await a`select image_path from public.products where id=${product}`)[0].image_path,photoPath);
 assert.deepEqual((await a`select content from tenant.assets where id=${modelId}`)[0].content,modelBytes);
 assert.equal(Number((await a`select size_bytes from public.erp_files where path=${modelPath}`)[0].size_bytes),modelBytes.length);
 assert.equal((await b`select content from tenant.assets where id=${otherAsset}`)[0].content.toString(),'Arquivo exclusivo B');
 const restoredProduct=(await a`select stock::text as stock,price::text as price,owner_id,name from public.products where id=${product}`)[0];
 assert.deepEqual(restoredProduct,{stock:'5.000',price:'987.6543',owner_id:author,name:'Peça confidencial 0'});
 const audit=(await a`select actor_id,after_data from tenant.audit where action='tenant.restore' and entity=${job.id}`)[0];
 assert.equal(audit.actor_id,adminActor);assert.equal(audit.after_data.safety,safety);assert.equal(audit.after_data.reason,job.reason);
 assert.equal((await a`select operational_state from tenant.identity`)[0].operational_state,'maintenance');
 const runtime=postgres({...base,database:fixtures[0].database,username:fixtures[0].runtime,password:runtimePasswords[0]});opened.push(runtime);
 await assert.rejects(runtime`select tenant.dispatch(${runtime.json({epoch:job.epoch})},'read','products','{}',null)`,e=>e.code==='55000');
 await assert.rejects(runtime`select tenant.dispatch_core('{}','read','products','{}',null)`,e=>e.code==='42501');
 await assert.rejects(runtime`select * from public.products`,e=>e.code==='42501');
 assert.equal((await runtime`select tenant.health()->>'operational_state' as state`)[0].state,'maintenance');
 await a`update public.products set stock=6 where id=${product}`;
 assert.equal((await restoreTenantBackup(restoreOptions)).repeated,true);
 assert.equal((await a`select stock::text as n from public.products where id=${product}`)[0].n,'6.000');
 assert.equal((await b`select stock::text as n from public.products where id=${otherProduct}`)[0].n,'5.000');
 console.log('PASS: pg_dump real criptografado, snapshot/decimais/autoria, manifesto autenticado, recuperação integral com comparação de tabelas e funções, banco temporário removido, outra empresa preservada, chave/empresa/arquivo adulterados recusados e limpeza de falha.');
 console.log('PASS: restauração sobre banco existente, autorização antes da escrita, cópia de segurança verificada, falha após DROP SCHEMA com rollback integral, conferência antes do commit, manutenção persistente, autoria original e ADM auditado, privilégios restritos e repetição sem sobrescrita.');
 console.log('PASS: PNG e pacote 3MF restaurados byte a byte após adulteração controlada; referências, tamanhos e arquivos da outra empresa preservados.');
}finally{
 await Promise.all(opened.map(sql=>sql.end({timeout:1})));
 for(const f of fixtures){await admin.unsafe(`drop database if exists "${f.database}" with (force)`);await admin.unsafe(`drop role if exists "${f.runtime}"`);await admin.unsafe(`drop role if exists "${f.owner}"`);}
 await admin.end({timeout:1});
 if(backup)for(const id of [backup.id,safety]){for(const name of ['archive.enc','manifest.json','manifest.json.tmp'])await unlink(join(root,id,name)).catch(()=>{});await rmdir(join(root,id)).catch(()=>{});}
 await rmdir(root).catch(()=>{});
}
