"use client";
import {useEffect,useRef,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Download,ChevronLeft,ChevronRight} from 'lucide-react';
import {z} from 'zod';
import {auditFilters,type AuditFilters} from '@/lib/admin-audit';

const rowSchema=z.object({id:z.string(),occurred_at:z.string(),actor_id:z.string().nullable(),company_id:z.string().nullable(),subject_id:z.string().nullable(),action:z.string(),entity:z.string().nullable(),reason:z.string().nullable(),result:z.string(),correlation_id:z.string(),before_data:z.unknown(),after_data:z.unknown()});
const resultSchema=z.object({rows:z.array(rowSchema),upper:z.string().nullable(),next:z.string().nullable(),correlation:z.string()});
type Results=z.infer<typeof resultSchema>;
const resultLabels:Record<string,string>={success:'Concluído',denied:'Negado',failed:'Falhou'};
const day=(date:Date)=>date.toISOString().slice(0,10);
async function query(db:SupabaseClient,mode:'read'|'export',filters:AuditFilters,signal:AbortSignal){
 const {data}=await db.auth.getSession();if(!data.session)throw new Error('Entre na conta administrativa.');
 const response=await fetch('/api/admin/audit',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},body:JSON.stringify({mode,filters}),signal});
 if(!response.ok){const failure=z.object({error:z.string()}).safeParse(await response.json());throw new Error(failure.success?failure.data.error:'Consulta indisponível.');}return response;
}
export function AdminAudit({db,company,onReauth}:{db:SupabaseClient;company:string;onReauth:()=>void}){
 const [filters,setFilters]=useState<AuditFilters>(()=>auditFilters.parse({company:company||null,from:day(new Date(Date.now()-29*86400000)),to:day(new Date())}));
 const [data,setData]=useState<Results|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[downloading,setDownloading]=useState(false),[previous,setPrevious]=useState<(string|null)[]>([]);
 const exportController=useRef<AbortController|null>(null),exporting=useRef(false);
 useEffect(()=>{
  const controller=new AbortController();
  query(db,'read',filters,controller.signal).then(async response=>{const envelope=z.object({data:resultSchema}).parse(await response.json());if(!controller.signal.aborted)setData(envelope.data)}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Consulta indisponível.')});
  return()=>{controller.abort();exportController.current?.abort()};
 },[db,filters]);
 function apply(form:HTMLFormElement){
  const f=new FormData(form),get=(key:string)=>String(f.get(key)||'').trim();
  const parsed=auditFilters.safeParse({company:company||null,from:get('from'),to:get('to'),actor:get('actor')||null,subject:get('subject')||null,entity:get('entity'),action:get('action'),result:get('result')||null});
  if(!parsed.success){setError('Confira os UUIDs e um período válido de até 366 dias.');return;}
  setError('');setNotice('');setData(null);setPrevious([]);setFilters(parsed.data);
 }
 function page(back=false){if(!data)return;const before=back?previous.at(-1)??null:data.next;if(!back&&!before)return;
  setPrevious(v=>back?v.slice(0,-1):[...v,filters.before]);setError('');setData(null);setFilters({...filters,before,upper:data.upper});
 }
 async function download(){
  if(exporting.current||!data)return;exporting.current=true;setDownloading(true);setError('');setNotice('');
  const controller=new AbortController();exportController.current=controller;
  try{
   const response=await query(db,'export',{...filters,before:null,upper:data.upper},controller.signal),blob=await response.blob();
   if(controller.signal.aborted)return;
   const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`auditoria-${filters.from}-${filters.to}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   setNotice('Exportação JSON preparada e registrada no histórico. Contém todos os resultados filtrados, até 5000 eventos.');
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Exportação indisponível.')}
  finally{exporting.current=false;if(!controller.signal.aborted)setDownloading(false)}
 }
 return <section className="adm-card adm-audit" aria-label="Histórico administrativo">
  <h2>Pesquisar o histórico</h2><p>Consulte ações por empresa, usuário ou registro. O período usa UTC; as datas da lista aparecem no horário deste dispositivo.</p>
  <form onSubmit={e=>{e.preventDefault();apply(e.currentTarget)}}>
   <fieldset disabled={downloading} className="adm-audit-filters"><legend>Filtros da consulta</legend>
    <label>De (UTC)<input name="from" type="date" defaultValue={filters.from} required/></label><label>Até (UTC)<input name="to" type="date" defaultValue={filters.to} required/></label>
    <label>Responsável (UUID)<input name="actor" placeholder="Quem realizou a ação"/></label><label>Usuário afetado (UUID)<input name="subject" placeholder="Conta envolvida"/></label>
    <label>Registro (ID exato)<input name="entity" maxLength={200} placeholder="Identificador do registro"/></label><label>Operação<input name="action" maxLength={160} placeholder="Ex.: membership ou tenant"/></label>
    <label>Resultado<select name="result"><option value="">Todos</option><option value="success">Concluído</option><option value="denied">Negado</option><option value="failed">Falhou</option></select></label>
    <button className="primary">Aplicar filtros</button>
   </fieldset>
  </form>
  {error?<p className="op-error" role="alert">{error}</p>:null}{notice?<p className="op-success" role="status">{notice}</p>:null}
  <p className="adm-audit-applied">Consulta aplicada: {filters.from} a {filters.to} (UTC) · {filters.result?resultLabels[filters.result]:'Todos os resultados'}{filters.action?` · Operação: ${filters.action}`:''}{filters.actor?` · Responsável: ${filters.actor}`:''}{filters.subject?` · Usuário: ${filters.subject}`:''}{filters.entity?` · Registro: ${filters.entity}`:''}. A exportação usa estes filtros.</p>
  <div className="op-form-footer"><button className="op-small-button" onClick={onReauth} disabled={downloading}>Confirmar identidade</button><button className="op-small-button" onClick={()=>void download()} disabled={!data||!data.rows.length||downloading}><Download size={16}/>{downloading?'Preparando…':'Exportar período em JSON'}</button></div>
  {!data&&!error?<p role="status">Consultando histórico…</p>:null}
  {data?<><p>{data.rows.length} eventos nesta página · página {previous.length+1}. Exportações exigem confirmação recente de identidade.</p>
   {data.rows.length?<div className="op-table-scroll"><table className="op-table"><thead><tr><th>Data / ID</th><th>Ação</th><th>Responsável</th><th>Resultado</th><th>Detalhes</th></tr></thead><tbody>{data.rows.map(row=><tr key={row.id}><td>{new Date(row.occurred_at).toLocaleString('pt-BR')}<small>#{row.id}</small></td><td>{row.action}</td><td><code>{row.actor_id||'Sistema'}</code></td><td>{resultLabels[row.result]||row.result}</td><td><details><summary>Ver evento</summary><dl><dt>Empresa</dt><dd>{row.company_id||'Contexto global'}</dd><dt>Usuário afetado</dt><dd>{row.subject_id||'—'}</dd><dt>Registro</dt><dd>{row.entity||'—'}</dd><dt>Justificativa</dt><dd>{row.reason||'—'}</dd><dt>Correlação</dt><dd>{row.correlation_id}</dd></dl><pre>{JSON.stringify({antes:row.before_data,depois:row.after_data},null,2)}</pre></details></td></tr>)}</tbody></table></div>:<p>Nenhum evento corresponde aos filtros. Ajuste o período ou os identificadores.</p>}
   <div className="op-form-footer"><button className="op-small-button" onClick={()=>page(true)} disabled={!previous.length||downloading}><ChevronLeft size={16}/> Anterior</button><button className="op-small-button" onClick={()=>page()} disabled={!data.next||downloading}>Próxima <ChevronRight size={16}/></button></div>
  </>:null}
 </section>;
}
