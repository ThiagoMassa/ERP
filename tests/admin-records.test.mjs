// Local disposable PostgreSQL only; Auth tables are fixtures, SQL authorization is real.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {provisionTenant,tenantMigrations} from '../lib/server/tenant-database.ts';
import {tenantIdentity} from '../lib/server/tenant-identity.ts';
const password=await readFile(new URL('../work/pg-test-password',import.meta.url),'utf8');
const base={host:'127.0.0.1',port:55439,username:'erp_test_admin',password,ssl:false,max:1,prepare:false,onnotice:()=>{},connect_timeout:5};
const admin=postgres({...base,database:'postgres'}),identity=tenantIdentity(randomUUID()),createdRoles=[];let db;
try{
 assert.equal((await admin`select current_user as name`)[0].name,'erp_test_admin');
 for(const role of ['anon','authenticated'])if(!(await admin`select 1 from pg_roles where rolname=${role}`).length){await admin.unsafe(`create role ${role} nologin`);createdRoles.push(role);}
 await provisionTenant({companyId:identity.company,runtimePassword:randomBytes(36).toString('base64url'),maintenance:admin,connectMaintenanceDatabase:database=>postgres({...base,database}),migrations:await tenantMigrations()});
 db=postgres({...base,database:identity.database});
 await db.unsafe(`create schema auth;
 create table auth.users(id uuid primary key,email text,banned_until timestamptz,created_at timestamptz default now(),last_sign_in_at timestamptz,email_confirmed_at timestamptz);
 create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz,aal text,not_after timestamptz);
 create table auth.mfa_factors(id uuid primary key,user_id uuid,status text);
 create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
 for(const file of ['admin-control','tenant-routing','tenant-backup-control','admin-records','admin-corrections'])await db.unsafe(await readFile(new URL('../db/'+file+'.sql',import.meta.url),'utf8'));
 // The disposable tenant starts stricter than Supabase's central exposed schema.
 await db`grant usage on schema public to authenticated`;
 const adm=randomUUID(),user=randomUUID(),session=randomUUID(),company=randomUUID(),now=Math.floor(Date.now()/1000);
 await db`insert into auth.users(id,email) values(${adm},'audit@example.invalid'),(${user},'reader@example.invalid')`;
 await db`insert into auth.sessions(id,user_id,created_at,aal) values(${session},${adm},now(),'aal2')`;
 await db`insert into auth.mfa_factors(id,user_id,status) values(${randomUUID()},${adm},'verified')`;
 await db`insert into erp_control.administrators(user_id) values(${adm})`;
 const token={sub:adm,session_id:session,iat:now,exp:now+3600,aal:'aal2',amr:[{method:'totp',timestamp:now}]};
 const setToken=async value=>db`select set_config('request.jwt.claims',${JSON.stringify(value)},false)`;
 await setToken(token);
 const context=async(operation='products')=>(await db`select public.erp_admin_record_context(${company},${operation}) as data`)[0].data;
 await db`insert into tenant.actors(id) values(${adm})`;
 await db`insert into public.business_units(id,owner_id,name,model) values(${company},${adm},'Empresa inspecionada','service')`;
 await assert.rejects(context(),e=>e.code==='42501');
 await db`update erp_control.companies set provisioning='ready',database_identity='fixture',credential_ref='fixture',health_checked_at=now(),status='suspended' where id=${company}`;
 await db`delete from erp_control.memberships where company_id=${company}`;
 const c=await context();assert.equal(c.actor,adm);assert.equal(c.company,company);assert.equal(c.access_epoch,'00000000-0000-0000-0000-000000000000');
 for(const decisions of Object.values(c.permissions)){assert.equal(decisions.read.allowed,true);for(const action of ['create','edit','delete','approve','cancel','reverse','export'])assert.equal(decisions[action].allowed,false)}
 assert.ok(Date.parse(c.expires_at)>Date.now());assert.ok(Date.parse(c.expires_at)<Date.now()+30000);
 const event=(await db`select * from erp_control.audit where correlation_id=${c.correlation}`)[0];assert.equal(event.actor_id,adm);assert.equal(event.company_id,company);assert.equal(event.action,'records.authorize.read');
 const history=await context('record_history');assert.equal(history.administrative_read,true);assert.equal(history.admin_read_operation,'record_history');assert.ok(history.correlation);
 const correctionKey=randomUUID(),entity=randomUUID(),reason='Correção justificada de metadados do produto';
 const correction=async(operation='admin.product.correct')=>(await db`select public.erp_admin_correction_context(${company},${operation},${entity},${reason},${correctionKey}) as data`)[0].data;
 const edit=await correction();assert.equal(edit.administrative,true);assert.equal(edit.admin_action,'admin.product.correct');assert.equal(edit.permissions.catalog.edit.allowed,true);assert.equal(edit.permissions.finance,undefined);
 const authorized=(await db`select * from erp_control.audit where correlation_id=${correctionKey}`)[0];assert.equal(authorized.action,'records.authorize.correct');assert.equal(authorized.reason,reason);assert.equal(authorized.entity,entity);
 await setToken({...token,amr:[{method:'totp',timestamp:now-600}]});await assert.rejects(correction(),e=>e.code==='42501');await setToken(token);
 await assert.rejects(correction('product.save'),e=>e.code==='42501');
 await setToken({...token,aal:'aal1'});await assert.rejects(correction(),e=>e.code==='42501');await setToken(token);
 await db`update erp_control.administrators set active=false where user_id=${adm}`;await assert.rejects(correction(),e=>e.code==='42501');await db`update erp_control.administrators set active=true where user_id=${adm}`;
 assert.equal((await db`select has_function_privilege('anon','public.erp_admin_correction_context(uuid,text,uuid,text,uuid)','execute') as allowed`)[0].allowed,false);
 for(const op of ['product.save','permissions','lookups','asset.download','unknown'])await assert.rejects(context(op),e=>e.code==='42501');
 await setToken({...token,aal:'aal1'});await assert.rejects(context(),e=>e.code==='42501');await setToken(token);
 await db`update erp_control.administrators set active=false where user_id=${adm}`;await assert.rejects(context(),e=>e.code==='42501');await db`update erp_control.administrators set active=true where user_id=${adm}`;
 await db`update erp_control.companies set provisioning='suspended' where id=${company}`;await assert.rejects(context(),e=>e.code==='42501');
 await assert.rejects(correction(),e=>e.code==='42501');
 assert.equal((await db`select has_function_privilege('anon','public.erp_admin_record_context(uuid,text)','execute') as allowed`)[0].allowed,false);
 await db`delete from auth.sessions where id=${session}`;await assert.rejects(context(),e=>e.code==='28000');
 console.log('PASS: autorização administrativa explícita de leitura, sem vínculo obrigatório, empresa suspensa inspecionável, manutenção/AAL1/revogação/ADM inativo negados, escrita e exportação desativadas, autorização auditada.');
}finally{
 await db?.end({timeout:1});await admin.unsafe(`drop database if exists "${identity.database}" with (force)`);for(const role of [identity.runtime,identity.owner,...createdRoles])await admin.unsafe(`drop role if exists "${role}"`);await admin.end({timeout:1});
}
