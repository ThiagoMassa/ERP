"use client";
import {useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {CheckCircle2,Clock3,Database,RefreshCw} from 'lucide-react';
import {z} from 'zod';

const reportSchema=z.object({company:z.string(),name:z.string(),database:z.string(),stage:z.string(),provisioning:z.string(),checked_at:z.string(),checks:z.array(z.object({label:z.string(),ok:z.boolean()})),message:z.string()});
type Report=z.infer<typeof reportSchema>;
export function AdminDatabaseCheck({db,company}:{db:SupabaseClient;company:string}) {
 const [report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  async function load(){try {
   const {data}=await db.auth.getSession();
   const response=await fetch('/api/admin/database',{method:'POST',signal:controller.signal,headers:{Authorization:`Bearer ${data.session?.access_token||''}`,'Content-Type':'application/json'},body:JSON.stringify({company})});
   const value=await response.json();if(!response.ok){const failure=z.object({error:z.string()}).safeParse(value);throw new Error(failure.success?failure.data.error:'Diagnóstico indisponível.');}
   const parsed=reportSchema.safeParse(value);if(!parsed.success)throw new Error('Resposta de diagnóstico inválida. Tente novamente.');
   if(!controller.signal.aborted)setReport(parsed.data);
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Diagnóstico indisponível.')}}
  void load();return()=>controller.abort();
 },[db,company,revision]);
 return <div className="adm-database-check">
  <div className="adm-info"><Database size={22}/><p>Confira a conexão e as etapas de preparação. A verificação consulta o servidor e não modifica o estado da empresa.</p></div>
  {error?<p className="op-error" role="alert">{error}</p>:!report?<p role="status">Verificando credencial e conexão…</p>:<>
   <h3>{report.name}</h3><p className="adm-database-id">Banco lógico: <code>{report.database}</code></p>
   <ul className="adm-database-steps">{report.checks.map(check=><li key={check.label}>{check.ok?<CheckCircle2 size={19} aria-hidden="true"/>:<Clock3 size={19} aria-hidden="true"/>}<span>{check.label}</span><b>{check.ok?'Verificado':'Pendente'}</b></li>)}</ul>
   <p role="status">{report.message}</p><small>Verificado em {new Date(report.checked_at).toLocaleString('pt-BR')}</small>
  </>}
  <div className="op-form-footer"><button className="op-small-button" disabled={!report&&!error} onClick={()=>{setReport(null);setError('');setRevision(v=>v+1)}}><RefreshCw size={16}/> Verificar novamente</button></div>
 </div>;
}
