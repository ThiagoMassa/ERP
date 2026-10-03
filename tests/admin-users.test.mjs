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
 for(const file of ['admin-control','admin-users','admin-account-audit'])await db.unsafe(await readFile(new URL('../db/'+file+'.sql',import.meta.url),'utf8'));
 // The disposable tenant starts stricter than Supabase's central exposed schema.
 await db`grant usage on schema public to authenticated`;
 const adm=randomUUID(),user=randomUUID(),session=randomUUID(),company=randomUUID(),other=randomUUID(),now=Math.floor(Date.now()/1000);
 await db`insert into auth.users(id,email) values(${adm},'audit@example.invalid'),(${user},'reader@example.invalid')`;
 await db`insert into auth.sessions(id,user_id,created_at,aal) values(${session},${adm},now(),'aal2')`;
 await db`insert into auth.mfa_factors(id,user_id,status) values(${randomUUID()},${adm},'verified')`;
 await db`insert into erp_control.administrators(user_id) values(${adm})`;
 const token={sub:adm,session_id:session,iat:now,exp:now+3600,aal:'aal2',amr:[{method:'totp',timestamp:now}]};
 const setToken=async value=>db`select set_config('request.jwt.claims',${JSON.stringify(value)},false)`;
 await setToken(token);
 const read=async filters=>(await db`select public.erp_admin_users(${db.json(filters||{})}) as data`)[0].data;
 const save=async(name,version)=>(await db`select public.erp_admin_user_profile(${user},${name},${version},'Correção cadastral solicitada') as data`)[0].data;
 assert.equal((await read()).count,2);
 const saved=await save('Nome Revisado',0);assert.equal(saved.version,1);
 await assert.rejects(save('Conflito',0),e=>e.code==='40001');
 assert.equal((await read({query:'revisado'})).rows[0].display_name,'Nome Revisado');
 assert.equal((await read({query:'%'})).count,0);
 await db`update auth.users set email_confirmed_at=now() where id=${user}`;
 assert.equal((await read({confirmation:'confirmed'})).count,1);
 assert.equal((await read({confirmation:'pending'})).count,1);
 await db`insert into erp_control.user_access(user_id,status) values(${user},'suspended')`;
 assert.equal((await read({status:'suspended'})).rows[0].id,user);
 assert.equal((await read({status:'active'})).count,1);
 const event=(await db`select * from erp_control.audit where action='user.profile' and subject_id=${user}`)[0];
 assert.equal(event.actor_id,adm);assert.equal(event.before_data,null);assert.equal(event.after_data.display_name,'Nome Revisado');assert.equal(event.entity,user);
 assert.equal((await db`select count(*)::int as n from erp_control.administrators where user_id=${user}`)[0].n,0);
 await setToken({...token,amr:[{method:'totp',timestamp:now-600}]});await read();await assert.rejects(save('Sem MFA recente',1),e=>e.code==='42501');
 await setToken({...token,aal:'aal1'});await assert.rejects(read(),e=>e.code==='42501');
 await setToken(token);await save('Nome Atualizado',1);
 assert.equal((await read({query:user})).rows[0].profile_version,2);
 const updated=(await db`select * from erp_control.audit where action='user.profile' and subject_id=${user} order by id desc limit 1`)[0];assert.equal(updated.before_data.display_name,'Nome Revisado');
 for(const f of [{status:'bad'},{confirmation:'bad'},{page:-1},{query:'x'.repeat(161)},{unknown:1}])await assert.rejects(read(f));
 await assert.rejects(save('',2));await assert.rejects(save('x'.repeat(161),2));
 await db.begin(async tx=>{await tx`set local role authenticated`;assert.equal((await tx`select public.erp_admin_users('{}') as data`)[0].data.count,2)});
 await assert.rejects(db.begin(async tx=>{await tx`set local role authenticated`;await tx`update erp_control.user_profiles set display_name='Bypass' where user_id=${user}`}),e=>e.code==='42501');
 assert.equal((await db`select has_function_privilege('anon','public.erp_admin_user_profile(uuid,text,integer,text)','execute') as allowed`)[0].allowed,false);
 await db`insert into tenant.actors(id) values(${adm})`;
 await db`insert into public.business_units(id,owner_id,name,model) values(${company},${adm},'Empresa de teste','service')`;
 await db`insert into erp_control.memberships(company_id,user_id,role,active) values(${company},${user},'finance',false)`;
 const scoped=await read({company,query:user});assert.equal(scoped.count,1);assert.equal(scoped.rows[0].memberships[0].role,'finance');assert.equal(scoped.rows[0].memberships[0].active,false);
 assert.equal((await read({company:other})).count,0);
 const second=postgres({...base,database:identity.database});
 try{
  await second`select set_config('request.jwt.claims',${JSON.stringify(token)},false)`;
  const races=await Promise.allSettled([save('Concorrente A',2),second`select public.erp_admin_user_profile(${user},'Concorrente B',2,'Correção concorrente de teste')`]);
  assert.equal(races.filter(r=>r.status==='fulfilled').length,1);assert.equal(races.find(r=>r.status==='rejected').reason.code,'40001');
  assert.equal((await db`select count(*)::int as n from erp_control.audit where action='user.profile' and subject_id=${user}`)[0].n,3);
 }finally{await second.end({timeout:1})}
 await db`insert into auth.users(id,email) select gen_random_uuid(),'page-'||i||'@example.invalid' from generate_series(1,25) i`;
 const firstPage=await read({query:'page-'}),secondPage=await read({query:'page-',page:1});
 assert.equal(firstPage.count,25);assert.equal(firstPage.rows.length,20);assert.equal(secondPage.rows.length,5);assert.equal(new Set([...firstPage.rows,...secondPage.rows].map(r=>r.id)).size,25);
 const accountCorrelation=randomUUID();
 const accountResult=(await db`select public.erp_admin_command('user.revoke',${db.json({user,company,version:1,reason:'Revogação global em teste'})},${accountCorrelation}) as data`)[0].data;
 assert.equal(accountResult.ok,true);
 const accountEvent=(await db`select * from erp_control.audit where correlation_id=${accountCorrelation}`)[0];
 assert.equal(accountEvent.company_id,null);assert.equal(accountEvent.subject_id,user);assert.equal(accountEvent.entity,user);assert.equal(accountEvent.actor_id,adm);
 assert.equal((await db`select active from erp_control.memberships where company_id=${company} and user_id=${user}`)[0].active,false);
 await db`delete from auth.sessions where id=${session}`;await assert.rejects(save('Sessão revogada',2),e=>e.code==='28000');
 console.log('PASS: perfil administrativo versionado, filtros/nome/estado/confirmação, MFA, sessão, auditoria antes/depois e privilégios restritos em PostgreSQL real.');
}finally{
 await db?.end({timeout:1});await admin.unsafe(`drop database if exists "${identity.database}" with (force)`);for(const role of [identity.runtime,identity.owner,...createdRoles])await admin.unsafe(`drop role if exists "${role}"`);await admin.end({timeout:1});
}
