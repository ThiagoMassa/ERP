import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import postgres from 'postgres';
import {provisionTenant,tenantMigrations} from '../lib/server/tenant-database.ts';
import {tenantIdentity,tenantConnectionOptions} from '../lib/server/tenant-identity.ts';
const password=await readFile(new URL('../work/pg-test-password',import.meta.url),'utf8');
const base={host:'127.0.0.1',port:55439,username:'erp_test_admin',password,ssl:false,max:1,prepare:false,onnotice:()=>{},connect_timeout:5};
const admin=postgres({...base,database:'postgres'}),ids=[randomUUID(),randomUUID()],fixtures=ids.map(tenantIdentity),secrets=ids.map(()=>randomBytes(36).toString('base64url')),opened=[];
const permissions=Object.fromEntries(['overview','sales','purchases','catalog','stock','finance','production','settings'].map(m=>[m,Object.fromEntries(['available','visible','read','create','edit','delete','approve','cancel','reverse','export'].map(a=>[a,{allowed:true}]))]));
const author=randomUUID(),colleague=randomUUID();
try{
 assert.equal((await admin`select current_user as name`)[0].name,'erp_test_admin');
 const migrations=await tenantMigrations();
 const maintenance=[],runtime=[];
 for(let i=0;i<2;i++){
  await provisionTenant({companyId:ids[i],runtimePassword:secrets[i],maintenance:admin,connectMaintenanceDatabase:database=>postgres({...base,database}),migrations});
  const db=postgres({...base,database:fixtures[i].database}),app=postgres(tenantConnectionOptions(`postgres://${fixtures[i].runtime}:${secrets[i]}@127.0.0.1:55439/${fixtures[i].database}`,ids[i],{allowLocalTest:true}));maintenance.push(db);runtime.push(app);opened.push(db,app);
  await db`insert into tenant.actors(id) values(${author})`;
  await db`insert into public.business_units(id,owner_id,name,model) values(${ids[i]},${author},'Arquivo teste','printing')`;
  await db`insert into public.erp_warehouses(business_id,name) values(${ids[i]},'Principal')`;
  await db`update tenant.identity set operational_state='active'`;
 }
 const context=(i=0,user=author)=>({company:ids[i],actor:user,epoch:'00000000-0000-0000-0000-000000000000',expires_at:new Date(Date.now()+25000).toISOString(),permissions});
 async function call(operation,data,key=randomUUID(),ctx=context(),i=0){const sql=runtime[i];return (await sql`select tenant.dispatch(${sql.json(ctx)},${operation==='asset.read'?'read':'command'},${operation},${sql.json(data)},${key}) as data`)[0].data;}
 const content=Buffer.from('conteúdo de teste isolado'),key=randomUUID(),upload={bucket:'product-photos',filename:'foto.png',mime:'image/png',content:content.toString('base64')};
 const photo=await call('asset.save',upload,key);
 assert.equal(photo.sha256,createHash('sha256').update(content).digest('hex'));
 assert.deepEqual(await call('asset.save',upload,key),photo);
 assert.equal((await maintenance[0]`select count(*)::int as n from tenant.assets`)[0].n,1);
 await assert.rejects(call('asset.save',{...upload,content:Buffer.from('outro').toString('base64')},key),/outro conteúdo/);
 await assert.rejects(call('asset.read',{bucket:'product-photos',path:photo.path}),e=>e.code==='42501');
 const product=await call('product.save',{name:'Com foto',item_type:'finished',unit:'un',currency:'BRL',cost:10,price:20,stock:0,image_path:photo.path});
 const downloaded=await call('asset.read',{bucket:'product-photos',path:photo.path},randomUUID(),context(0,colleague));
 assert.deepEqual(Buffer.from(downloaded.content,'base64'),content);
 await assert.rejects(call('asset.read',{bucket:'product-photos',path:photo.path},randomUUID(),context(1),1),e=>e.code==='42501');
 await assert.rejects(call('asset.read',{bucket:'product-photos',path:photo.path},randomUUID(),context(1)),e=>e.code==='42501');
 const restricted=structuredClone(context());restricted.permissions.catalog.available.allowed=false;
 await assert.rejects(call('asset.save',upload,key,restricted),e=>e.code==='42501');
 await assert.rejects(call('asset.read',{bucket:'product-photos',path:photo.path},randomUUID(),restricted),e=>e.code==='42501');
 const model=await call('asset.save',{bucket:'erp-models',filename:'modelo.3mf',mime:'model/3mf',content:content.toString('base64')});
 await assert.rejects(call('file.save',{name:'modelo.3mf',path:model.path,size_bytes:content.length+1}),/tamanho divergente/);
 await call('file.save',{name:'modelo.3mf',path:model.path,size_bytes:content.length});
 const noExport=structuredClone(context());noExport.permissions.production.export.allowed=false;
 await assert.rejects(call('asset.read',{bucket:'erp-models',path:model.path},randomUUID(),noExport),e=>e.code==='42501');
 assert.deepEqual(Buffer.from((await call('asset.read',{bucket:'erp-models',path:model.path})).content,'base64'),content);
 const before=(await maintenance[0]`select count(*)::int as n from tenant.assets`)[0].n;
 await assert.rejects(call('asset.save',{...upload,content:Buffer.alloc(5242881).toString('base64')}),/limite/);
 assert.equal((await maintenance[0]`select count(*)::int as n from tenant.assets`)[0].n,before);
 await assert.rejects(call('product.save',{id:product.id,name:'Inválido',item_type:'finished',unit:'un',currency:'BRL',cost:10,price:20,image_path:ids[1]+'/forged.png'}));
 for(const statement of ['select * from tenant.assets',"delete from tenant.uploads", "select tenant.dispatch_without_assets('{}','read','products','{}',null)"])await assert.rejects(runtime[0].unsafe(statement),e=>e.code==='42501');
 await maintenance[0]`update tenant.identity set operational_state='maintenance'`;
 await assert.rejects(call('asset.read',{bucket:'product-photos',path:photo.path}),e=>e.code==='42501');
 const audit=await maintenance[0]`select actor_id,after_data from tenant.audit where action='asset.download' and entity=${photo.id}`;
 assert.equal(audit[0].actor_id,colleague);assert.equal(audit[0].after_data.sha256,photo.sha256);assert.equal(JSON.stringify(audit).includes(content.toString('base64')),false);
 assert.equal((await maintenance[1]`select count(*)::int as n from tenant.assets`)[0].n,0);
 console.log('PASS: binary files isolated by DB; shared company reading; byte/hash fidelity; retry without duplication; changed permissions beat retry; references and size verified; export required for 3MF; maintenance and direct-table access denied; immutable content omitted from audit.');
}finally{
 await Promise.all(opened.map(sql=>sql.end({timeout:1})));
 for(const f of fixtures){await admin.unsafe(`drop database if exists "${f.database}" with (force)`);await admin.unsafe(`drop role if exists "${f.runtime}"`);await admin.unsafe(`drop role if exists "${f.owner}"`);}
 await admin.end({timeout:1});
}
