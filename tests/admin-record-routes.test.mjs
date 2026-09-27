import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {TenantConfigurationError} from '../lib/server/tenant-identity.ts';
const hooks=registerHooks({resolve(specifier,context,next){
 if(specifier==='@/lib/server/tenant-request')return {url:'data:text/javascript,export const executeTenantRequest=(...args)=>globalThis.recordExecutor(...args)',shortCircuit:true};
 if(specifier.startsWith('@/'))return {url:pathToFileURL(resolve(specifier.slice(2)+'.ts')).href,shortCircuit:true};return next(specifier,context);
}});
try{
 const calls=[];let failure=null;
 globalThis.recordExecutor=async(...args)=>{calls.push(args);if(failure)throw failure;return {rows:[],count:0}};
 const {POST}=await import('../app/api/admin/records/route.ts');
 const company='11111111-1111-4111-8111-111111111111',body={company,operation:'products',filters:{page:0,size:20}};
 const send=(value,auth=true)=>POST(new Request('http://localhost/api/admin/records',{method:'POST',headers:auth?{authorization:'Bearer fixture'}:{},body:JSON.stringify(value)}));
 assert.equal((await send(body,false)).status,401);
 for(const value of [{...body,company:null},{...body,mode:'command'},{...body,connection:'secret'},{...body,operation:'product.save'},{...body,filters:{export:true}},{...body,filters:{size:5000}}])assert.equal((await send(value)).status,400);
 assert.equal(calls.length,0);
 const response=await send(body);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(calls[0],['Bearer fixture',{company,mode:'read',operation:'products',data:{page:0,size:20}},'admin-read']);
 failure=new TenantConfigurationError('FORBIDDEN','Acesso administrativo negado.');assert.equal((await send(body)).status,403);
 failure=new Error('secret database host');const unavailable=await send(body);assert.ok(!(await unavailable.text()).includes('secret'));
 console.log('PASS: empresa explícita, whitelist, comandos/exportação/conexão arbitrária recusados e encaminhamento de escopo administrativo somente pelo servidor. Executor simulado.');
}finally{hooks.deregister();delete globalThis.recordExecutor}
