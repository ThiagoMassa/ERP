"use client";
import {useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Database,Search,ChevronLeft,ChevronRight} from 'lucide-react';
import {adminRecordRequest} from '@/lib/admin-records';
import {rows,str,num,type Row} from '@/lib/operations';
import {z} from 'zod';

const types=[['products','Produtos'],['partners','Clientes e fornecedores'],['orders','Pedidos e orçamentos'],['titles','Títulos financeiros'],['stock','Saldos de estoque'],['movements','Movimentações'],['jobs','Produção 3D'],['spools','Bobinas'],['printers','Impressoras'],['recipes','Receitas de produção']];
const fields:Record<string,string>={id:'Identificador',name:'Nome',description:'Descrição',sku:'Código',status:'Situação',kind:'Tipo',type:'Natureza',currency:'Moeda',cost:'Custo',price:'Preço',amount:'Valor',paid:'Liquidado',total:'Total',quantity:'Quantidade',unit:'Unidade',warehouse_name:'Depósito',date:'Data',due_date:'Vencimento',created_at:'Criado em',updated_at:'Atualizado em',created_by:'Autor',owner_id:'Proprietário original',version:'Versão',partner_name:'Cliente / fornecedor',email:'E-mail',phone:'Telefone',active:'Ativo',deleted_at:'Arquivado em',cancelled_at:'Cancelado em',reason:'Motivo'};
const render=(v:unknown)=>typeof v==='boolean'?(v?'Sim':'Não'):v===null||v===undefined?'—':str(v);
async function read(db:SupabaseClient,body:unknown,signal:AbortSignal):Promise<Row>{
 const parsed=adminRecordRequest.safeParse(body);if(!parsed.success)throw Error('Confira a empresa, a moeda (3 letras) e o período.');
 const {data}=await db.auth.getSession();if(!data.session)throw Error('Entre na conta administrativa.');
 const response=await fetch('/api/admin/records',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},body:JSON.stringify(parsed.data),signal});
 const payload=z.object({error:z.string().optional(),data:z.record(z.unknown()).optional()}).parse(await response.json());if(!response.ok)throw Error(payload.error||'Consulta indisponível.');if(!payload.data)throw Error('Resposta da consulta inválida.');return payload.data;
}
export function AdminRecords({db,company,companyName}:{db:SupabaseClient;company:string;companyName:string}){
 const today=new Date().toISOString().slice(0,10);
 const [query,setQuery]=useState({operation:'products',query:'',currency:'BRL',start:today.slice(0,8)+'01',end:today,page:0});
 const [data,setData]=useState<Row|null>(null),[error,setError]=useState(''),[selected,setSelected]=useState<Row|null>(null);
 useEffect(()=>{
  if(!company)return;const controller=new AbortController();
  read(db,{company,operation:query.operation,filters:{query:query.query,currency:query.currency,start:query.start,end:query.end,page:query.page,size:20}},controller.signal)
   .then(result=>{if(!controller.signal.aborted)setData(result)}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Consulta indisponível.')});
  return()=>controller.abort();
 },[db,company,query]);
 function change(next:typeof query){setData(null);setSelected(null);setError('');setQuery(next)}
 if(!company)return <section className="adm-card adm-records"><Database size={28}/><h2>Selecione uma empresa</h2><p>Escolha o contexto no topo para consultar os registros do banco exclusivo.</p></section>;
 const records=rows(data?.rows),count=num(data?.count);
 return <section className="adm-card adm-records" aria-label="Consulta administrativa de registros">
  <header><h2>Registros da empresa</h2><strong>{companyName||company}</strong><small>{company}</small><p>Consulta administrativa de leitura. Valores são exibidos na moeda registrada, sem conversão.</p></header>
  <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);change({operation:str(f.get('operation')),query:str(f.get('query')),currency:str(f.get('currency')).toUpperCase(),start:str(f.get('start')),end:str(f.get('end')),page:0})}}>
   <div className="adm-audit-filters"><label>Tipo de registro<select name="operation" defaultValue={query.operation}>{types.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>Nome ou descrição<input name="query" maxLength={160} defaultValue={query.query}/></label><label>Moeda (código)<input name="currency" minLength={3} maxLength={3} pattern="[A-Za-z]{3}" required defaultValue={query.currency}/></label><label>De<input name="start" type="date" required defaultValue={query.start}/></label><label>Até<input name="end" type="date" required defaultValue={query.end}/></label><button className="primary"><Search size={16}/> Consultar</button></div>
   <p>O período filtra pedidos pela data, títulos pelo vencimento e movimentações pela criação. A moeda filtra produtos, pedidos, títulos e saldos. A busca textual não se aplica às movimentações.</p>
  </form>
  <p className="adm-audit-applied">Consulta aplicada: {types.find(([id])=>id===query.operation)?.[1]} · {query.currency} · {query.start} a {query.end}{query.query?` · Busca: ${query.query}`:''}</p>
  {error?<p role="alert" className="op-error">{error}</p>:!data?<p role="status">Consultando banco da empresa…</p>:<>
   {records.length?<div className="op-table-scroll"><table className="op-table"><thead><tr><th>Registro</th><th>Situação / tipo</th><th>Moeda</th><th>Consulta</th></tr></thead><tbody>{records.map((r,i)=><tr key={str(r.id)||[r.product_id,r.warehouse_id,i].join(':')}><td>{str(r.name||r.description||r.partner_name)||'Sem descrição'}<small>{str(r.id||r.product_id)}</small></td><td>{str(r.status||r.kind||r.type)||'—'}</td><td>{str(r.currency)||'—'}</td><td><button className="op-small-button" onClick={()=>setSelected(r)}>Ver campos</button></td></tr>)}</tbody></table></div>:<p>Nenhum registro corresponde aos filtros aplicados.</p>}
   <div className="op-form-footer"><span>{count} registros · página {query.page+1}</span><button className="op-small-button" disabled={!query.page} onClick={()=>change({...query,page:query.page-1})}><ChevronLeft size={16}/>Anterior</button><button className="op-small-button" disabled={(query.page+1)*20>=count} onClick={()=>change({...query,page:query.page+1})}>Próxima<ChevronRight size={16}/></button></div>
  </>}
  {selected?<aside className="adm-record-detail" aria-label="Campos do registro"><h3>Campos do registro · {companyName||company}</h3><RecordDetails key={[company,query.operation,selected.id,selected.product_id,selected.warehouse_id].join(':')} db={db} company={company} operation={query.operation} record={selected}/><button className="op-small-button" onClick={()=>setSelected(null)}>Fechar campos</button></aside>:null}
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
