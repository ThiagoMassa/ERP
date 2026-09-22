import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const hooks=registerHooks({resolve(specifier,context,next){
 if(specifier==='@/lib/server/tenant-request')return {url:'data:text/javascript,export const executeTenantRequest=(...args)=>globalThis.testAssetDispatch(...args)',shortCircuit:true};
 if(specifier.startsWith('@/'))return {url:pathToFileURL(resolve(specifier.slice(2)+'.ts')).href,shortCircuit:true};return next(specifier,context);
}});
try{
 const {GET,POST}=await import('../app/api/erp/files/route.ts');
 const {POST:generic}=await import('../app/api/erp/route.ts');
 const company='00000000-0000-4000-8000-000000000001',key='00000000-0000-4000-8000-000000000002';
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS9sAAAAASUVORK5CYII=','base64');
 const calls=[];let allowed=true,corrupt=false;
 globalThis.testAssetDispatch=async(auth,request)=>{calls.push({auth,request});if(request.operation==='permissions')return {catalog:{available:{allowed:true},read:{allowed:true},create:{allowed},edit:{allowed}}};if(request.operation==='asset.save')return {path:company+'/'+key+'.png',size_bytes:bytes.length};if(request.operation==='asset.read')return {content:bytes.toString('base64'),mime:'image/png',filename:'foto.png',sha256:corrupt?'0'.repeat(64):createHash('sha256').update(bytes).digest('hex'),size_bytes:bytes.length};throw Error('Unexpected operation');};
 const url='http://localhost/api/erp/files?'+new URLSearchParams({company,bucket:'product-photos',key,filename:'foto.png'});
 const headers={authorization:'Bearer fixture-session'};
 assert.equal((await POST(new Request(url,{method:'POST',body:bytes}))).status,401);assert.equal(calls.length,0);
 allowed=false;assert.equal((await POST(new Request(url,{method:'POST',headers,body:bytes}))).status,403);assert.equal(calls.filter(c=>c.request.operation==='asset.save').length,0);
 allowed=true;const uploaded=await POST(new Request(url,{method:'POST',headers,body:bytes}));assert.equal(uploaded.status,200);assert.match(uploaded.headers.get('cache-control'),/no-store/);
 const request=calls.at(-1).request;assert.equal(request.key,key);assert.equal(request.company,company);assert.equal(request.data.mime,'image/png');assert.deepEqual(Buffer.from(request.data.content,'base64'),bytes);
 assert.equal((await POST(new Request(url,{method:'POST',headers,body:'<svg/>'}))).status,422);
 assert.equal((await POST(new Request(url,{method:'POST',headers:{...headers,'content-length':'99999999'},body:bytes}))).status,422);
 const response=await GET(new Request('http://localhost/api/erp/files?'+new URLSearchParams({company,bucket:'product-photos',path:company+'/'+key+'.png'}),{headers}));
 assert.equal(response.status,200);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('content-disposition'),/attachment/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 corrupt=true;assert.equal((await GET(new Request('http://localhost/api/erp/files?'+new URLSearchParams({company,bucket:'product-photos',path:'x'}),{headers}))).status,503);
 assert.equal((await generic(new Request('http://localhost/api/erp',{method:'POST',headers,body:JSON.stringify({company,mode:'command',operation:'asset.save',data:{},key})}))).status,400);
 console.log('PASS: real Request/Response file handlers enforce auth/input/permission boundary, bounded body and format validation, binary integrity, private no-store/nosniff downloads and no generic upload bypass. Dispatch authorization is stubbed here and tested separately in PostgreSQL.');
}finally{hooks.deregister();delete globalThis.testAssetDispatch;}
