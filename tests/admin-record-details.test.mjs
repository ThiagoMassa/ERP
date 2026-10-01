import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
const hooks=registerHooks({resolve(specifier,context,next){if(specifier.startsWith('@/'))return {url:pathToFileURL(resolve(specifier.slice(2)+'.ts')).href,shortCircuit:true};return next(specifier,context)},load(url,context,next){if(url.endsWith('.tsx'))return {format:'module',source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText,shortCircuit:true};return next(url,context)}});
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
const saved=new Map();for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,FormData:dom.window.FormData,IS_REACT_ACT_ENVIRONMENT:true})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true})}
const originalFetch=globalThis.fetch;let root;
try{
 const {AdminRecords}=await import('../components/erp/admin-records.tsx');
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
 const db={auth:{getSession:async()=>({data:{session:{access_token:'test'}}})}};
 let pending,detailSignal;const requests=[];
 globalThis.fetch=async(_url,init)=>{const r=JSON.parse(init.body);requests.push(r);if(r.operation.endsWith('_detail')){detailSignal=init.signal;return new Promise(resolve=>{pending=resolve})}return Response.json({data:{rows:r.company===a?[{id:a,business_id:a,description:'Pedido de teste',currency:'BRL'}]:[],count:r.company===a?1:0}})};
 root=createRoot(document.getElementById('root'));
 const mount=company=>act(async()=>{root.render(React.createElement(AdminRecords,{key:company,db,company,companyName:company===a?'Empresa A':'Empresa B'}))});
 const click=label=>act(async()=>{const button=[...document.querySelectorAll('button')].find(e=>e.textContent===label);assert.ok(button,label);button.click()});
 await mount(a);
 await act(async()=>{document.querySelector('select[name=operation]').value='orders';document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))});
 await click('Ver campos');assert.equal(requests.at(-1).operation,'order_detail');assert.equal(requests.at(-1).filters.id,a);
 await act(async()=>{pending(Response.json({data:{id:a,business_id:a,currency:'BRL',items:[{id:b,name:'Peça premium',quantity:2,price:50,fulfilled:1,total:100}],fulfillments:[],titles:[]}}))});
 assert.match(document.body.textContent,/Peça premium/);assert.match(document.body.textContent,/Itens do pedido · 1/);
 await click('Fechar campos');await click('Ver campos');const stale=pending;
 await mount(b);assert.equal(detailSignal.aborted,true);
 await act(async()=>{stale(Response.json({data:{id:a,business_id:a,description:'VAZAMENTO ANTIGO',items:[]}}))});
 assert.ok(!document.body.textContent.includes('VAZAMENTO ANTIGO'));assert.ok(!document.body.textContent.includes('Peça premium'));assert.match(document.body.textContent,/Empresa B/);
 await mount(a);await act(async()=>{document.querySelector('select[name=operation]').value='titles';document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))});await click('Ver campos');
 assert.equal(requests.at(-1).operation,'title_detail');await act(async()=>{pending(Response.json({data:{id:a,business_id:a,currency:'BRL',payments:[{id:b,amount:50,reversed_at:'2026-09-28T12:00:00Z',reason:'Estorno de teste'}]}}))});
 assert.match(document.body.textContent,/Pagamentos e estornos · 1/);assert.match(document.body.textContent,/Estorno de teste/);
 await click('Fechar campos');await click('Ver campos');await act(async()=>{pending(Response.json({data:{id:a,business_id:b,payments:[{amount:999}]}}))});
 assert.match(document.querySelector('[role=alert]').textContent,/não corresponde/);assert.ok(!document.body.textContent.includes('999'));
 console.log('PASS: componente real consulta detalhes, mostra itens, cancela resposta antiga ao trocar empresa e recusa detalhe de outra empresa. DOM e rede simulados.');
}finally{
 if(root)await act(async()=>root.unmount());globalThis.fetch=originalFetch;hooks.deregister();dom.window.close();for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}
}
