"use client";
import {useEffect,useRef,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {Database,RefreshCw,ShieldCheck} from 'lucide-react';

const schema=z.object({company:z.string().uuid(),name:z.string(),version:z.number(),location:z.enum(['legacy','migrating','tenant']),provisioning:z.string(),job:z.object({id:z.string().uuid(),status:z.string(),requested_at:z.string(),updated_at:z.string(),counts:z.record(z.number()).nullable(),failure_code:z.string().nullable(),correlation_id:z.string()}).nullable()});
type Progress=z.infer<typeof schema>;
const labels:Record<string,string>={requested:'Aguardando operador',running:'Copiando e conferindo',verified:'Dados conferidos',activated:'Banco exclusivo ativo',failed:'Migração interrompida'};
async function call(db:SupabaseClient,body:unknown,signal?:AbortSignal){
 const {data}=await db.auth.getSession();if(!data.session)throw new Error('Entre na conta administrativa.');
 const response=await fetch('/api/admin/cutover',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},body:JSON.stringify(body),signal});
 const value=z.object({error:z.string().optional(),data:z.unknown().optional()}).parse(await response.json());if(!response.ok)throw new Error(value.error||'Não foi possível consultar a migração.');return value.data;
}
export function AdminCutover({db,company,onReauth}:{db:SupabaseClient;company:string;onReauth:()=>void}){
 const [progress,setProgress]=useState<Progress|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false);
 const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
 const request=useRef<AbortController|null>(null),saving=useRef(false);
 useEffect(()=>{
  const controller=new AbortController();
  call(db,{mode:'read',company},controller.signal).then(v=>{const parsed=schema.parse(v);if(parsed.company!==company)throw new Error('Resposta de outra empresa recusada.');if(!controller.signal.aborted)setProgress(parsed)}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Consulta indisponível.')});
  return()=>{controller.abort();request.current?.abort()};
 },[db,company,revision]);
 const current=progress?.company===company?progress:null;
 function refresh(){setProgress(null);setError('');setConfirmed(false);setRevision(v=>v+1)}
 async function authorize(){
  if(!current||!confirmed||saving.current||reason.trim().length<10)return;
  saving.current=true;setBusy(true);setError('');setNotice('');
  const controller=new AbortController();request.current=controller;
  try{
   await call(db,{mode:'request',company,version:current.version,reason:reason.trim(),confirmCompany:company,correlation:crypto.randomUUID()},controller.signal);
   if(!controller.signal.aborted){setNotice('Solicitação registrada. A escrita no ERP antigo está bloqueada; acompanhe a execução do operador.');setReason('');refresh()}
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Resposta não recebida. Atualize o acompanhamento antes de repetir.')}
  finally{saving.current=false;if(!controller.signal.aborted)setBusy(false)}
 }
 return <section className="adm-cutover" aria-label="Migração empresarial">
  <div className="adm-info"><Database size={24} aria-hidden="true"/><p>Transfira os registros para o banco exclusivo e acompanhe as conferências do operador.</p></div>
  {error?<p className="op-error" role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
  {!current&&!error?<p role="status">Consultando preparação…</p>:null}
  {current?<>
   <h3>{current.name}</h3><p className="adm-database-id">Empresa: <code>{current.company}</code></p>
   <ol className="adm-cutover-stages"><li>Configurar o banco exclusivo</li><li>Autorizar e interromper gravações no ERP antigo</li><li>Copiar registros e arquivos; conferir saldos</li><li>Ativar após todas as verificações</li></ol>
   <div className="adm-card"><strong>{current.job?labels[current.job.status]||current.job.status:'Sem solicitação de migração'}</strong>
    {current.job?<><p>Solicitação: <code>{current.job.id}</code></p><small>Atualizada em {new Date(current.job.updated_at).toLocaleString('pt-BR')}</small>{current.job.counts?<dl className="adm-cutover-counts">{Object.entries(current.job.counts).map(([key,value])=><div key={key}><dt>{{businesses:'Empresas',products:'Produtos',entries:'Lançamentos',movements:'Movimentos',photos:'Fotos'}[key]||key}</dt><dd>{value}</dd></div>)}</dl>:null}{current.job.status==='failed'?<p>A origem permanece bloqueada. O operador deve revisar a falha antes de uma nova autorização. Código: {current.job.failure_code||'MIGRATION_FAILED'}</p>:null}</>:<p>Prepare a conexão e um backup verificado antes de autorizar.</p>}
   </div>
   {current.location!=='tenant'&&current.job?.status!=='running'?<form onSubmit={e=>{e.preventDefault();void authorize()}}>
    <p>Esta autorização bloqueia novas alterações no ERP antigo desta empresa. A liberação depende da cópia e da conferência pelo operador. Fotos antigas exigem uma exportação com gravações no Storage interrompidas.</p>
    <label className="op-field">Justificativa<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={10} maxLength={1000} required disabled={busy} placeholder="Descreva a janela de manutenção e o motivo da migração."/></label>
    <label className="adm-cutover-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/>Confirmo a interrupção das alterações em {current.name}.</label>
    <div className="op-form-footer"><button type="button" className="op-small-button" onClick={onReauth} disabled={busy}><ShieldCheck size={16}/> Confirmar identidade</button><button className="primary" disabled={busy||!confirmed||reason.trim().length<10}>{busy?'Registrando…':current.job?'Renovar autorização':'Autorizar migração'}</button></div>
   </form>:null}
  </>:null}
  <button className="op-small-button" onClick={refresh} disabled={busy}><RefreshCw size={16}/> Atualizar acompanhamento</button>
 </section>;
}
