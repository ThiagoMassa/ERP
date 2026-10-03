// Local disposable PostgreSQL only. Uses the real control SQL and cutover worker.
import assert from 'node:assert/strict';
import {readFile,readdir,unlink,rmdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {runTenantMaintenance} from '../lib/server/tenant-maintenance.ts';
import {randomBytes,randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {provisionTenant,tenantMigrations,inspectTenant,assertTenantReady} from '../lib/server/tenant-database.ts';
import {tenantIdentity,tenantConnectionOptions} from '../lib/server/tenant-identity.ts';
import {runTenantCutover} from '../lib/server/tenant-cutover.ts';

const password=await readFile(new URL('../work/pg-test-password',import.meta.url),'utf8');
const base={host:'127.0.0.1',port:55439,username:'erp_test_admin',password,ssl:false,max:1,prepare:false,onnotice:()=>{},connect_timeout:5};
const admin=postgres({...base,database:'postgres'}),opened=[],createdRoles=[];
const ids=[randomUUID(),randomUUID(),randomUUID()],fixtures=ids.map(tenantIdentity),secrets=ids.map(()=>randomBytes(36).toString('base64url'));
const runtimeUrl=i=>`postgres://${fixtures[i].runtime}:${secrets[i]}@127.0.0.1:55439/${fixtures[i].database}`;
const root=resolve('work','maintenance-test-'+randomUUID()),key={id:'current-test',value:randomBytes(32)};
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
 for(let i=1;i<3;i++){
  const job=(await control`select public.erp_request_cutover(${ids[i]},(select version from erp_control.companies where id=${ids[i]}),'Migração validada em teste local',${randomUUID()}) as data`)[0].data.job_id;
  await runTenantCutover({control,target:[null,a,b][i],runtimeConnection:runtimeUrl(i),jobId:job,allowLocalTest:true});
 }
 const reason='Manutenção autorizada em teste local';
 const request=async(kind,id,backup=null,company=ids[1],confirmCompany=company,confirmBackup=backup)=>(await control`select public.erp_request_maintenance(${kind},${company},${backup},30,(select version from erp_control.companies where id=${company}),${reason},${confirmCompany},${confirmBackup},${id}) as data`)[0].data;
 const backupId=randomUUID();
 await control`update erp_control.administrators set active=false where user_id=${owner}`;
 assert.equal((await request('backup',backupId)).ok,false);
 await assert.rejects(control`select public.erp_read_maintenance(${ids[1]})`,e=>e.code==='42501');
 await control`update erp_control.administrators set active=true where user_id=${owner}`;

 // Real authorization gates on SQL, including direct RPC access by an ordinary account.
 await control`select set_config('request.jwt.claims',${JSON.stringify({...token,aal:'aal1'})},false)`;
 assert.equal((await request('backup',backupId)).ok,false);
 await control`select set_config('request.jwt.claims',${JSON.stringify({...token,amr:[{method:'totp',timestamp:now-600}]})},false)`;
 assert.equal((await request('backup',backupId)).ok,false);
 await control`select set_config('request.jwt.claims',${JSON.stringify(token)},false)`;
 assert.deepEqual(await request('backup',backupId),{ok:true,job:backupId,status:'requested'});
 assert.equal((await request('backup',backupId)).job,backupId);
 assert.equal((await request('backup',randomUUID())).ok,false);
 await assert.rejects(control.begin(async tx=>{await tx.unsafe('set local role authenticated');await tx`select erp_control.maintenance_step(${backupId},'start','{}')`;}),e=>e.code==='42501');
 const options={control,maintenance:admin,connectMaintenanceDatabase:database=>postgres({...base,database}),connection:{host:base.host,port:base.port,username:base.username,password,allowLocalTest:true},
  tools:{dump:resolve('work/postgresql/pgsql/bin/pg_dump.exe'),restore:resolve('work/postgresql/pgsql/bin/pg_restore.exe')},psql:resolve('work/postgresql/pgsql/bin/psql.exe'),directory:root,currentKey:key,keyFor:async id=>{assert.equal(id,key.id);return key;},runtimeConnection:async company=>runtimeUrl(ids.indexOf(company)),allowLocalTest:true};
 await control`update auth.mfa_factors set status='unverified' where id=${factor}`;
 await assert.rejects(runTenantMaintenance({...options,jobId:backupId}),e=>e.code==='42501');
 assert.equal((await control`select status from erp_control.maintenance_jobs where id=${backupId}`)[0].status,'failed');
 await control`update auth.mfa_factors set status='verified' where id=${factor}`;
 assert.equal((await request('backup',backupId)).status,'requested');
 assert.equal((await runTenantMaintenance({...options,jobId:backupId})).status,'complete');
 const recorded=(await control`select status,size_bytes,verified_at,key_id from erp_control.backups where id=${backupId}`)[0];
 assert.equal(recorded.status,'verified');assert.ok(Number(recorded.size_bytes)>0);assert.ok(recorded.verified_at);assert.equal(recorded.key_id,key.id);
 assert.equal((await runTenantMaintenance({...options,jobId:backupId})).repeated,true);
 const listing=(await control`select public.erp_read_maintenance(${ids[1]}) as data`)[0].data;
 assert.equal(listing.backups.length,1);assert.equal(listing.jobs.length,1);
 assert.equal(listing.backup_count,1);assert.equal(listing.backups[0].restore_eligible,true);
 const emptyPage=(await control`select public.erp_read_maintenance(${ids[1]},1,1,'verified') as data`)[0].data;
 assert.equal(emptyPage.backups.length,0);assert.equal(emptyPage.jobs.length,0);assert.equal(emptyPage.backup_count,1);
 assert.equal((await control`select public.erp_read_maintenance(${ids[1]},0,0,'failed') as data`)[0].data.backups.length,0);
 await assert.rejects(control`select public.erp_read_maintenance(${ids[1]},-1)`,/Filtros inválidos/);
 assert.equal(JSON.stringify(listing).includes('session_id'),false);assert.equal(JSON.stringify(listing).includes('artifact_ref'),false);
 await a`update public.products set stock=17 where id=${productA}`;
 const restoreId=randomUUID(),stale=(await control`select public.erp_tenant_context(${ids[1]}) as data`)[0].data;
 assert.equal((await request('restore',restoreId,backupId,ids[1],ids[2])).ok,false);
 assert.equal((await request('restore',restoreId,backupId,ids[2])).ok,false);
 assert.equal((await request('restore',restoreId,backupId)).ok,true);
 assert.equal((await control`select provisioning from erp_control.companies where id=${ids[1]}`)[0].provisioning,'suspended');
 assert.equal((await request('backup',randomUUID())).ok,false);
 // Lose the response AFTER central completion. The worker must recover, never rerun restore.
 let lost=false;
 const proxy=new Proxy(control,{get(fn,prop){if(prop==='reserve')return async()=>{const reserved=await fn.reserve();return new Proxy(reserved,{apply(call,thisArg,args){const result=Reflect.apply(call,thisArg,args);if(!lost&&args[2]==='complete'){lost=true;return Promise.resolve(result).then(()=>{throw new Error('Lost committed response');});}return result;}});};return Reflect.get(fn,prop);}});
 const restored=await runTenantMaintenance({...options,control:proxy,jobId:restoreId});
 assert.equal(lost,true);assert.equal(restored.recovered,true);
 assert.equal((await a`select stock::text as n from public.products where id=${productA}`)[0].n,'5.000');
 assert.equal((await b`select stock::text as n from public.products where id=${productB}`)[0].n,'10.000');
 assert.equal((await control`select provisioning from erp_control.companies where id=${ids[1]}`)[0].provisioning,'ready');
 const runtime=postgres(tenantConnectionOptions(runtimeUrl(1),ids[1],{allowLocalTest:true}));opened.push(runtime);
 await assert.rejects(runtime`select tenant.dispatch(${runtime.json({...stale,epoch:stale.access_epoch})},'read','products','{}',null)`,e=>e.code==='42501');
 const fresh=(await control`select public.erp_tenant_context(${ids[1]}) as data`)[0].data;
 assert.notEqual(fresh.access_epoch,stale.access_epoch);
 assert.equal((await runtime`select tenant.dispatch(${runtime.json({...fresh,epoch:fresh.access_epoch})},'read','products','{}',null) as data`)[0].data.rows[0].id,productA);
 await a`update public.products set stock=6 where id=${productA}`;
 assert.equal((await runTenantMaintenance({...options,jobId:restoreId})).repeated,true);
 assert.equal((await a`select stock::text as n from public.products where id=${productA}`)[0].n,'6.000');
 assert.equal((await control`select count(*)::int as n from erp_control.audit where action='maintenance.restore.complete' and correlation_id=${restoreId}`)[0].n,1);
 assert.equal((await a`select owner_id from public.products where id=${productA}`)[0].owner_id,owner);
 // Failure BEFORE central completion keeps normal routing suspended. Reauthorize and
 // resume from the tenant journal without overwriting data committed by that restore.
 const retryId=randomUUID();assert.equal((await request('restore',retryId,backupId)).ok,true);
 const beforeCommit=new Proxy(control,{get(fn,prop){if(prop==='reserve')return async()=>{const reserved=await fn.reserve();return new Proxy(reserved,{apply(call,thisArg,args){if(args[2]==='complete')return Promise.reject(new Error('Interrupted before completion'));return Reflect.apply(call,thisArg,args);}});};return Reflect.get(fn,prop);}});
 await assert.rejects(runTenantMaintenance({...options,control:beforeCommit,jobId:retryId}),/Interrupted before completion/);
 assert.equal((await control`select provisioning from erp_control.companies where id=${ids[1]}`)[0].provisioning,'suspended');
 assert.equal((await control`select status from erp_control.maintenance_jobs where id=${retryId}`)[0].status,'failed');
 assert.equal((await request('backup',randomUUID())).ok,false);
 await a`update public.products set stock=7 where id=${productA}`;
 assert.equal((await request('restore',retryId,backupId)).status,'requested');
 assert.equal((await runTenantMaintenance({...options,jobId:retryId})).repeated,true);
 assert.equal((await a`select stock::text as n from public.products where id=${productA}`)[0].n,'7.000');
 assert.equal((await control`select provisioning from erp_control.companies where id=${ids[1]}`)[0].provisioning,'ready');
 console.log('PASS: central RPC MFA/freshness, duplicate requests, private worker forbidden to authenticated role, revoked factor, encrypted backup registration, restore confirmation/company isolation, safety copy, lost response recovery, immutable original author, stale contexts denied and fresh routing restored.');
}finally{
 await Promise.all(opened.map(sql=>sql.end({timeout:1})));
 for(const f of fixtures){await admin.unsafe(`drop database if exists "${f.database}" with (force)`);await admin.unsafe(`drop role if exists "${f.runtime}"`);await admin.unsafe(`drop role if exists "${f.owner}"`);}
 for(const role of createdRoles)await admin.unsafe(`drop role ${role}`);
 await admin.end({timeout:1});
 for(const id of await readdir(root).catch(()=>[]))if(/^[0-9a-f-]{36}$/.test(id)){for(const name of ['archive.enc','manifest.json','manifest.json.tmp'])await unlink(join(root,id,name)).catch(()=>{});await rmdir(join(root,id)).catch(()=>{});}
 await rmdir(root).catch(()=>{});
}
