// Local disposable PostgreSQL only. Uses the real control SQL and cutover worker.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import postgres from 'postgres';
import {provisionTenant,tenantMigrations,inspectTenant,assertTenantReady} from '../lib/server/tenant-database.ts';
import {tenantIdentity,tenantConnectionOptions} from '../lib/server/tenant-identity.ts';
import {runTenantCutover} from '../lib/server/tenant-cutover.ts';

const password=await readFile(new URL('../work/pg-test-password',import.meta.url),'utf8');
const base={host:'127.0.0.1',port:55439,username:'erp_test_admin',password,ssl:false,max:1,prepare:false,onnotice:()=>{},connect_timeout:5};
const admin=postgres({...base,database:'postgres'}),opened=[],createdRoles=[];
const ids=[randomUUID(),randomUUID(),randomUUID()],fixtures=ids.map(tenantIdentity),secrets=ids.map(()=>randomBytes(36).toString('base64url'));
const runtimeUrl=i=>`postgres://${fixtures[i].runtime}:${secrets[i]}@127.0.0.1:55439/${fixtures[i].database}`;
const file=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
try {
 assert.equal((await admin`select current_user as name`)[0].name,'erp_test_admin');
 await admin.unsafe('revoke connect on database postgres from public');
 await admin.unsafe('revoke connect on database template1 from public');
 for(const role of ['anon','authenticated'])if(!(await admin`select 1 from pg_roles where rolname=${role}`).length){await admin.unsafe(`create role ${role} nologin`);createdRoles.push(role);}
 const migrations=await tenantMigrations();
 for(let i=0;i<3;i++)await provisionTenant({companyId:ids[i],runtimePassword:secrets[i],maintenance:admin,connectMaintenanceDatabase:database=>postgres({...base,database}),migrations});
 const control=postgres({...base,database:fixtures[0].database}),a=postgres({...base,database:fixtures[1].database}),b=postgres({...base,database:fixtures[2].database});opened.push(control,a,b);
 // Auth tables reproduce only the columns used by the real authorization functions.
 // JWT signature verification is an HTTP-layer concern, not simulated by this test.
 await control.unsafe(`create schema auth;
 create table auth.users(id uuid primary key,email text,banned_until timestamptz,created_at timestamptz default now(),last_sign_in_at timestamptz,email_confirmed_at timestamptz);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz,aal text,not_after timestamptz,factor_id uuid);
 create table auth.mfa_factors(id uuid primary key,user_id uuid references auth.users(id),status text);
 create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
 await control.unsafe(await file('db/admin-control.sql'));
 await control.unsafe(await file('db/tenant-routing.sql'));
 await control.unsafe(await file('db/tenant-backup-control.sql'));
 await control.unsafe(await file('db/tenant-cutover.sql'));
 const owner=randomUUID(),session=randomUUID(),factor=randomUUID(),productA=randomUUID(),productB=randomUUID();
 await control`insert into auth.users(id,email) values(${owner},'operator@example.invalid')`;
 await control`insert into tenant.actors(id) values(${owner})`;
 await control`insert into erp_control.administrators(user_id) values(${owner})`;
 await control`insert into auth.mfa_factors(id,user_id,status) values(${factor},${owner},'verified')`;
 await control`insert into auth.sessions(id,user_id,created_at,aal,factor_id) values(${session},${owner},now(),'aal2',${factor})`;
 const now=Math.floor(Date.now()/1000),token={sub:owner,session_id:session,iat:now,exp:now+3600,aal:'aal2',amr:[{method:'totp',timestamp:now}]};
 await control`select set_config('request.jwt.claims',${JSON.stringify(token)},false)`;
 await control`insert into public.business_units(id,owner_id,name,model) values(${ids[1]},${owner},'Empresa A','printing'),(${ids[2]},${owner},'Empresa B','retail')`;
 await control`insert into public.products(id,owner_id,business_id,name,category,cost,price,stock) values(${productA},${owner},${ids[1]},'A','Peças',1,2,5),(${productB},${owner},${ids[2]},'B','Peças',1,2,10)`;
 // Legacy origin had no tenant file-reference trigger; the target still has it.
 await control`drop trigger product_asset_reference on public.products`;
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=','base64');
 const photo={name:owner+'/legacy.png',filename:'legacy.png',mime:'image/png',size_bytes:png.length,sha256:createHash('sha256').update(png).digest('hex')};
 const photoBundle={company:ids[1],photos:[photo],read:async()=>png};
 await control`update public.products set image_path=${photo.name} where id=${productA}`;
 const readProgress=async company=>(await control`select public.erp_read_cutover(${company}) as data`)[0].data;
 const initial=await readProgress(ids[1]);assert.equal(initial.company,ids[1]);assert.equal(initial.job,null);
 await control`select set_config('request.jwt.claims',${JSON.stringify({...token,aal:'aal1'})},false)`;
 await assert.rejects(readProgress(ids[1]),e=>e.code==='42501');
 await control`select set_config('request.jwt.claims',${JSON.stringify(token)},false)`;
 await control`update erp_control.administrators set active=false where user_id=${owner}`;
 await assert.rejects(readProgress(ids[1]),e=>e.code==='42501');
 await control`update erp_control.administrators set active=true where user_id=${owner}`;
 assert.equal((await control`select has_function_privilege('anon','public.erp_read_cutover(uuid)','execute') as allowed`)[0].allowed,false);
 const request=async company=>(await control`select public.erp_request_cutover(${company},(select version from erp_control.companies where id=${company}),'Migração validada em teste local',${randomUUID()}) as data`)[0].data.job_id;
 const jobA=await request(ids[1]);
 // Revocation must stop the operator even though its original request had MFA.
 await control`insert into erp_control.user_access(user_id,revoked_before) values(${owner},now())`;
 await assert.rejects(runTenantCutover({control,target:a,runtimeConnection:runtimeUrl(1),jobId:jobA,allowLocalTest:true}),e=>e.code==='42501');
 assert.equal((await a`select count(*)::int as n from public.products`)[0].n,0);
 assert.equal((await control`select data_location from erp_control.companies where id=${ids[1]}`)[0].data_location,'migrating');
 await control`update erp_control.user_access set revoked_before=null where user_id=${owner}`;
 assert.equal(await request(ids[1]),jobA);
 await control`update auth.mfa_factors set status='unverified' where id=${factor}`;
 await assert.rejects(runTenantCutover({control,target:a,runtimeConnection:runtimeUrl(1),jobId:jobA,allowLocalTest:true}),e=>e.code==='42501');
 await control`update auth.mfa_factors set status='verified' where id=${factor}`;
 assert.equal(await request(ids[1]),jobA);
 await assert.rejects(runTenantCutover({control,target:a,runtimeConnection:runtimeUrl(1),jobId:jobA,allowLocalTest:true,photoBundle:{...photoBundle,company:ids[2]}}),e=>e.code==='ASSET_BUNDLE_REQUIRED');
 assert.equal((await a`select count(*)::int as n from tenant.assets`)[0].n,0);
 assert.equal(await request(ids[1]),jobA);
 // Simulate loss of the response AFTER the database committed activation.
 let lost=false;
 const lostResponse=new Proxy(control,{apply(fn,thisArg,args){const result=Reflect.apply(fn,thisArg,args);if(!lost&&Array.isArray(args[0])&&args[0].join('').includes("'activate'")){lost=true;return Promise.resolve(result).then(()=>{throw new Error('Lost response');});}return result;}});
 const result=await runTenantCutover({control:lostResponse,target:a,runtimeConnection:runtimeUrl(1),jobId:jobA,allowLocalTest:true,photoBundle});
 assert.equal(result.status,'activated');assert.equal(result.recovered,true);
 assertTenantReady(await inspectTenant(runtimeUrl(1),ids[1],{allowLocalTest:true}),migrations);
 const route=(await control`select public.erp_tenant_context(${ids[1]}) as data`)[0].data;
 assert.equal(route.provisioning,'ready');assert.equal(route.database_identity,fixtures[1].database);
 const runtime=postgres(tenantConnectionOptions(runtimeUrl(1),ids[1],{allowLocalTest:true}));opened.push(runtime);
 const products=(await runtime`select tenant.dispatch(${runtime.json({...route,epoch:route.access_epoch})},'read','products','{}',null) as data`)[0].data;
 assert.equal(products.rows.length,1);assert.equal(products.rows[0].id,productA);
 const progress=await readProgress(ids[1]);assert.equal(progress.location,'tenant');assert.equal(progress.job.status,'activated');assert.equal(progress.job.counts.photos,1);
 for(const field of ['session_id','token_issued_at','credential_ref'])assert.equal(Object.hasOwn(progress.job,field),false);
 assert.ok((await control`select count(*)::int as n from erp_control.audit where action='tenant.cutover.read' and company_id=${ids[1]}`)[0].n>=2);
 const asset=(await runtime`select tenant.dispatch(${runtime.json({...route,epoch:route.access_epoch})},'read','asset.read',${runtime.json({bucket:'product-photos',path:photo.name})},null) as data`)[0].data;
 assert.equal(asset.sha256,photo.sha256);assert.deepEqual(Buffer.from(asset.content,'base64'),png);
 assert.equal((await control`select data_location from erp_control.companies where id=${ids[2]}`)[0].data_location,'legacy');
 assert.equal((await b`select count(*)::int as n from public.products`)[0].n,0);
 assert.equal((await b`select count(*)::int as n from tenant.assets`)[0].n,0);
 const repeated=await runTenantCutover({control,target:a,runtimeConnection:runtimeUrl(1),jobId:jobA,allowLocalTest:true});
 assert.equal(repeated.repeated,true);
 assert.equal((await control`select count(*)::int as n from erp_control.audit where action='tenant.cutover.activate' and company_id=${ids[1]}`)[0].n,1);
 await assert.rejects(control`update public.products set stock=6 where id=${productA}`,e=>e.code==='55000');
 // A failure BEFORE central activation leaves legacy frozen and its route unready.
 const jobB=await request(ids[2]);
 const beforeCommit=new Proxy(control,{apply(fn,thisArg,args){if(Array.isArray(args[0])&&args[0].join('').includes("'activate'"))return Promise.reject(new Error('Connection interrupted'));return Reflect.apply(fn,thisArg,args);}});
 await assert.rejects(runTenantCutover({control:beforeCommit,target:b,runtimeConnection:runtimeUrl(2),jobId:jobB,allowLocalTest:true}),/Connection interrupted/);
 assert.equal((await control`select data_location,provisioning from erp_control.companies where id=${ids[2]}`)[0].provisioning,'failed');
 assert.equal((await control`select data_location from erp_control.companies where id=${ids[2]}`)[0].data_location,'migrating');
 assert.equal(await request(ids[2]),jobB);
 const retry=await runTenantCutover({control,target:b,runtimeConnection:runtimeUrl(2),jobId:jobB,allowLocalTest:true});
 assert.equal(retry.status,'activated');
 assert.equal((await b`select count(*)::int as n from public.products`)[0].n,1);
 assert.equal((await b`select count(*)::int as n from tenant.reconciliations`)[0].n,1);
 assert.equal((await a`select stock::text as n from public.products where id=${productA}`)[0].n,'5.000');
 console.log('PASS: worker real, autorização revogada/MFA removido negados, cópia/ativação/consulta por contexto central, falhas antes e depois do commit, retry sem duplicar, segunda empresa preservada.');
 console.log('PASS: pacote de outra empresa recusado; foto legada importada e acessível pela credencial restrita após ativação; bytes e segunda empresa preservados.');
} finally {
 await Promise.all(opened.map(sql=>sql.end({timeout:1})));
 for(const f of fixtures){await admin.unsafe(`drop database if exists "${f.database}" with (force)`);await admin.unsafe(`drop role if exists "${f.runtime}"`);await admin.unsafe(`drop role if exists "${f.owner}"`);}
 for(const role of createdRoles)await admin.unsafe(`drop role ${role}`);
 await admin.end({timeout:1});
}
