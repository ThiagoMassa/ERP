import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {auditFilters} from '../lib/admin-audit.ts';
const hooks=registerHooks({resolve(specifier,context,next){
 if(specifier==='@supabase/supabase-js')return {url:'data:text/javascript,export const createClient=(...args)=>globalThis.auditClient(...args)',shortCircuit:true};
 if(specifier.startsWith('@/'))return {url:pathToFileURL(resolve(specifier.slice(2)+'.ts')).href,shortCircuit:true};return next(specifier,context);
}});
const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_PUBLISHABLE_KEY;
try{
 const base={from:'2026-09-01',to:'2026-09-27'};
 for(const bad of [{before:'bad'},{before:'9223372036854775808'},{from:'2026-02-30'},{from:'2025-01-01'},{actor:'not-uuid'},{unknown:true}])assert.equal(auditFilters.safeParse({...base,...bad}).success,false);
 assert.equal(auditFilters.parse({...base,before:'9007199254740993'}).before,'9007199254740993');
 process.env.SUPABASE_URL='https://audit.invalid';process.env.SUPABASE_PUBLISHABLE_KEY='public-fixture';
 let signedIn=true,rpcError=null;const calls=[];
 globalThis.auditClient=(_url,_key,options)=>({auth:{getUser:async token=>{assert.equal(token,'fixture');assert.equal(options.global.headers.Authorization,'Bearer fixture');return {data:{user:signedIn?{id:'fixture'}:null},error:null}}},rpc:async(name,args)=>{calls.push({name,args});return {data:{rows:[{id:'9007199254740993'}],upper:'9007199254740993',next:null,correlation:'fixture'},error:rpcError}}});
 const {POST}=await import('../app/api/admin/audit/route.ts');
 const send=(body,auth=true)=>POST(new Request('http://localhost/api/admin/audit',{method:'POST',headers:auth?{authorization:'Bearer fixture'}:{},body:JSON.stringify(body)}));
 assert.equal((await send({mode:'read',filters:base},false)).status,401);
 signedIn=false;assert.equal((await send({mode:'read',filters:base})).status,401);signedIn=true;
 assert.equal((await send({mode:'export',filters:{...base,before:'10'}})).status,400);assert.equal(calls.length,0);
 const response=await send({mode:'export',filters:base});assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/^attachment; filename="auditoria-2026-09-01-2026-09-27.json"$/);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal((await response.json()).rows[0].id,'9007199254740993');
 assert.equal(calls.at(-1).name,'erp_admin_audit');assert.equal(calls.at(-1).args.p_export,true);
 rpcError={code:'42501',message:'sensitive database details'};const denied=await send({mode:'export',filters:base});assert.equal(denied.status,403);assert.ok(!(await denied.text()).includes('sensitive'));
 rpcError={code:'PGRST202'};assert.equal((await send({mode:'read',filters:base})).status,503);
 console.log('PASS: filtros/cursor exatos, datas inválidas recusadas, sessão exigida, exportação sem cursor, arquivo JSON privado e erros SQL não expostos. Auth/RPC simulados.');
}finally{
 hooks.deregister();delete globalThis.auditClient;
 if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
 if(oldKey===undefined)delete process.env.SUPABASE_PUBLISHABLE_KEY;else process.env.SUPABASE_PUBLISHABLE_KEY=oldKey;
}
