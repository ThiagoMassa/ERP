import assert from 'node:assert/strict';
import {uploadAsset,downloadAsset} from '../lib/assets.ts';
const file=new File(['test'],'foto.png',{type:'image/png'}),calls=[];let user='user-a',token='first',status=200;
const db={auth:{getSession:async()=>({data:{session:{user:{id:user},access_token:token}}})}};
const original=globalThis.fetch;
try{
 globalThis.fetch=async(url,options)=>{calls.push({params:new URL(url,'http://localhost').searchParams,...options});return status===200?new Response(JSON.stringify({data:{path:'saved'}}),{status}):new Response(JSON.stringify({error:'Recusado'}),{status});};
 await uploadAsset(db,'company-a','product-photos',file);token='refreshed';await uploadAsset(db,'company-a','product-photos',file);
 assert.equal(calls[0].params.get('key'),calls[1].params.get('key'));assert.equal(calls[1].headers.Authorization,'Bearer refreshed');assert.equal(calls[0].body,file);assert.equal(calls[0].cache,'no-store');
 await uploadAsset(db,'company-b','product-photos',file);assert.notEqual(calls[2].params.get('key'),calls[0].params.get('key'));
 user='user-b';await uploadAsset(db,'company-a','product-photos',file);assert.notEqual(calls[3].params.get('key'),calls[0].params.get('key'));
 status=403;await assert.rejects(downloadAsset(db,'company-a','erp-models','saved'),/Recusado/);
 assert.equal(calls.at(-1).params.get('company'),'company-a');assert.equal(calls.at(-1).params.get('bucket'),'erp-models');
 console.log('PASS: file retries keep idempotency key; company/user changes get distinct keys; refreshed session used; bytes passed directly; downloads carry explicit company and surface denial.');
}finally{globalThis.fetch=original;}
