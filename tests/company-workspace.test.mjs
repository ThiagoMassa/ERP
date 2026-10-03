// Local disposable PostgreSQL only. Uses the real control SQL and cutover worker.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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
 await control.unsafe(await file('db/company-workspace.sql'));
 const owner=randomUUID(),session=randomUUID(),factor=randomUUID(),productA=randomUUID(),productB=randomUUID();
 await control`insert into auth.users(id,email) values(${owner},'operator@example.invalid')`;
 await control`insert into tenant.actors(id) values(${owner})`;
 await control`insert into erp_control.administrators(user_id) values(${owner})`;
 await control`insert into auth.mfa_factors(id,user_id,status) values(${factor},${owner},'verified')`;
 await control`insert into auth.sessions(id,user_id,created_at,aal,factor_id) values(${session},${owner},now(),'aal2',${factor})`;
 const now=Math.floor(Date.now()/1000),token={sub:owner,session_id:session,iat:now,exp:now+3600,aal:'aal2',amr:[{method:'totp',timestamp:now}]};
 await control`select set_config('request.jwt.claims',${JSON.stringify(token)},false)`;
 const command=async(company,action,data,key=randomUUID())=>(await control`select public.erp_workspace_command(${company},${action},${control.json(data)},${key}) as data`)[0].data;
 const read=async(company,module,filters={})=>(await control`select public.erp_workspace_read(${company},${module},${control.json(filters)}) as data`)[0].data;
 const details={name:'Ateliê A',model:'printing',description:'Peças personalizadas',contact_email:'store@example.invalid',phone:''};
 const created=await command(null,'business.save',details,ids[1]);
 assert.equal(created.id,ids[1]);assert.equal(created.provisioning,'pending');assert.equal(created.version,1);
 assert.deepEqual(await command(null,'business.save',details,ids[1]),created);
 await assert.rejects(command(null,'business.save',{...details,name:'Nome diferente'},ids[1]),/outra operação/);
 await command(null,'business.save',{...details,name:'Empresa B',model:'retail'},ids[2]);
 const businesses=await read(null,'businesses',{size:1});assert.equal(businesses.count,2);assert.equal(businesses.rows.length,1);
 assert.equal((await read(null,'businesses',{page:1,size:1})).rows.length,1);
 assert.equal((await read(null,'businesses',{query:'Ateliê'})).count,1);
 assert.equal(JSON.stringify(businesses).includes('credential_ref'),false);
 await assert.rejects(control.begin(async tx=>{await tx.unsafe('set local role authenticated');await tx`update public.business_units set name='Sem versão' where id=${ids[1]}`;}),e=>e.code==='42501');
 await control`insert into erp_control.permissions(company_id,scope,subject,module,action,allowed) values(${ids[1]},'company','*','settings','create',false)`;
 await assert.rejects(command(null,'business.save',details,ids[1]),e=>e.code==='42501');
 await control`delete from erp_control.permissions where company_id=${ids[1]}`;
 // Membership changes grant access to the existing company, never provision a new DB.
 const member=randomUUID(),memberSession=randomUUID();
 await control`insert into auth.users(id,email) values(${member},'member@example.invalid')`;
 await control`insert into auth.sessions(id,user_id,created_at,aal) values(${memberSession},${member},now(),'aal1')`;
 const countBefore=(await admin`select count(*)::int as n from pg_database`)[0].n;
 await command(ids[1],'member.save',{email:'member@example.invalid',role:'read',active:true,version:0});
 await command(ids[2],'member.save',{email:'member@example.invalid',role:'sales',active:true,version:0});
 assert.equal((await admin`select count(*)::int as n from pg_database`)[0].n,countBefore);
 const memberRow=(await read(ids[1],'members',{query:'member@',size:1})).rows[0];assert.equal(memberRow.id,member);assert.equal(memberRow.version,1);
 await assert.rejects(command(ids[1],'member.save',{email:'member@example.invalid',role:'finance',active:true,version:0}),e=>e.code==='40001');
 const memberToken={...token,sub:member,session_id:memberSession,aal:'aal1',amr:[]};
 await control`select set_config('request.jwt.claims',${JSON.stringify(memberToken)},false)`;
 assert.equal((await read(null,'businesses')).count,2);
 await assert.rejects(command(ids[1],'business.save',{...details,version:1}),e=>e.code==='42501');
 await assert.rejects(read(ids[1],'members'),e=>e.code==='42501');
 await assert.rejects(read(randomUUID(),'permissions'),e=>e.code==='42501');
 await control`select set_config('request.jwt.claims',${JSON.stringify(token)},false)`;
 await command(ids[1],'member.save',{email:'member@example.invalid',role:'read',active:false,version:1});
 await control`select set_config('request.jwt.claims',${JSON.stringify(memberToken)},false)`;
 assert.equal((await read(null,'businesses')).count,1);
 await assert.rejects(read(ids[1],'permissions'),e=>e.code==='42501');
 assert.equal((await read(ids[2],'permissions')).catalog.read.allowed,true);
 await control`select set_config('request.jwt.claims',${JSON.stringify(token)},false)`;
 // Metadata updates remain central after migration; operational legacy stays frozen.
 await control`insert into public.products(id,owner_id,business_id,name,category,cost,price,stock) values(${productA},${owner},${ids[1]},'A','Peças',1,2,5)`;
 const migration=(await control`select public.erp_request_cutover(${ids[1]},1,'Migração de teste para o banco exclusivo',${randomUUID()}) as data`)[0].data.job_id;
 await assert.rejects(command(ids[1],'business.save',{...details,name:'Durante o corte',version:2}),e=>e.code==='55000');
 await runTenantCutover({control,target:a,runtimeConnection:runtimeUrl(1),jobId:migration,allowLocalTest:true});
 const version=(await control`select version from erp_control.companies where id=${ids[1]}`)[0].version;
 const updated=await command(ids[1],'business.save',{...details,name:'Ateliê A atualizado',version});
 assert.equal((await read(null,'businesses',{query:'atualizado'})).rows[0].version,updated.version);
 await assert.rejects(command(ids[1],'business.save',{...details,version}),e=>e.code==='40001');
 await assert.rejects(control`update public.products set stock=6 where id=${productA}`,e=>e.code==='55000');
 assert.equal((await a`select stock::text as stock from public.products where id=${productA}`)[0].stock,'5.000');
 const archiveKey=randomUUID(),archive={version:updated.version};
 await command(ids[1],'business.archive',archive,archiveKey);
 assert.equal((await command(ids[1],'business.archive',archive,archiveKey)).id,ids[1]);
 await assert.rejects(control`select public.erp_tenant_context(${ids[1]})`,e=>e.code==='42501');
 const archived=(await read(null,'businesses',{query:'atualizado'})).rows[0];assert.ok(archived.deleted_at);
 await command(ids[1],'business.restore',{version:archived.version});
 assert.equal((await control`select public.erp_tenant_context(${ids[1]}) as data`)[0].data.provisioning,'ready');
 assert.equal((await a`select count(*)::int as n from public.products`)[0].n,1);
 assert.equal((await b`select count(*)::int as n from public.products`)[0].n,0);
 assert.ok((await control`select count(*)::int as n from erp_control.audit where action='workspace.business.save' and company_id=${ids[1]} and before_data is not null and after_data->>'name'='Ateliê A atualizado'`)[0].n===1);
 await control`insert into erp_control.user_access(user_id,status) values(${owner},'blocked')`;
 await assert.rejects(read(null,'businesses'),e=>e.code==='28000');
 console.log('PASS: cadastro central paginado, criação pendente/idempotente, versão concorrente, acesso direto negado, bloqueio supera retry, vínculos sem novo banco, revogação por empresa, corte/edição de metadados, legado congelado, arquivo/restauração sem apagar operações e auditoria antes/depois.');
}finally{
 await Promise.all(opened.map(sql=>sql.end({timeout:1})));
 for(const f of fixtures){await admin.unsafe(`drop database if exists "${f.database}" with (force)`);await admin.unsafe(`drop role if exists "${f.runtime}"`);await admin.unsafe(`drop role if exists "${f.owner}"`);}
 for(const role of createdRoles)await admin.unsafe(`drop role ${role}`);
 await admin.end({timeout:1});
}
