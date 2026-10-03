// Disposable Linux cluster only. The migration operator has no cluster creation rights.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import postgres from 'postgres';
import {tenantIdentity} from '../lib/server/tenant-identity.ts';
import {provisionTenant,tenantMigrations,inspectTenant,assertTenantStructure} from '../lib/server/tenant-database.ts';

const password=await readFile(new URL('../work/pg-test-password',import.meta.url),'utf8');
const base={host:'127.0.0.1',port:55439,username:'erp_test_admin',password,ssl:false,max:1,prepare:false,onnotice:()=>{}};
const admin=postgres({...base,database:'postgres'}),id=randomUUID(),identity=tenantIdentity(id);
const operator='manual_'+id.replaceAll('-',''),secret=randomBytes(36).toString('base64url'),operatorSecret=randomBytes(36).toString('base64url');
const q=s=>'"'+s.replaceAll('"','""')+'"';
let control,target,baseline;
try {
 assert.equal((await admin`select current_user as name`)[0].name,'erp_test_admin');
 baseline=await admin`select datname from pg_database d where d.datallowconn and exists(select 1 from aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a where a.grantee=0 and a.privilege_type='CONNECT')`;
 for(const d of baseline)await admin.unsafe(`revoke connect on database ${q(d.datname)} from public`);
 await admin.unsafe(`create role ${q(operator)} login nosuperuser nocreatedb nocreaterole noinherit password '${operatorSecret}'`);
 await admin.unsafe(`grant connect on database postgres to ${q(operator)}`);
 const settings={...base,username:operator,password:operatorSecret};
 control=postgres({...settings,database:'postgres'});
 const migrations=await tenantMigrations();
 const options={companyId:id,existingOnly:true,runtimePassword:secret,maintenance:control,connectMaintenanceDatabase:database=>postgres({...settings,database}),migrations};
 await assert.rejects(provisionTenant(options),e=>e.code==='MANUAL_SETUP_MISSING');
 assert.equal((await admin`select 1 from pg_roles where rolname=${identity.owner} or rolname=${identity.runtime}`).length,0);
 await admin.unsafe(`create role ${q(identity.owner)} nologin nosuperuser nocreatedb nocreaterole noinherit`);
 await admin.unsafe(`grant ${q(identity.owner)} to ${q(operator)} with set true`);
 await admin.unsafe(`create role ${q(identity.runtime)} login nosuperuser nocreatedb nocreaterole noinherit password '${secret}'`);
 await assert.rejects(provisionTenant(options),e=>e.code==='MANUAL_SETUP_MISSING');
 assert.equal((await admin`select 1 from pg_database where datname=${identity.database}`).length,0);
 await admin.unsafe(`create database ${q(identity.database)} owner ${q(identity.owner)} template template0`);
 await admin.unsafe(`grant connect on database ${q(identity.database)} to ${q(operator)}`);
 // Defaults are not silently repaired in existing-only mode.
 await assert.rejects(provisionTenant(options),e=>e.code==='MANUAL_SETUP_UNSAFE');
 await admin.unsafe(`revoke all on database ${q(identity.database)} from public`);
 await admin.unsafe(`grant connect on database ${q(identity.database)} to ${q(identity.runtime)}`);
 await admin.unsafe(`alter database ${q(identity.database)} owner to erp_test_admin`);
 await assert.rejects(provisionTenant(options),e=>e.code==='DATABASE_CONFLICT');
 await admin.unsafe(`alter database ${q(identity.database)} owner to ${q(identity.owner)}`);
 target=postgres({...base,database:identity.database});
 await target`create table public.unrelated(id integer)`;
 await assert.rejects(provisionTenant(options),e=>e.code==='NONEMPTY_DATABASE');
 assert.ok((await target`select to_regclass('public.unrelated') as name`)[0].name);
 await target`drop table public.unrelated`;
 // A failed migration must leave the reserved database empty and retryable.
 const badSQL='create table public.should_rollback(id integer); select missing_manual_fixture_function();';
 const bad={version:'009-failure',sql:badSQL,checksum:createHash('sha256').update(badSQL).digest('hex')};
 await assert.rejects(provisionTenant({...options,migrations:[...migrations,bad]}),e=>e.code==='42883');
 assert.equal((await target`select to_regclass('tenant.identity') as name`)[0].name,null);
 assert.equal((await target`select to_regclass('public.should_rollback') as name`)[0].name,null);
 const before=await admin`select rolname,rolpassword from pg_authid where rolname=${identity.runtime}`;
 const acl=await admin`select datacl::text from pg_database where datname=${identity.database}`;
 const result=await provisionTenant(options);
 assert.equal(result.state,'awaiting-engine-and-reconciliation');
 await provisionTenant(options);
 assert.deepEqual(await admin`select rolname,rolpassword from pg_authid where rolname=${identity.runtime}`,before);
 assert.deepEqual(await admin`select datacl::text from pg_database where datname=${identity.database}`,acl);
 const health=await inspectTenant(`postgres://${identity.runtime}:${secret}@127.0.0.1:55439/${identity.database}`,id,{allowLocalTest:true});
 assertTenantStructure(health,migrations);
 assert.equal(health.reconciled,false);
 assert.equal(health.operational_state,'preparing');
 assert.equal((await target`select count(*)::int as n from tenant.migrations`)[0].n,migrations.length);
 console.log('PASS: manual infrastructure migrated by non-superuser without CREATEDB/CREATEROLE; missing resources, unsafe ACLs, wrong owner and occupied databases rejected; migration failure rolled back; retry preserved roles/password/ACLs and did not activate the company.');
} finally {
 await control?.end({timeout:1});await target?.end({timeout:1});
 await admin.unsafe(`drop database if exists ${q(identity.database)} with (force)`);
 await admin.unsafe(`revoke connect on database postgres from ${q(operator)}`).catch(()=>{});
 for(const role of [identity.runtime,operator,identity.owner])await admin.unsafe(`drop role if exists ${q(role)}`);
 for(const d of baseline||[])await admin.unsafe(`grant connect on database ${q(d.datname)} to public`);
 await admin.end({timeout:1});
}
