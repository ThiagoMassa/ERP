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
 const {POST,PATCH}=await import('../app/api/admin/records/route.ts');
 const company='11111111-1111-4111-8111-111111111111',body={company,operation:'products',filters:{page:0,size:20}};
 const send=(value,auth=true)=>POST(new Request('http://localhost/api/admin/records',{method:'POST',headers:auth?{authorization:'Bearer fixture'}:{},body:JSON.stringify(value)}));
 assert.equal((await send(body,false)).status,401);
 for(const value of [{...body,company:null},{...body,mode:'command'},{...body,connection:'secret'},{...body,operation:'product.save'},{...body,filters:{export:true}},{...body,filters:{size:5000}}])assert.equal((await send(value)).status,400);
 assert.equal(calls.length,0);
 for(const operation of ['order_detail','title_detail'])assert.equal((await send({...body,operation})).status,400);
 for(const filters of [{start:'2026-02-30',end:'2026-03-01'},{start:'2026-10-01',end:'2026-09-01'},{start:'2026-09-01'},{currency:'BRL-invalid'}])assert.equal((await send({...body,filters})).status,400);
 const response=await send(body);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(calls[0],['Bearer fixture',{company,mode:'read',operation:'products',data:{page:0,size:20}},'admin-read']);
 await send({...body,filters:{currency:'USD',start:'2026-09-01',end:'2026-09-27'}});assert.equal(calls.at(-1)[1].data.currency,'USD');assert.equal(calls.at(-1)[1].data.start,'2026-09-01');
 assert.equal((await send({...body,filters:{id:company,actor:company}})).status,200);assert.equal(calls.at(-1)[1].data.actor,company);assert.equal(calls.at(-1)[1].data.id,company);
 assert.equal((await send({...body,filters:{actor:'not-a-user-id'}})).status,400);
 await send({company,operation:'order_detail',filters:{id:company}});assert.equal(calls.at(-1)[1].operation,'order_detail');assert.equal(calls.at(-1)[1].data.id,company);
 const history={company,operation:'record_history',filters:{id:company,start:'2026-10-01',end:'2026-10-03'}};
 assert.equal((await send(history)).status,200);assert.equal(calls.at(-1)[1].operation,'record_history');assert.equal(calls.at(-1)[2],'admin-read');
 for(const filters of [{...history.filters,id:undefined},{...history.filters,end:'2030-01-01'},{...history.filters,actor:'invalid'},{...history.filters,size:51},{...history.filters,cursor:{at:'2026-10-01T00:00:00Z',key:'bad'}}])assert.equal((await send({...history,filters})).status,400);
 failure=new TenantConfigurationError('FORBIDDEN','Acesso administrativo negado.');assert.equal((await send(body)).status,403);
 failure=new Error('secret database host');const unavailable=await send(body);assert.ok(!(await unavailable.text()).includes('secret'));
 failure=null;
 const correction={company,operation:'admin.product.correct',key:company,data:{id:company,version:1,reason:'Correção de descrição incorreta',patch:{name:'Peça revisada'}}};
 const patch=(value,auth=true)=>PATCH(new Request('http://localhost/api/admin/records',{method:'PATCH',headers:auth?{authorization:'Bearer fixture'}:{},body:JSON.stringify(value)}));
 assert.equal((await patch(correction,false)).status,401);
 for(const value of [{...correction,company:null},{...correction,scope:'admin-correct'},{...correction,operation:'product.save'},{...correction,data:{...correction.data,version:0}},{...correction,data:{...correction.data,patch:{cost:1}}},{...correction,data:{...correction.data,patch:{owner_id:company}}},{...correction,data:{...correction.data,reason:'short'}}])assert.equal((await patch(value)).status,400);
 assert.equal((await patch(correction)).status,200);assert.deepEqual(calls.at(-1),['Bearer fixture',{company,mode:'command',operation:correction.operation,data:correction.data,key:company},'admin-correct']);
 for(const operation of ['admin.product.archive','admin.product.restore']){const v={...correction,operation,data:{id:company,version:1,reason:'Ajuste administrativo da situação'}};assert.equal((await patch(v)).status,200);assert.equal(calls.at(-1)[1].operation,operation);assert.equal((await patch({...v,data:{...v.data,patch:{deleted_at:null}}})).status,400);}
 for(const operation of ['admin.order.cancel','admin.title.cancel']){const v={...correction,operation,data:{id:company,version:1,reason:'Cancelamento solicitado pela administração'}};assert.equal((await patch(v)).status,200);assert.equal(calls.at(-1)[1].operation,operation);assert.equal((await patch({...v,data:{...v.data,amount:0}})).status,400);}
 const reversal={...correction,operation:'admin.payment.reverse',data:{id:company,version:1,reason:'Estorno solicitado pela administração'}};assert.equal((await patch(reversal)).status,200);assert.equal(calls.at(-1)[1].operation,'admin.payment.reverse');assert.equal((await patch({...reversal,data:{...reversal.data,amount:10}})).status,400);
 failure=new TenantConfigurationError('CONFLICT','Atualize o registro.');assert.equal((await patch(correction)).status,409);
 failure=new TenantConfigurationError('FORBIDDEN','Confirme a identidade.');assert.equal((await patch(correction)).status,403);
 failure=new Error('secret postgres credentials');assert.ok(!(await (await patch(correction)).text()).includes('secret'));
 console.log('PASS: empresa explícita, whitelist, comandos/exportação/conexão arbitrária recusados e encaminhamento de escopo administrativo somente pelo servidor. Executor simulado.');
}finally{hooks.deregister();delete globalThis.recordExecutor}
