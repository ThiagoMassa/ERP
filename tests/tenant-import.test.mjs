// Tests only: local disposable PostgreSQL cluster; never accepts a production URL.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {provisionTenant,tenantMigrations} from '../lib/server/tenant-database.ts';
import {tenantIdentity,tenantConnectionOptions} from '../lib/server/tenant-identity.ts';
import {importLegacyCompany} from '../lib/server/tenant-import.ts';

const password=await readFile(new URL('../work/pg-test-password',import.meta.url),'utf8');
const base={host:'127.0.0.1',port:55439,username:'erp_test_admin',password,ssl:false,max:1,prepare:false,onnotice:()=>{},connect_timeout:5};
const admin=postgres({...base,database:'postgres'});
const fixtureIds=[randomUUID(),randomUUID(),randomUUID()];
const fixtures=fixtureIds.map(tenantIdentity),secrets=fixtures.map(()=>randomBytes(36).toString('base64url'));
const opened=[];
try {
 const migrations=await tenantMigrations();
 for(let i=0;i<3;i++)await provisionTenant({companyId:fixtureIds[i],runtimePassword:secrets[i],maintenance:admin,connectMaintenanceDatabase:database=>postgres({...base,database}),migrations});
 const source=postgres({...base,database:fixtures[0].database}),target=postgres({...base,database:fixtures[1].database}),other=postgres({...base,database:fixtures[2].database});opened.push(source,target,other);
 // The source fixture has the real legacy table shapes, plus a minimal job registry.
 await source.unsafe('create schema erp_control; create table erp_control.companies(id uuid primary key,data_location text); create table erp_control.cutovers(id uuid primary key,company_id uuid,requested_by uuid,correlation_id uuid,status text)');
 const owner=randomUUID(),requester=randomUUID(),job=randomUUID(),company=fixtureIds[1],otherCompany=fixtureIds[2],product=randomUUID(),foreignProduct=randomUUID(),paid=randomUUID(),pending=randomUUID(),archived=randomUUID(),movement=randomUUID();
 await source`insert into tenant.actors(id) values(${owner}),(${requester})`;
 await source`insert into public.business_units(id,owner_id,name,model,created_at) values(${company},${owner},'Empresa migrada','printing','2024-01-02T03:04:05Z'),(${otherCompany},${owner},'Outra empresa','retail','2024-01-02T03:04:05Z')`;
 await source`insert into public.products(id,business_id,owner_id,name,category,cost,price,stock,currency,item_type,unit,min_stock,created_at) values
 (${product},${company},${owner},'Peça precisa','Peças','900719925474.0991','900719925474.1991','7.125','CLF','part','un','0.100','2024-02-03T04:05:06Z'),
 (${foreignProduct},${otherCompany},${owner},'Outro estoque','Geral','1','2','99','BRL','finished','un','0','2024-02-03T04:05:06Z')`;
 await source`insert into public.stock_movements(id,owner_id,product_id,delta,balance,note,created_at) values(${movement},${owner},${product},'100.000','100.000','Movimento histórico que não será reaplicado','2024-02-03T04:05:06Z')`;
 await source`insert into public.entries(id,owner_id,business_id,description,type,amount,date,category,status,currency,deleted_at,created_at) values
 (${paid},${owner},${company},'Recebimento exato','income','900719925474.0991','2024-03-01','Vendas','paid','CLF',null,'2024-03-01T05:06:07Z'),
 (${pending},${owner},${company},'Conta pendente','expense','75.4321','2024-03-02','Material','pending','CLF',null,'2024-03-02T05:06:07Z'),
 (${archived},${owner},${company},'Histórico arquivado','income','20.1250','2024-03-03','Vendas','paid','CLF','2024-04-01T00:00:00Z','2024-03-03T05:06:07Z')`;
 await source`insert into erp_control.companies(id,data_location) values(${company},'legacy')`;
 await source`insert into erp_control.cutovers(id,company_id,requested_by,correlation_id,status) values(${job},${company},${requester},${randomUUID()},'running')`;
 await assert.rejects(importLegacyCompany(source,target,job),e=>e.code==='SOURCE_NOT_FROZEN');
 const cutoverDDL=await readFile(new URL('../db/tenant-cutover.sql',import.meta.url),'utf8');
 const guard=cutoverDDL.match(/create function erp_control\.legacy_write_guard\(\)[\s\S]*?end \$\$;/)?.[0];assert.ok(guard);
 await source.unsafe(guard);
 for(const table of ['business_units','products','entries','stock_movements'])await source.unsafe(`create trigger tenant_cutover_write before insert or update or delete on public.${table} for each row execute function erp_control.legacy_write_guard()`);
 const freezer=postgres({...base,database:fixtures[0].database});opened.push(freezer);
 await freezer`set lock_timeout='250ms'`;
 let release,notify;const gate=new Promise(resolve=>{release=resolve}),held=new Promise(resolve=>{notify=resolve});
 const inflight=source.begin(async tx=>{await tx`update public.products set description='Gravação anterior ao corte' where id=${product}`;notify();await gate;});
 await held;
 try {await assert.rejects(freezer`update erp_control.companies set data_location='migrating' where id=${company}`,e=>e.code==='55P03');}finally{release();await inflight;}
 await source`update erp_control.companies set data_location='migrating' where id=${company}`;
 await assert.rejects(source`update public.products set stock=8 where id=${product}`,e=>e.code==='55000');
 await source`update public.products set description='Outra empresa continua operando' where id=${foreignProduct}`;
 const report=await importLegacyCompany(source,target,job);
 assert.equal(report.source_digest,report.target_digest);
 assert.deepEqual(report.counts,{businesses:1,products:1,entries:3,movements:1});
 assert.equal((await target`select stock::text as amount from public.products where id=${product}`)[0].amount,'7.125');
 assert.equal((await target`select sum(delta)::text as amount from public.erp_stock_ledger`)[0].amount,'7.125');
 assert.equal((await target`select delta::text as amount from public.stock_movements`)[0].amount,'100.000');
 assert.equal((await target`select price::text as amount from public.products`)[0].amount,'900719925474.1991');
 const payment=(await target`select amount::text as amount,actor_id,date::text as date from public.erp_payments`)[0];
 assert.deepEqual(payment,{amount:'900719925474.0991',actor_id:owner,date:'2024-03-01'});
 assert.equal((await target`select paid::text as paid from public.erp_titles where id=${archived}`)[0].paid,'0.0000');
 assert.equal((await target`select count(*)::int as n from public.erp_payments`)[0].n,1);
 assert.equal((await other`select count(*)::int as n from public.products`)[0].n,0);
 assert.deepEqual(await importLegacyCompany(source,target,job),report);
 assert.equal((await target`select count(*)::int as n from tenant.audit`)[0].n,1);
 // The copy is reconciled, but runtime dispatch remains locked until explicit activation.
 const runtime=postgres(tenantConnectionOptions(`postgres://${fixtures[1].runtime}:${secrets[1]}@127.0.0.1:55439/${fixtures[1].database}`,company,{allowLocalTest:true}));opened.push(runtime);
 await assert.rejects(runtime`select tenant.dispatch('{"epoch":"00000000-0000-0000-0000-000000000000"}','read','products','{}',null)`,e=>e.code==='55000');
 await assert.rejects(runtime`select tenant.dispatch_core('{}','read','products','{}',null)`,e=>e.code==='42501');
 await source`update erp_control.companies set data_location='legacy' where id=${company}`;
 await source`update public.products set name='Origem alterada indevidamente' where id=${product}`;
 await source`update erp_control.companies set data_location='migrating' where id=${company}`;
 await assert.rejects(importLegacyCompany(source,target,job),e=>e.code==='SOURCE_CHANGED');
 assert.equal((await target`select name from public.products`)[0].name,'Peça precisa');
 // A target error half-way through a separate company's import rolls back all copied rows.
 const otherJob=randomUUID();
 await source`update public.products set item_type='service' where id=${foreignProduct}`;
 await source`insert into erp_control.companies(id,data_location) values(${otherCompany},'migrating')`;
 await source`insert into erp_control.cutovers(id,company_id,requested_by,correlation_id,status) values(${otherJob},${otherCompany},${requester},${randomUUID()},'running')`;
 await assert.rejects(importLegacyCompany(source,other,otherJob),e=>e.code==='RECONCILIATION_FAILED');
 for(const table of ['business_units','products','entries','erp_titles'])assert.equal((await other`select count(*)::int as n from ${other('public.'+table)}`)[0].n,0);
 assert.equal((await other`select count(*)::int as n from tenant.reconciliations`)[0].n,0);
 console.log('PASS: corte espera gravação concorrente; escrita congelada e outra empresa preservada; cópia isolada; precisão decimal além de Number; autoria/datas; histórico sem replay; arquivados sem receita; conciliação; retry; origem alterada recusada; rollback; destino bloqueado até ativação.');
} finally {
 await Promise.all(opened.map(s=>s.end({timeout:1})));
 for(const f of fixtures){await admin.unsafe(`drop database if exists "${f.database}" with (force)`);await admin.unsafe(`drop role if exists "${f.runtime}"`);await admin.unsafe(`drop role if exists "${f.owner}"`);}
 await admin.end({timeout:1});
}
