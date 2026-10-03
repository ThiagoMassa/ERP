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
 for(const statement of ['select * from tenant.admin_requests',"update public.products set name='forged'","delete from tenant.audit","select tenant.dispatch_before_corrections('{}','read','products','{}',null)"])await assert.rejects(runtime[0].unsafe(statement),e=>e.code==='42501');
 await db`update tenant.identity set operational_state='maintenance'`;
 await assert.rejects(call('admin.product.correct',data,key),e=>e.code==='55000');
 assert.equal((await maintenance[1]`select count(*)::int n from public.products`)[0].n,0);
 console.log('PASS: correção de metadados com autoria preservada, auditoria antes/depois, concorrência real, repetição idempotente, permissões antes da repetição, rollback integral e isolamento entre bancos. Contextos administrativos simulados; sem validação central/MFA.');
}finally{
 await Promise.all(opened.map(sql=>sql.end({timeout:1})));
 for(const f of fixtures){await admin.unsafe(`drop database if exists "${f.database}" with (force)`);await admin.unsafe(`drop role if exists "${f.runtime}"`);await admin.unsafe(`drop role if exists "${f.owner}"`);}
 await admin.end({timeout:1});
}
