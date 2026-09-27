import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const hooks=registerHooks({resolve(specifier,context,next){
 if(specifier==='@supabase/supabase-js')return {url:'data:text/javascript,export const createClient=(...args)=>globalThis.adminTestClient(...args)',shortCircuit:true};
 if(specifier.startsWith('@/'))return {url:pathToFileURL(resolve(specifier.slice(2)+'.ts')).href,shortCircuit:true};return next(specifier,context);
}});
const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_PUBLISHABLE_KEY;
try{
 process.env.SUPABASE_URL='https://admin.invalid';process.env.SUPABASE_PUBLISHABLE_KEY='public-test';
 let signedIn=true,result={data:{ok:true},error:null};const calls=[];
 globalThis.adminTestClient=(_url,_key,options)=>({auth:{getUser:async token=>{
  assert.equal(token,'fixture');assert.equal(options.global.headers.Authorization,'Bearer fixture');
  return {data:{user:signedIn?{id:'fixture'}:null},error:null};
 }},rpc:async(name,args)=>{calls.push({name,args});return result}});
 const {POST}=await import('../app/api/admin/route.ts');
 const send=(body,auth=true)=>POST(new Request('http://localhost/api/admin',{method:'POST',headers:auth?{authorization:'Bearer fixture'}:{},body:JSON.stringify(body)}));
 assert.equal((await send({mode:'read',section:'users'},false)).status,401);
 signedIn=false;assert.equal((await send({mode:'read',section:'users'})).status,401);signedIn=true;
 for(const body of [null,[],{mode:'read',section:'users',filters:[]},{mode:'command',action:'user.status',data:null},{mode:'read',section:'users',connection:'secret'},{mode:'other'}])assert.equal((await send(body)).status,400);
 assert.equal(calls.length,0);
 let cancelled=false,pulls=0;
 const stream=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(8192).fill(32))},cancel(){cancelled=true}},{highWaterMark:0});
 const oversized=await POST(new Request('http://localhost/api/admin',{method:'POST',headers:{authorization:'Bearer fixture'},body:stream,duplex:'half'}));
 assert.equal(oversized.status,413);assert.equal(cancelled,true);assert.equal(pulls,5);assert.equal(calls.length,0);
 // Byte limit applies even when the UTF-16 character count would fit.
 assert.equal((await send({mode:'read',section:'users',filters:{query:'é'.repeat(18000)}})).status,413);
 const user='11111111-1111-4111-8111-111111111111';
 const command={mode:'command',action:'user.status',data:{user,status:'blocked',version:2,reason:'Bloqueio solicitado pelo titular'}};
 const success=await send(command);assert.equal(success.status,200);assert.equal(success.headers.get('cache-control'),'no-store');assert.equal(success.headers.get('x-content-type-options'),'nosniff');
 assert.equal(calls.at(-1).name,'erp_admin_command');assert.deepEqual(calls.at(-1).args.p_data,command.data);assert.match(calls.at(-1).args.p_correlation,/^[0-9a-f-]{36}$/);
 assert.equal((await send({mode:'read',section:'users',filters:{company:user,page:2,query:'nome'}})).status,200);
 assert.equal(calls.at(-1).name,'erp_admin_read');assert.deepEqual(calls.at(-1).args,{p_section:'users',p_filters:{company:user,page:2,query:'nome'}});
 assert.equal((await send({mode:'read',section:'user_directory',filters:{query:'Nome',status:'suspended'}})).status,200);
 assert.equal(calls.at(-1).name,'erp_admin_users');assert.equal(calls.at(-1).args.p_filters.status,'suspended');
 const profile={mode:'command',action:'user.profile',data:{user,display_name:'Nome Completo',version:0,reason:'Correção cadastral solicitada'}};
 assert.equal((await send(profile)).status,200);assert.equal(calls.at(-1).name,'erp_admin_user_profile');assert.equal(calls.at(-1).args.p_version,0);
 assert.equal((await send({...profile,data:{...profile.data,role:'admin'}})).status,400);
 assert.equal((await send({...profile,data:{...profile.data,display_name:''}})).status,400);
 result={data:null,error:{code:'40001',message:'Registro alterado. Atualize antes de salvar.'}};assert.equal((await send(profile)).status,409);
 for(const failure of [{data:null,error:{code:'42501',message:'password=private database.internal'}},{data:{ok:false,error:'password=private database.internal'},error:null}]){
  result=failure;const response=await send(command);assert.equal(response.status,403);assert.ok(!(await response.text()).includes('private'));
 }
 result={data:{ok:false,error:'Registro alterado. Atualize antes de salvar.'},error:null};assert.equal((await (await send(command)).json()).error,result.data.error);
 result={data:null,error:{code:'PGRST202',message:'internal schema path'}};assert.equal((await send({mode:'read',section:'users'})).status,503);
 result={data:{ok:false,error:'private maintenance database details'},error:null};
 const maintenance=await send({mode:'command',action:'maintenance.request',data:{kind:'backup',company:user,backup:null,retention:30,version:1,reason:'Cópia solicitada para revisão',confirmCompany:null,confirmBackup:null,key:user}});
 assert.equal(maintenance.status,403);assert.ok(!(await maintenance.text()).includes('private'));
 // SQL still decides authorization, including MFA and target/version constraints.
 result={data:{ok:false,error:'Acesso exclusivo do ADM global.'},error:null};assert.equal((await send(command)).status,403);
 console.log('PASS: admin route preserves user commands, rejects invalid envelopes and bounded/multibyte streams, cancels oversized reads, sanitizes RPC errors and retains concurrency guidance. Auth/RPC simulated.');
}finally{
 hooks.deregister();delete globalThis.adminTestClient;
 if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
 if(oldKey===undefined)delete process.env.SUPABASE_PUBLISHABLE_KEY;else process.env.SUPABASE_PUBLISHABLE_KEY=oldKey;
}
