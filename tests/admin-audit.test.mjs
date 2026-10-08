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
 for(const file of ['admin-control','admin-audit'])await db.unsafe(await readFile(new URL('../db/'+file+'.sql',import.meta.url),'utf8'));
 // The disposable tenant starts stricter than Supabase's central exposed schema.
 await db`grant usage on schema public to authenticated`;
 const adm=randomUUID(),user=randomUUID(),session=randomUUID(),company=randomUUID(),other=randomUUID(),affected=randomUUID(),now=Math.floor(Date.now()/1000);
 await db`insert into auth.users(id,email) values(${adm},'audit@example.invalid'),(${user},'reader@example.invalid')`;
 await db`insert into auth.sessions(id,user_id,created_at,aal) values(${session},${adm},now(),'aal2')`;
 await db`insert into auth.mfa_factors(id,user_id,status) values(${randomUUID()},${adm},'verified')`;
 await db`insert into erp_control.administrators(user_id) values(${adm})`;
 const token={sub:adm,session_id:session,iat:now,exp:now+3600,aal:'aal2',amr:[{method:'totp',timestamp:now}]};
 const setToken=async value=>db`select set_config('request.jwt.claims',${JSON.stringify(value)},false)`;
 await setToken(token);
 const filters={from:'2026-09-01',to:'2026-09-30',company,action:'fixture.'};
 const search=async(f=filters,exp=false)=>(await db`select public.erp_admin_audit(${db.json(f)},${exp}) as data`)[0].data;
 // Bigint IDs must remain exact through JSON and cursor pagination.
 await db`select setval('erp_control.audit_id_seq',9007199254740993,false)`;
 await db`insert into erp_control.audit(occurred_at,actor_id,company_id,subject_id,action,entity,result,reason) select '2026-09-15T12:00:00Z'::timestamptz,${adm},${company},${affected},'fixture.update',i::text,'success','Motivo de teste' from generate_series(1,55) i`;
 await db`insert into erp_control.audit(occurred_at,actor_id,company_id,subject_id,action,entity,result) values('2026-09-15',${user},${other},${affected},'fixture.foreign','foreign','failed'),('2026-10-01T00:00:00Z',${adm},${company},${affected},'fixture.outside','outside','success')`;
 const first=await search();assert.equal(first.rows.length,50);assert.equal(typeof first.rows[0].id,'string');assert.ok(BigInt(first.rows[0].id)>BigInt(Number.MAX_SAFE_INTEGER));assert.ok(first.next);
 await db`insert into erp_control.audit(occurred_at,actor_id,company_id,action,result) values('2026-09-16',${adm},${company},'fixture.later','success')`;
 const second=await search({...filters,upper:first.upper,before:first.next});assert.equal(second.rows.length,5);assert.equal(second.next,null);
 assert.equal(new Set([...first.rows,...second.rows].map(r=>r.id)).size,55);
 const exact=await search({...filters,actor:adm,subject:affected,entity:'1',result:'success'});assert.equal(exact.rows.length,1);
 assert.equal((await search({...filters,result:'failed'})).rows.length,0);
 assert.equal((await search({...filters,company:other})).rows.length,1);
 for(const invalid of [{...filters,result:'unknown'},{...filters,from:'2026-02-30'},{...filters,to:'2028-01-01'},{...filters,unexpected:true},{...filters,before:'0'}])await assert.rejects(search(invalid));
 await setToken({...token,aal:'aal1'});await assert.rejects(search(),e=>e.code==='42501');
 await setToken({...token,amr:[{method:'totp',timestamp:now-600}]});await search();await assert.rejects(search(filters,true),e=>e.code==='42501');
 await setToken(token);await db`update erp_control.administrators set active=false where user_id=${adm}`;await assert.rejects(search(),e=>e.code==='42501');await db`update erp_control.administrators set active=true where user_id=${adm}`;
 const exported=await search({...filters,upper:first.upper},true);assert.equal(exported.rows.length,55);
 await db.begin(async tx=>{await tx`set local role authenticated`;const read=(await tx`select public.erp_admin_audit(${tx.json({...filters,entity:'1'})},false) as data`)[0].data;assert.equal(read.rows.length,1)});
 await assert.rejects(db.begin(async tx=>{await tx`set local role authenticated`;await tx`update erp_control.audit set reason='Tentativa indevida' where entity='1'`}),e=>e.code==='42501');
 assert.equal((await db`select actor_id from erp_control.audit where action='audit.export' and correlation_id=${exported.correlation}`)[0].actor_id,adm);
 assert.ok(exported.rows.every(r=>r.action.startsWith('fixture.')&&r.company_id===company));
 await db`insert into erp_control.audit(occurred_at,actor_id,company_id,action,result) select '2026-09-17'::timestamptz,${adm},${company},'large.fixture','success' from generate_series(1,5001)`;
 await assert.rejects(search({...filters,action:'large.fixture'},true),/5000/);
 assert.equal((await db`select has_function_privilege('anon','public.erp_admin_audit(jsonb,boolean)','execute') as allowed`)[0].allowed,false);
 await db`select set_config('request.jwt.claims',${JSON.stringify(token)},false)`;
 await db`delete from auth.sessions where id=${session}`;await assert.rejects(search(),e=>e.code==='28000');
 console.log('PASS: filtros combinados/UTC, IDs bigint exatos, paginação sem duplicar, limite superior, ADM/MFA/sessão, exportação completa auditada e excesso recusado sem truncar.');
}finally{
 await db?.end({timeout:1});await admin.unsafe(`drop database if exists "${identity.database}" with (force)`);for(const role of [identity.runtime,identity.owner,...createdRoles])await admin.unsafe(`drop role if exists "${role}"`);await admin.end({timeout:1});
}
