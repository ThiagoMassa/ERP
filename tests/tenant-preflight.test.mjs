import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import postgres from 'postgres';
import {tenantIdentity} from '../lib/server/tenant-identity.ts';
import {tenantPreflight,assertProvisionPreflight} from '../lib/server/tenant-preflight.ts';

const password=await readFile(new URL('../work/pg-test-password',import.meta.url),'utf8');
const sql=postgres({host:'127.0.0.1',port:55439,username:'erp_test_admin',password,database:'postgres',ssl:false,max:1,prepare:false,onnotice:()=>{}});
const id=randomUUID(),identity=tenantIdentity(id);
try {
 assert.equal((await sql`select current_user as name`)[0].name,'erp_test_admin');
 // Every fixture mutation is rolled back. The inspected function is read-only.
 await sql.begin(async tx=>{
  const baseline=await tx`select datname,datacl::text from pg_database order by datname`;
  await tx.unsafe('grant connect on database template1 to public');
  const inspect=()=>tenantPreflight(tx,id);
  const blocked=await inspect();
  assert.equal(blocked.ready,false);
  assert.ok(blocked.connection_conflicts.some(d=>d.database==='template1'&&d.public_connect));
  assert.throws(()=>assertProvisionPreflight(blocked),e=>e.code==='UNSAFE_CLUSTER');
  assert.equal((await tx`select 1 from pg_roles where rolname=${identity.runtime} or rolname=${identity.owner}`).length,0);
  assert.equal((await tx`select 1 from pg_database where datname=${identity.database}`).length,0);
  for(const row of await tx`select datname from pg_database where datallowconn`) {
   await tx.unsafe(`revoke connect on database "${row.datname.replaceAll('"','""')}" from public`);
  }
  const allowed=await inspect();
  assert.equal(allowed.can_attempt_automatic_provisioning,true);
  assert.equal(allowed.ready,false);
  assertProvisionPreflight(allowed);
  await tx.unsafe(`create role "${identity.runtime}" nologin`);
  await tx.unsafe(`grant connect on database postgres to "${identity.runtime}"`);
  const direct=await inspect();
  assert.ok(direct.connection_conflicts.some(d=>d.database==='postgres'&&!d.public_connect&&d.runtime_connect));
  assert.throws(()=>assertProvisionPreflight(direct),e=>e.code==='UNSAFE_CLUSTER');
  const beforeRead=await tx`select datname,datacl::text from pg_database order by datname`;
  await inspect();
  assert.deepEqual(await tx`select datname,datacl::text from pg_database order by datname`,beforeRead);
  assert.ok(baseline.length>0);
  // An operator without CREATEDB/CREATEROLE must receive the manual path.
  await tx.unsafe(`revoke connect on database postgres from "${identity.runtime}"`);
  await tx.unsafe(`set local role "${identity.runtime}"`);
  const manual=await inspect();
  assert.equal(manual.connection_conflicts.length,0);
  assert.equal(manual.can_attempt_automatic_provisioning,false);
  assert.throws(()=>assertProvisionPreflight(manual),e=>e.code==='MANUAL_PROVISIONING_REQUIRED');
  await tx.unsafe('reset role');
  throw new Error('ROLLBACK_FIXTURE');
 }).catch(e=>{if(e.message!=='ROLLBACK_FIXTURE')throw e});
 assert.equal((await sql`select 1 from pg_roles where rolname=${identity.runtime}`).length,0);
 console.log('PASS: preflight detects PUBLIC and direct CONNECT, makes no catalog changes, separates manual provisioning, and never declares a company ready.');
}finally{await sql.end({timeout:2})}
