// Integration test: isolated local PostgreSQL cluster only; no production URL is accepted.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import postgres from 'postgres';
import {provisionTenant,kernelMigration,tenantMigrations,inspectTenant,assertTenantReady} from '../lib/server/tenant-database.ts';
import {tenantIdentity,tenantConnectionOptions} from '../lib/server/tenant-identity.ts';

const password=await readFile(new URL('../work/pg-test-password',import.meta.url),'utf8');
const base={host:'127.0.0.1',port:55439,username:'erp_test_admin',password,ssl:false,max:1,prepare:false,onnotice:()=>{},connect_timeout:5};
const admin=postgres({...base,database:'postgres'});
const fixtureIds=[randomUUID(),randomUUID()];
const runtimePasswords=fixtureIds.map(()=>randomBytes(36).toString('base64url'));
const fixtures=fixtureIds.map(tenantIdentity);
const migration=await kernelMigration();
const opened=[];
const runtimeUrl=(n,database=fixtures[n].database)=>`postgres://${fixtures[n].runtime}:${runtimePasswords[n]}@127.0.0.1:55439/${database}`;
const provision=n=>provisionTenant({companyId:fixtureIds[n],runtimePassword:runtimePasswords[n],maintenance:admin,connectMaintenanceDatabase:database=>postgres({...base,database}),migrations:[migration]});
try {
  assert.equal((await admin`select current_user as name`)[0].name,'erp_test_admin');
  // Test-cluster defaults only; production database privileges must be inventoried separately.
  await admin.unsafe('revoke connect on database postgres from public');
  await admin.unsafe('revoke connect on database template1 from public');
  await provision(0);await provision(1);
  const a=postgres(tenantConnectionOptions(runtimeUrl(0),fixtureIds[0],{allowLocalTest:true}));opened.push(a);
  const first=await inspectTenant(runtimeUrl(0),fixtureIds[0],{allowLocalTest:true});
  const second=await inspectTenant(runtimeUrl(1),fixtureIds[1],{allowLocalTest:true});
  assert.notEqual(first.database,second.database);
  assert.equal(first.migrations.length,1);
  assert.equal(first.engine_installed,false);
  assert.equal(first.runtime_restricted,true);
  assert.throws(()=>assertTenantReady(first,[migration]),/não liberado/);
  await provision(0);
  const repeated=await inspectTenant(runtimeUrl(0),fixtureIds[0],{allowLocalTest:true});
  assert.deepEqual(repeated,first);
  assert.equal((await admin`select count(*)::int as n from pg_database where datname in (${fixtures[0].database},${fixtures[1].database})`)[0].n,2);
  for(const statement of ['select * from tenant.identity','update tenant.identity set database_name=\'forged\'','delete from tenant.migrations','create table public.forbidden(id int)',`set role "${fixtures[0].owner}"`]) {
    await assert.rejects(a.unsafe(statement),e=>e.code==='42501');
  }
  // PostgreSQL itself rejects a role from A connecting to B, before any ERP code executes.
  for(const database of [fixtures[1].database,'postgres']) {
    const wrong=postgres({...base,username:fixtures[0].runtime,password:runtimePasswords[0],database});
    try {await assert.rejects(wrong`select current_database()`,e=>e.code==='42501');} finally {await wrong.end({timeout:1});}
  }
  await assert.rejects(inspectTenant(runtimeUrl(0),fixtureIds[1],{allowLocalTest:true}),e=>e.code==='IDENTITY_MISMATCH');
  const changed={...migration,sql:migration.sql+'\n-- edited immutable migration'};changed.checksum=createHash('sha256').update(changed.sql).digest('hex');
  await assert.rejects(provisionTenant({companyId:fixtureIds[0],runtimePassword:runtimePasswords[0],maintenance:admin,connectMaintenanceDatabase:database=>postgres({...base,database}),migrations:[changed]}),e=>e.code==='MIGRATION_CHANGED');
  // Failing a migration must roll back both its DDL and migration ledger.
  const failedSql='create table tenant.should_rollback(id int); select no_such_function();';
  const failed={version:'002-failure',sql:failedSql,checksum:createHash('sha256').update(failedSql).digest('hex')};
  await assert.rejects(provisionTenant({companyId:fixtureIds[0],runtimePassword:runtimePasswords[0],maintenance:admin,connectMaintenanceDatabase:database=>postgres({...base,database}),migrations:[migration,failed]}));
  const inspect=postgres({...base,database:fixtures[0].database});opened.push(inspect);
  assert.equal((await inspect`select to_regclass('tenant.should_rollback') is null as absent`)[0].absent,true);
  assert.equal((await inspect`select count(*)::int as n from tenant.migrations`)[0].n,1);
  console.log('PASS: dois bancos reais; credenciais exclusivas; acesso cruzado negado; repetição sem duplicação; tabelas privadas; rollback de migração; kernel não declarado pronto.');
  const migrations=await tenantMigrations();
  for(let n=0;n<2;n++)await provisionTenant({companyId:fixtureIds[n],runtimePassword:runtimePasswords[n],maintenance:admin,connectMaintenanceDatabase:database=>postgres({...base,database}),migrations});
  const actor=randomUUID(),colleague=randomUUID();
  await inspect`insert into tenant.actors(id) values(${actor}),(${colleague})`;
  await inspect`insert into public.business_units(id,owner_id,name,model) values(${fixtureIds[0]},${actor},'Empresa A','printing')`;
  await inspect`insert into public.erp_warehouses(business_id,name) values(${fixtureIds[0]},'Principal')`;
  await inspect`update tenant.identity set operational_state='active'`;
  const permissions=Object.fromEntries(['overview','sales','purchases','catalog','stock','finance','production','settings'].map(m=>[m,Object.fromEntries(['available','visible','read','create','edit','delete','approve','cancel','reverse','export'].map(v=>[v,{allowed:true,origin:'Teste de contexto autorizado pelo servidor'}]))]));
  function context(user=actor){return {actor:user,company:fixtureIds[0],epoch:'00000000-0000-0000-0000-000000000000',expires_at:new Date(Date.now()+25000).toISOString(),permissions};}
  async function dispatch(mode,operation,data={},ctx=context(),key=randomUUID()) {return (await a`select tenant.dispatch(${a.json(ctx)},${mode},${operation},${a.json(data)},${key}) as result`)[0].result;}
  const product=(await dispatch('command','product.save',{name:'Peça impressa',item_type:'finished',unit:'un',currency:'BRL',cost:10,price:25,stock:5})).id;
  assert.equal((await dispatch('read','products',{},context(colleague))).rows[0].id,product);
  const warehouse=(await dispatch('read','lookups')).warehouses[0].id;
  const stockKey=randomUUID();
  const adjustment={product_id:product,warehouse_id:warehouse,quantity:-2,reason:'Separação de peças'};
  await dispatch('command','stock.adjust',adjustment,context(),stockKey);
  await dispatch('command','stock.adjust',adjustment,context(),stockKey);
  assert.equal(Number((await dispatch('read','products')).rows[0].stock),3);
  const partner=(await dispatch('command','partner.save',{name:'Cliente',customer:true,supplier:true})).id;
  const account=(await dispatch('command','account.save',{name:'Banco',currency:'BRL',kind:'bank'})).id;
  const date=new Date().toISOString().slice(0,10);
  const sale=(await dispatch('command','order.save',{kind:'sale',partner_id:partner,currency:'BRL',date,due_date:date,installments:1,interval_days:30,items:[{product_id:product,quantity:2,price:25,discount:0}]})).id;
  await dispatch('command','order.confirm',{id:sale});
  const order=await dispatch('read','order_detail',{id:sale});
  const fulfillment=(await dispatch('command','order.fulfill',{id:sale,warehouse_id:warehouse,items:[{line_id:order.items[0].id,quantity:2}]})).fulfillment_id;
  assert.equal(Number((await dispatch('read','products')).rows[0].stock),1);
  const payment=(await dispatch('command','payment.save',{title_id:order.titles[0].id,account_id:account,amount:10,date})).id;
  assert.equal(Number((await dispatch('read','title_detail',{id:order.titles[0].id})).paid),10);
  await dispatch('command','payment.reverse',{id:payment,reason:'Correção de recebimento'});
  assert.equal(Number((await dispatch('read','title_detail',{id:order.titles[0].id})).paid),0);
  await dispatch('command','fulfillment.reverse',{id:fulfillment,reason:'Correção de atendimento'});
  assert.equal(Number((await dispatch('read','products')).rows[0].stock),3);
  const material=(await dispatch('command','product.save',{name:'PLA',item_type:'material',unit:'g',currency:'BRL',cost:0.1,price:0.2,stock:1000})).id;
  const spool=(await dispatch('command','spool.save',{name:'Bobina PLA',product_id:material,warehouse_id:warehouse,remaining_g:1000})).id;
  const printer=(await dispatch('command','printer.save',{name:'A1 bancada',model:'A1',nozzle:0.4,watts:100,hourly_cost:2,maintenance_hours:500})).id;
  const job=(await dispatch('command','job.save',{name:'Lote',product_id:product,printer_id:printer,spool_id:spool,quantity:2,estimated_g:200,estimated_hours:3,kwh_price:1,due_date:date})).id;
  await dispatch('command','job.start',{id:job});
  await dispatch('command','job.finish',{id:job,actual_g:220,actual_hours:4,good_quantity:2,warehouse_id:warehouse});
  const inventory=(await dispatch('read','products')).rows;
  assert.equal(Number(inventory.find(p=>p.id===material).stock),780);
  assert.equal(Number(inventory.find(p=>p.id===product).stock),5);
  await assert.rejects(dispatch('command','stock.adjust',{...adjustment,quantity:-6}),/insuficiente/i);
  assert.equal(Number((await dispatch('read','products')).rows.find(p=>p.id===product).stock),5);
  const blocked=context();blocked.permissions=structuredClone(permissions);blocked.permissions.stock.available.allowed=false;
  await assert.rejects(dispatch('command','stock.adjust',adjustment,blocked,stockKey),e=>e.code==='42501');
  await assert.rejects(dispatch('read','products',{}, {...context(),company:fixtureIds[1]}),e=>e.code==='42501');
  await assert.rejects(dispatch('read','products',{}, {...context(),expires_at:new Date(Date.now()-1000).toISOString()}),e=>e.code==='28000');
  await assert.rejects(a`select erp_private.command_core(${fixtureIds[0]},'product.archive',${a.json({id:product})},${randomUUID()})`,e=>e.code==='42501');
  const migrated=await inspectTenant(runtimeUrl(0),fixtureIds[0],{allowLocalTest:true});
  assert.equal(migrated.engine_installed,true);
  assert.equal(migrated.reconciled,false);
  assert.throws(()=>assertTenantReady(migrated,migrations),/não liberado/);
  await provisionTenant({companyId:fixtureIds[0],runtimePassword:runtimePasswords[0],maintenance:admin,connectMaintenanceDatabase:database=>postgres({...base,database}),migrations});
  assert.equal(Number((await dispatch('read','products')).rows.find(p=>p.id===product).stock),5);
  console.log('PASS: motor operacional exclusivo; dois autores compartilham dados; estoque idempotente; venda, pagamento parcial e estornos; produção 3D; rollback; política atual vence retry; contexto trocado/expirado negado; migração repetida preserva registros.');
} finally {
  await Promise.all(opened.map(sql=>sql.end({timeout:1})));
  // Drop only names derived from UUIDs created by this invocation, never a supplied database.
  for(const f of fixtures) {
    await admin.unsafe(`drop database if exists "${f.database}" with (force)`);
    await admin.unsafe(`drop role if exists "${f.runtime}"`);
    await admin.unsafe(`drop role if exists "${f.owner}"`);
  }
  await admin.end({timeout:1});
}
