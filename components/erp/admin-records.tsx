"use client";
import {useEffect,useRef,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Database,Search,ChevronLeft,ChevronRight} from 'lucide-react';
import {adminRecordRequest,adminHistoryRequest,adminRecordMutation} from '@/lib/admin-records';
import {rows,str,num,type Row} from '@/lib/operations';
import {z} from 'zod';

const types=[['products','Produtos'],['partners','Clientes e fornecedores'],['orders','Pedidos e orçamentos'],['titles','Títulos financeiros'],['stock','Saldos de estoque'],['movements','Movimentações'],['jobs','Produção 3D'],['spools','Bobinas'],['printers','Impressoras'],['recipes','Receitas de produção']];
const fields:Record<string,string>={id:'Identificador',name:'Nome',description:'Descrição',sku:'Código',status:'Situação',kind:'Tipo',type:'Natureza',currency:'Moeda',cost:'Custo',price:'Preço',amount:'Valor',paid:'Liquidado',total:'Total',quantity:'Quantidade',unit:'Unidade',warehouse_name:'Depósito',date:'Data',due_date:'Vencimento',created_at:'Criado em',updated_at:'Atualizado em',created_by:'Autor',owner_id:'Proprietário original',version:'Versão',partner_name:'Cliente / fornecedor',email:'E-mail',phone:'Telefone',active:'Ativo',deleted_at:'Arquivado em',cancelled_at:'Cancelado em',reason:'Motivo'};
const render=(v:unknown)=>typeof v==='boolean'?(v?'Sim':'Não'):v===null||v===undefined?'—':str(v);
async function read(db:SupabaseClient,body:unknown,signal:AbortSignal):Promise<Row>{
 const parsed=adminRecordRequest.safeParse(body);if(!parsed.success)throw Error('Confira os identificadores e os filtros. No histórico, use um período de até 366 dias.');
 const {data}=await db.auth.getSession();if(!data.session)throw Error('Entre na conta administrativa.');
 const response=await fetch('/api/admin/records',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},body:JSON.stringify(parsed.data),signal});
 const payload=z.object({error:z.string().optional(),data:z.record(z.unknown()).optional()}).parse(await response.json());if(!response.ok)throw Error(payload.error||'Consulta indisponível.');if(!payload.data)throw Error('Resposta da consulta inválida.');return payload.data;
}
export function AdminRecords({db,company,companyName,onReauth}:{db:SupabaseClient;company:string;companyName:string;onReauth?:()=>void}){
 const today=new Date().toISOString().slice(0,10);
 const [query,setQuery]=useState({operation:'products',status:'active',query:'',id:'',actor:'',currency:'BRL',start:today.slice(0,8)+'01',end:today,page:0});
 const [data,setData]=useState<Row|null>(null),[error,setError]=useState(''),[selected,setSelected]=useState<Row|null>(null);
 const [notice,setNotice]=useState('');
 useEffect(()=>{
  if(!company)return;const controller=new AbortController();
  read(db,{company,operation:query.operation,filters:{status:query.status,query:query.query,id:query.id||undefined,actor:query.actor||undefined,currency:query.currency,start:query.start,end:query.end,page:query.page,size:20}},controller.signal)
   .then(result=>{if(!controller.signal.aborted)setData(result)}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Consulta indisponível.')});
  return()=>controller.abort();
 },[db,company,query]);
 function change(next:typeof query){setData(null);setSelected(null);setError('');setQuery(next)}
 if(!company)return <section className="adm-card adm-records"><Database size={28}/><h2>Selecione uma empresa</h2><p>Escolha o contexto no topo para consultar os registros do banco exclusivo.</p></section>;
 const records=rows(data?.rows),count=num(data?.count);
 return <section className="adm-card adm-records" aria-label="Consulta administrativa de registros">
  <header><h2>Registros da empresa</h2><strong>{companyName||company}</strong><small>{company}</small><p>Consulte os registros e revise os dados cadastrais dos produtos. Valores são exibidos na moeda registrada, sem conversão.</p></header>
  {notice?<p role="status">{notice}</p>:null}
  <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);change({operation:str(f.get('operation')),status:str(f.get('status')),query:str(f.get('query')),id:str(f.get('id')).trim(),actor:str(f.get('actor')).trim(),currency:str(f.get('currency')).toUpperCase(),start:str(f.get('start')),end:str(f.get('end')),page:0})}}>
   <div className="adm-audit-filters"><label>Tipo de registro<select name="operation" defaultValue={query.operation}>{types.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>Produtos<select name="status" defaultValue={query.status}><option value="active">Ativos</option><option value="archived">Inativos</option></select></label><label>Nome ou descrição<input name="query" maxLength={160} defaultValue={query.query}/></label><label>Identificador do registro<input name="id" defaultValue={query.id} placeholder="UUID; em saldos, UUID do produto"/></label><label>Autor registrado (ID)<input name="actor" defaultValue={query.actor} placeholder="UUID do autor de criação ou alteração"/></label><label>Moeda (código)<input name="currency" minLength={3} maxLength={3} pattern="[A-Za-z]{3}" required defaultValue={query.currency}/></label><label>De<input name="start" type="date" required defaultValue={query.start}/></label><label>Até<input name="end" type="date" required defaultValue={query.end}/></label><button className="primary"><Search size={16}/> Consultar</button></div>
   <p>O filtro de situação aplica-se somente aos produtos. O período filtra pedidos pela data, títulos pelo vencimento e os demais cadastros pela criação em UTC; em saldos, usa a criação do produto. Autor considera a criação ou ação registrada no histórico, sem presumir que o proprietário criou o registro. Registros sem autoria documentada não correspondem a esse filtro. A moeda aplica-se aos registros que possuem moeda.</p>
  </form>
  <p className="adm-audit-applied">Consulta aplicada: {types.find(([id])=>id===query.operation)?.[1]} · {query.operation==='products'?(query.status==='archived'?'Inativos':'Ativos'):'Todos'} · {query.currency} · {query.start} a {query.end}{query.query?` · Busca: ${query.query}`:''}{query.id?` · ID: ${query.id}`:''}{query.actor?` · Autor: ${query.actor}`:''}</p>
  {error?<p role="alert" className="op-error">{error}</p>:!data?<p role="status">Consultando banco da empresa…</p>:<>
   {records.length?<div className="op-table-scroll"><table className="op-table"><thead><tr><th>Registro</th><th>Situação / tipo</th><th>Moeda</th><th>Consulta</th></tr></thead><tbody>{records.map((r,i)=><tr key={str(r.id)||[r.product_id,r.warehouse_id,i].join(':')}><td>{str(r.name||r.description||r.partner_name)||'Sem descrição'}<small>{str(r.id||r.product_id)}</small></td><td>{str(r.status||r.kind||r.type)||'—'}</td><td>{str(r.currency)||'—'}</td><td><button className="op-small-button" onClick={()=>setSelected(r)}>Ver campos</button></td></tr>)}</tbody></table></div>:<p>Nenhum registro corresponde aos filtros aplicados.</p>}
   <div className="op-form-footer"><span>{count} registros · página {query.page+1}</span><button className="op-small-button" disabled={!query.page} onClick={()=>change({...query,page:query.page-1})}><ChevronLeft size={16}/>Anterior</button><button className="op-small-button" disabled={(query.page+1)*20>=count} onClick={()=>change({...query,page:query.page+1})}>Próxima<ChevronRight size={16}/></button></div>
  </>}
  {selected?<aside className="adm-record-detail" aria-label="Campos do registro"><h3>Campos do registro · {companyName||company}</h3><RecordDetails key={[company,query.operation,selected.id,selected.product_id,selected.warehouse_id].join(':')} db={db} company={company} operation={query.operation} record={selected}/>{query.operation==='products'?<ProductCorrection key={[company,selected.id,selected.record_version].join(':')} db={db} company={company} companyName={companyName} record={selected} onReauth={onReauth} onSaved={()=>{change({...query});setNotice('Alteração registrada. A justificativa e os valores anteriores estão no histórico da empresa.')}}/>:null}{z.string().uuid().safeParse(selected.id).success?<RecordHistory key={[company,selected.id].join(':')} db={db} company={company} id={str(selected.id)}/>:null}<button className="op-small-button" onClick={()=>setSelected(null)}>Fechar campos</button></aside>:null}
 </section>;
}

const historySchema=z.object({company:z.string().uuid(),entity:z.string().uuid(),upper:z.string().datetime({offset:true}),next_cursor:z.object({at:z.string().datetime({offset:true}),key:z.string()}).nullable(),rows:z.array(z.object({id:z.string(),audit_key:z.string(),source:z.enum(['erp','tenant']),occurred_at:z.string(),actor_id:z.string().nullable(),subject_id:z.string().nullable(),action:z.string(),reason:z.string().nullable(),result:z.string(),correlation_id:z.string().nullable(),before_data:z.record(z.unknown()).nullable(),after_data:z.record(z.unknown()).nullable()}))});
type HistoryFilters=z.infer<typeof adminHistoryRequest>['filters'];
function RecordHistory({db,company,id}:{db:SupabaseClient;company:string;id:string}){
 const [open,setOpen]=useState(false),[data,setData]=useState<z.infer<typeof historySchema>|null>(null),[error,setError]=useState('');
 const [filters,setFilters]=useState<HistoryFilters>(()=>({id,start:new Date(Date.now()-29*86400000).toISOString().slice(0,10),end:new Date().toISOString().slice(0,10),size:20}));
 useEffect(()=>{
  if(!open)return;const controller=new AbortController();
  read(db,{company,operation:'record_history',filters},controller.signal).then(value=>{const result=historySchema.parse(value);if(result.company!==company||result.entity!==id)throw Error('Histórico de outro contexto recusado.');if(!controller.signal.aborted)setData(result)}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Histórico indisponível.')});
  return()=>controller.abort();
 },[db,company,id,filters,open]);
 const apply=(next:HistoryFilters)=>{setData(null);setError('');setFilters(next)};
 if(!open)return <button className="op-small-button" onClick={()=>setOpen(true)}>Histórico do registro</button>;
 const show=(value:unknown)=>value===null||value===undefined?'—':typeof value==='object'?JSON.stringify(value):String(value);
 return <section aria-label="Histórico do registro"><h4>Histórico do registro</h4><p>Eventos operacionais e administrativos do banco desta empresa. Período em UTC, até 366 dias. Dados anteriores não registrados na época aparecem como indisponíveis.</p>
  <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);apply({id,start:str(f.get('start')),end:str(f.get('end')),actor:str(f.get('actor'))||undefined,subject:str(f.get('subject'))||undefined,action:str(f.get('action'))||undefined,size:20})}}><div className="adm-audit-filters"><label>De<input name="start" type="date" defaultValue={filters.start} required/></label><label>Até<input name="end" type="date" defaultValue={filters.end} required/></label><label>Responsável pela ação (ID)<input name="actor" defaultValue={filters.actor} placeholder="UUID do usuário ou ADM"/></label><label>Usuário afetado (ID)<input name="subject" defaultValue={filters.subject} placeholder="UUID, quando registrado"/></label><label>Ação exata<input name="action" defaultValue={filters.action} maxLength={100} placeholder="Ex.: admin.product.correct"/></label><button className="primary">Filtrar histórico</button></div></form>
  {error?<p role="alert" className="op-error">{error}</p>:!data?<p role="status">Consultando histórico…</p>:<>
   {data.rows.length?data.rows.map(event=>{const keys=[...new Set([...Object.keys(event.before_data||{}),...Object.keys(event.after_data||{})])];return <details key={event.audit_key}><summary>{event.action} · {new Date(event.occurred_at).toLocaleString('pt-BR',{timeZone:'UTC'})} UTC</summary><p>Origem: {event.source==='erp'?'Operação do ERP':'Auditoria empresarial'} · Resultado: {event.result}</p><p>Autor da ação: {event.actor_id||'Não registrado'}<br/>Usuário afetado: {event.subject_id||'Não registrado'}<br/>Justificativa: {event.reason||'Não registrada'}</p>{keys.length?<div className="op-table-scroll"><table className="op-table"><thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead><tbody>{keys.map(key=><tr key={key}><th>{editableProductFields[key as keyof typeof editableProductFields]||fields[key]||key}</th><td style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{show(event.before_data?.[key])}</td><td style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{show(event.after_data?.[key])}</td></tr>)}</tbody></table></div>:<p>Valores anteriores e posteriores não foram registrados neste evento.</p>}<small>Evento: {event.id} · Correlação: {event.correlation_id||'Não registrada'}</small></details>}):<p>Nenhum evento encontrado neste período e com estes filtros.</p>}
   <div className="op-form-footer"><button className="op-small-button" onClick={()=>apply({...filters,cursor:undefined,upper:undefined})}>Atualizar desde o início</button><button className="op-small-button" disabled={!data.next_cursor} onClick={()=>{if(data.next_cursor)apply({...filters,upper:data.upper,cursor:data.next_cursor})}}>Eventos mais antigos</button></div>
  </>}
 </section>;
}

const editableProductFields={name:'Nome',description:'Descrição',category:'Categoria',sku:'Código (SKU)',supplier:'Fornecedor descritivo',location:'Localização descritiva'};
type Correction=z.infer<typeof adminRecordMutation>;
function ProductCorrection({db,company,companyName,record,onReauth,onSaved}:{db:SupabaseClient;company:string;companyName:string;record:Row;onReauth?:()=>void;onSaved:()=>void}){
 const [open,setOpen]=useState(false),[statusMode,setStatusMode]=useState(false),[prepared,setPrepared]=useState<Correction|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const request=useRef<AbortController|null>(null),saving=useRef(false);
 useEffect(()=>()=>request.current?.abort(),[]);
 if(!Number.isInteger(record.record_version)||num(record.record_version)<1)return <p>Correção indisponível até atualizar o banco e consultar a versão do produto.</p>;
 function review(form:HTMLFormElement){
  const values=new FormData(form),patch:Record<string,string>={};
  for(const key of Object.keys(editableProductFields)){const next=str(values.get(key));if(next!==str(record[key]))patch[key]=next}
  const parsed=adminRecordMutation.safeParse({company,operation:statusMode?(record.deleted_at?'admin.product.restore':'admin.product.archive'):'admin.product.correct',key:crypto.randomUUID(),data:{id:record.id,version:record.record_version,reason:values.get('reason'),...(statusMode?{}:{patch})}});
  if(!parsed.success){setError('Altere pelo menos um campo permitido e informe uma justificativa de 10 a 1.000 caracteres.');return}
  setError('');setPrepared(parsed.data);
 }
 async function save(){
  if(!prepared||saving.current)return;saving.current=true;setBusy(true);setError('');const controller=new AbortController();request.current=controller;
  try{
   const {data}=await db.auth.getSession();if(!data.session)throw Error('Entre na conta administrativa.');
   if(controller.signal.aborted)return;
   const response=await fetch('/api/admin/records',{method:'PATCH',headers:{Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},body:JSON.stringify(prepared),signal:controller.signal});
   const payload=z.object({error:z.string().optional(),data:z.object({id:z.string().uuid(),version:z.number().int(),correlation:z.string().uuid()}).optional()}).parse(await response.json());
   if(!response.ok)throw Error(payload.error||'Correção não concluída.');
   if(payload.data?.id!==record.id||payload.data?.correlation!==prepared.key)throw Error('Resposta inesperada. Atualize a consulta para conferir o registro.');
   if(!controller.signal.aborted)onSaved();
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Resposta não recebida. Tente novamente com esta mesma revisão.');}
  finally{saving.current=false;if(!controller.signal.aborted)setBusy(false)}
 }
 if(!open)return <div className="op-form-footer"><button className="op-small-button" onClick={()=>{setStatusMode(false);setOpen(true)}}>Corrigir dados cadastrais</button><button className="op-small-button" onClick={()=>{setStatusMode(true);setOpen(true)}}>{record.deleted_at?'Reativar produto':'Inativar produto'}</button></div>;
 return <section aria-label="Correção de produto"><h4>{statusMode?(record.deleted_at?'Reativar produto':'Inativar produto'):'Corrigir produto'} · {companyName||company}</h4>{statusMode?<p>A inativação preserva o registro e exige saldo zerado, pedidos concluídos e ausência de produção pendente. A reativação permite voltar a utilizar o produto. Nenhum histórico é excluído.</p>:null}<p>Nome, descrição e organização do catálogo. Estoque, custo, preço e autoria original permanecem preservados.</p><small>Produto: {str(record.id)} · Versão: {num(record.record_version)}</small>
  {error?<p role="alert" className="op-error">{error}</p>:null}
  <form hidden={!!prepared} onSubmit={e=>{e.preventDefault();review(e.currentTarget)}}><div className="adm-audit-filters">{!statusMode&&Object.entries(editableProductFields).map(([key,label])=><label key={key}>{label}{key==='description'?<textarea name={key} defaultValue={str(record[key])} maxLength={2000}/>:<input name={key} defaultValue={str(record[key])} maxLength={key==='name'?160:240} required={key==='name'||key==='category'}/>}</label>)}</div><label>Justificativa<textarea name="reason" minLength={10} maxLength={1000} required placeholder="Explique por que esta correção é necessária."/></label><button className="primary">Revisar alterações</button></form>
  {prepared?<><h4>Confira antes de salvar</h4><div className="op-table-scroll"><table className="op-table"><thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead><tbody>{'patch' in prepared.data?Object.entries(prepared.data.patch).map(([key,value])=><tr key={key}><th>{editableProductFields[key as keyof typeof editableProductFields]}</th><td>{str(record[key])||'—'}</td><td>{value||'—'}</td></tr>):<tr><th>Situação</th><td>{record.deleted_at?'Inativo':'Ativo'}</td><td>{record.deleted_at?'Ativo':'Inativo'}</td></tr>}</tbody></table></div><p>Justificativa: {prepared.data.reason}</p><p>Para salvar, confirme sua identidade com o segundo fator nos últimos cinco minutos. Se o produto mudou, atualize a consulta e refaça a revisão.</p><div className="op-form-footer"><button className="op-small-button" disabled={busy} onClick={()=>setPrepared(null)}>Voltar aos campos</button>{onReauth?<button className="op-small-button" disabled={busy} onClick={onReauth}>Confirmar identidade</button>:null}<button className="primary" disabled={busy} onClick={()=>void save()}>{busy?'Salvando…':statusMode?'Confirmar situação':'Confirmar correção'}</button></div></>:null}
 </section>;
}

function RecordDetails({db,company,operation,record}:{db:SupabaseClient;company:string;operation:string;record:Row}){
 const detailOperation=operation==='orders'?'order_detail':operation==='titles'?'title_detail':null;
 const [detail,setDetail]=useState<Row|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  if(!detailOperation)return;const controller=new AbortController();
  read(db,{company,operation:detailOperation,filters:{id:record.id}},controller.signal).then(result=>{
   if(controller.signal.aborted)return;
   if(result.id!==record.id||result.business_id!==company)throw Error('O detalhe retornado não corresponde ao registro selecionado.');
   setDetail(result);
  }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Detalhes indisponíveis.')});
  return()=>controller.abort();
 },[db,company,detailOperation,record.id]);
 const value=detailOperation?detail:record;
 if(error)return <p className="op-error" role="alert">{error}</p>;
 if(!value)return <p role="status">Carregando itens e operações relacionadas…</p>;
 const related:Record<string,string>={items:'Itens do pedido',fulfillments:'Entregas e atendimentos',titles:'Títulos vinculados',payments:'Pagamentos e estornos'};
 const labels:Record<string,string>={id:'Identificador',name:'Nome',price:'Preço unitário',discount:'Desconto',fulfilled:'Atendido',unit:'Unidade',actor_id:'Autor',account_id:'Conta (ID)',warehouse_id:'Depósito (ID)',method:'Forma de pagamento',installment:'Parcela',competence_date:'Competência',product_id:'Produto (ID)',description:'Descrição',quantity:'Quantidade',unit_price:'Preço unitário',unit_cost:'Custo unitário',total:'Total',amount:'Valor',paid:'Liquidado',currency:'Moeda',type:'Natureza',due_date:'Vencimento',date:'Data',paid_at:'Pago em',created_at:'Criado em',created_by:'Autor',reversed_at:'Estornado em',cancelled_at:'Cancelado em',reason:'Justificativa'};
 return <><dl>{Object.entries(fields).filter(([key])=>key in value).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{render(value[key])}</dd></div>)}</dl>
  {Object.entries(related).filter(([key])=>key in value).map(([key,title])=>{const records=rows(value[key]);const columns=Object.entries(labels).filter(([field])=>records.some(row=>field in row));return <section key={key} className="adm-related-records"><h4>{title} · {records.length}</h4>{records.length?<div className="op-table-scroll"><table className="op-table"><caption>Empresa selecionada · moeda do documento: {str(value.currency)||'Consultar cada registro'}</caption><thead><tr>{columns.map(([field,label])=><th key={field}>{label}</th>)}</tr></thead><tbody>{records.map((row,i)=><tr key={str(row.id)||i}>{columns.map(([field])=><td key={field}>{render(row[field])}</td>)}</tr>)}</tbody></table></div>:<p>Nenhum registro relacionado.</p>}</section>})}
 </>;
}
