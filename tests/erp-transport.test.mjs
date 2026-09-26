import assert from 'node:assert/strict';
import {readERP,commandERP} from '../lib/operations.ts';
const company='00000000-0000-4000-8000-000000000001',key='00000000-0000-4000-8000-000000000002';
const calls=[];let token='test-first-session',session=true,status=200,response={data:{rows:[{id:'product'}],count:1}};
const db={auth:{getSession:async()=>({data:{session:session?{access_token:token}:null},error:null})},rpc:()=>assert.fail('Operational client must never call legacy RPC')};
const original=globalThis.fetch;
try{
 globalThis.fetch=async(url,options)=>{calls.push({url,...options,body:JSON.parse(options.body)});return new Response(JSON.stringify(response),{status});};
 assert.deepEqual(await readERP(db,company,'products',{query:'PLA',page:2}),response.data);
 assert.equal(calls[0].url,'/api/erp');assert.equal(calls[0].cache,'no-store');assert.equal(calls[0].headers.Authorization,'Bearer '+token);
 assert.deepEqual(calls[0].body,{company,mode:'read',operation:'products',data:{query:'PLA',page:2}});
 token='test-refreshed-session';response={data:{id:'saved'}};
 assert.deepEqual(await commandERP(db,company,'product.save',{name:'Peça'},key),response.data);
 assert.equal(calls[1].headers.Authorization,'Bearer '+token);assert.equal(calls[1].body.key,key);
 await readERP(db,null,'businesses',{size:100});assert.equal(calls[2].body.company,null);
 status=403;response={error:'Vínculo suspenso'};await assert.rejects(readERP(db,company,'products'),/Vínculo suspenso/);
 status=409;response={error:'Cadastro alterado'};await assert.rejects(commandERP(db,company,'business.save',{},key),/Cadastro alterado/);
 session=false;const count=calls.length;await assert.rejects(readERP(db,company,'products'),/Entre novamente/);assert.equal(calls.length,count);
 console.log('PASS: operational client exclusively uses server API, current session token, explicit company/idempotency key, central list, propagated authorization/conflict errors, no request without session.');
}finally{globalThis.fetch=original;}
