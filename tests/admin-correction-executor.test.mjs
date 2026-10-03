// Auth/network are mocked; verify the server-only routing and context boundary.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {tenantIdentity} from '../lib/server/tenant-identity.ts';
const company='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',identity=tenantIdentity(company);
const original=new Map(['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY',identity.credentialRef].map(key=>[key,process.env[key]]));
const hooks=registerHooks({resolve(specifier,context,next){
 const data=source=>({url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true});
 if(specifier==='server-only')return data('export {}');
 if(specifier==='@supabase/supabase-js')return data('export const createClient=()=>globalThis.correctionControl');
 if(specifier==='postgres')return data('const postgres=()=>globalThis.correctionSql;postgres.PostgresError=class extends Error {};export default postgres;');
 if(specifier==='./tenant-database')return data('export const inspectTenant=async()=>({});export const assertTenantReady=()=>{};export const tenantMigrations=async()=>[];');
 if(['./tenant-identity','../admin-records'].includes(specifier))return {url:pathToFileURL(resolve(specifier==='./tenant-identity'?'lib/server/tenant-identity.ts':'lib/admin-records.ts')).href,shortCircuit:true};
 return next(specifier,context);
}});
try{
 process.env.SUPABASE_URL='https://fixture.invalid';process.env.SUPABASE_PUBLISHABLE_KEY='fixture';process.env[identity.credentialRef]=`postgres://${identity.runtime}:fixture@db.example.invalid/${identity.database}`;
 const calls=[],dispatched=[];
 let context={actor,company,provisioning:'ready',database_identity:identity.database,credential_ref:identity.credentialRef,access_epoch:company,expires_at:new Date(Date.now()+25000).toISOString(),permissions:{catalog:{available:{allowed:true},edit:{allowed:true}}},administrative:true,admin_action:'admin.product.correct'},authError=null;
 globalThis.correctionControl={auth:{getUser:async()=>({data:{user:{id:actor}},error:authError})},rpc:async(name,args)=>{calls.push({name,args});return {data:context,error:null}}};
 const sql=async(_strings,...values)=>{dispatched.push(values);return [{data:{id:company,version:2}}]};sql.json=value=>value;sql.end=async()=>{};globalThis.correctionSql=sql;
 const {executeTenantRequest}=await import('../lib/server/tenant-request.ts');
 const request={company,mode:'command',operation:'admin.product.correct',key:company,data:{id:company,version:1,reason:'Correção dos dados cadastrais',patch:{name:'Produto corrigido'}}};
 await assert.rejects(executeTenantRequest('Bearer fixture',request),e=>e.code==='FORBIDDEN');assert.equal(calls.length,0);
 await assert.rejects(executeTenantRequest('Bearer fixture',{...request,data:{...request.data,patch:{price:99}}},'admin-correct'),e=>e.code==='INVALID_OPERATION');assert.equal(calls.length,0);
 await executeTenantRequest('Bearer fixture',request,'admin-correct');assert.equal(calls[0].name,'erp_admin_correction_context');assert.equal(calls[0].args.p_entity,company);assert.equal(calls[0].args.p_correlation,company);assert.equal(dispatched[0][0].administrative,true);assert.equal(dispatched[0][0].admin_action,request.operation);
 context={...context,administrative:false};await assert.rejects(executeTenantRequest('Bearer fixture',request,'admin-correct'),e=>e.code==='FORBIDDEN');assert.equal(dispatched.length,1);
 context={...context,administrative:true,actor:company};await assert.rejects(executeTenantRequest('Bearer fixture',request,'admin-correct'),e=>e.code==='FORBIDDEN');assert.equal(dispatched.length,1);
 context={...context,actor};authError={message:'invalid'};await assert.rejects(executeTenantRequest('Bearer fixture',request,'admin-correct'),e=>e.code==='UNAUTHENTICATED');authError=null;
 await executeTenantRequest('Bearer fixture',{company,mode:'read',operation:'products',data:{}},'admin-read');assert.equal(dispatched.at(-1)[0].administrative,undefined);assert.equal(dispatched.at(-1)[0].admin_action,undefined);
 console.log('PASS: correção só pelo escopo do servidor, esquema validado antes da autorização, contexto central restrito e conferido, ator divergente/sessão inválida negados; leitura nunca encaminha autoridade de escrita. Dependências simuladas.');
}finally{
 hooks.deregister();delete globalThis.correctionControl;delete globalThis.correctionSql;
 for(const [key,value] of original){if(value===undefined)delete process.env[key];else process.env[key]=value}
}
