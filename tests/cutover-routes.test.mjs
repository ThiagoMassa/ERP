import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

const hooks=registerHooks({resolve(specifier,context,next){
 if(specifier==='@supabase/supabase-js')return {url:'data:text/javascript,export const createClient=(...args)=>globalThis.cutoverClient(...args)',shortCircuit:true};
 if(specifier.startsWith('@/'))return {url:pathToFileURL(resolve(specifier.slice(2)+'.ts')).href,shortCircuit:true};return next(specifier,context);
}});
const previous={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_PUBLISHABLE_KEY};
try{
 process.env.SUPABASE_URL='https://test.supabase.invalid';process.env.SUPABASE_PUBLISHABLE_KEY='fixture-public';
 const {POST}=await import('../app/api/admin/cutover/route.ts');
 const company=randomUUID(),correlation=randomUUID(),calls=[];let signedIn=true,rpcError=null;
 globalThis.cutoverClient=(_url,_key,options)=>({auth:{getUser:async token=>{assert.equal(token,'fixture-token');assert.equal(options.global.headers.Authorization,'Bearer fixture-token');return {data:{user:signedIn?{id:randomUUID()}:null},error:null}}},rpc:async(name,args)=>{calls.push({name,args});return {data:{company},error:rpcError}}});
 const send=(body,auth=true)=>POST(new Request('http://localhost/api/admin/cutover',{method:'POST',headers:auth?{authorization:'Bearer fixture-token'}:{},body:JSON.stringify(body)}));
 const read={mode:'read',company},request={mode:'request',company,version:1,reason:'Migração planejada da empresa',confirmCompany:company,correlation};
 assert.equal((await send(read,false)).status,401);assert.equal(calls.length,0);
 signedIn=false;assert.equal((await send(read)).status,401);assert.equal(calls.length,0);signedIn=true;
 for(const body of [{...request,confirmCompany:randomUUID()},{...request,reason:'curto'},{...request,version:0},{...read,connection:'postgres://private'}])assert.equal((await send(body)).status,400);
 assert.equal(calls.length,0);
 const response=await send(read);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(calls.at(-1),{name:'erp_read_cutover',args:{p_company:company}});
 assert.equal((await send(request)).status,200);assert.deepEqual(calls.at(-1),{name:'erp_request_cutover',args:{p_company:company,p_version:1,p_reason:request.reason,p_correlation:correlation}});
 rpcError={code:'42501',message:'private SQL diagnostic'};const denied=await send(request);assert.equal(denied.status,403);assert.ok(!(await denied.text()).includes('private SQL'));
 rpcError={code:'PGRST202'};assert.equal((await send(read)).status,503);
 const oversized=await POST(new Request('http://localhost/api/admin/cutover',{method:'POST',headers:{authorization:'Bearer fixture-token'},body:'x'.repeat(8193)}));assert.equal(oversized.status,400);
 console.log('PASS: handlers reais exigem token e confirmação, limitam corpo, recusam conexões arbitrárias e só chamam RPCs autorizadas; erros privados não são expostos. Auth/RPC simulados neste teste.');
}finally{
 hooks.deregister();delete globalThis.cutoverClient;
 if(previous.url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=previous.url;
 if(previous.key===undefined)delete process.env.SUPABASE_PUBLISHABLE_KEY;else process.env.SUPABASE_PUBLISHABLE_KEY=previous.key;
}
