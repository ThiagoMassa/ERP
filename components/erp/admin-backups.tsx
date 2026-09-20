"use client";
import {useEffect,useRef,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Dialog} from 'radix-ui';
import {Archive,ArrowDownToLine,CheckCircle2,ChevronLeft,ChevronRight,Clock3,Database,RefreshCw,RotateCcw,ShieldCheck,X} from 'lucide-react';
import AdminMfa from './admin-mfa';
import {errorMessage,num,rows,str,type Row} from '@/lib/operations';

const labels:Record<string,string>={requested:'Aguardando execução',running:'Em execução',verified:'Recuperação verificada',failed:'Falha — requer atenção',complete:'Concluída',ready:'Pronto',suspended:'Em manutenção',pending:'Aguardando configuração',provisioning:'Em configuração',safety:'Cópia de segurança verificada',restoring:'Restaurando registros',restored:'Dados conferidos',activating:'Validando liberação'};
const date=(value:unknown)=>value?new Date(str(value)).toLocaleString('pt-BR'):'Ainda não realizado';
const bytes=(value:unknown)=>Number(value)>0?new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(Number(value)/1024/1024)+' MB':'—';
type Draft={kind:'backup'|'restore';backup:Row|null;key:string;reason:string;retention:number;resume:boolean};
type Command={kind:'backup'|'restore';company:string;backup:string|null;retention:number;version:number;reason:string;confirmCompany:string|null;confirmBackup:string|null;key:string};

async function request(db:SupabaseClient,body:Row,signal?:AbortSignal):Promise<Row>{
 const {data}=await db.auth.getSession();if(!data.session)throw new Error('Entre novamente na sua conta.');
 const response=await fetch('/api/admin',{method:'POST',signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},body:JSON.stringify(body)});
 const result=await response.json() as {error?:string;data:Row};if(!response.ok)throw new Error(result.error||'Não foi possível consultar a manutenção.');return result.data;
}

export function AdminBackups({db,company}:{db:SupabaseClient;company:string}){
 const [data,setData]=useState<Row|null>(null),[page,setPage]=useState(0),[jobPage,setJobPage]=useState(0),[status,setStatus]=useState('');
 const [revision,setRevision]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[actor,setActor]=useState('');
 const [draft,setDraft]=useState<Draft|null>(null),[identity,setIdentity]=useState(false),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
 const pending=useRef<Command|null>(null);
 useEffect(()=>{let active=true;db.auth.getSession().then(({data})=>{if(active)setActor(data.session?.user.id||'')});return()=>{active=false}},[db]);
 useEffect(()=>{
  if(!company)return;
  const abort=new AbortController();
  request(db,{mode:'read',section:'maintenance',filters:{company,page,jobPage,status:status||null}},abort.signal)
   .then(result=>{if(!abort.signal.aborted){setData(result);setError('')}})
   .catch(e=>{if(!abort.signal.aborted)setError(errorMessage(e))})
   .finally(()=>{if(!abort.signal.aborted)setLoading(false)});
  return()=>abort.abort();
 },[db,company,page,jobPage,status,revision]);
 function refresh(){setLoading(true);setRevision(v=>v+1)}
 function open(next:Draft){pending.current=null;setDraft(next);setConfirmed(false);setIdentity(false);setError('');setUncertain(false)}
 async function submit(){
  if(!draft||!data||busy)return;
  const command=pending.current??{kind:draft.kind,company,backup:draft.kind==='restore'?str(draft.backup?.id):null,retention:draft.retention,version:num(data.version),reason:draft.reason.trim(),confirmCompany:confirmed?company:null,confirmBackup:confirmed&&draft.kind==='restore'?str(draft.backup?.id):null,key:draft.key};
  if(command.reason.length<10||command.reason.length>1000||!Number.isInteger(command.retention)||command.retention<1||command.retention>3650){setError('Informe uma justificativa de 10 a 1000 caracteres e retenção de 1 a 3650 dias.');return;}
  if(command.kind==='restore'&&!confirmed){setError('Confirme a substituição dos dados da empresa selecionada.');return;}
  pending.current=command;setBusy(true);setError('');
  try{
   const result=await request(db,{mode:'command',action:'maintenance.request',data:command});
   setNotice(`Solicitação ${str(result.job)} registrada. A execução depende do operador privado; acompanhe abaixo.`);
   pending.current=null;setDraft(null);setUncertain(false);refresh();
  }catch(e){setError(errorMessage(e));setUncertain(true)}finally{setBusy(false)}
 }
 if(!company)return <section className="adm-card adm-backup-empty"><Database size={32}/><h2>Proteção por empresa</h2><p>Selecione uma empresa no contexto acima para consultar o banco exclusivo, os backups e as solicitações de recuperação.</p></section>;
 if(!data)return <section className="adm-card" aria-busy={loading}>{error?<><p className="op-error" role="alert">{error}</p><button className="op-small-button" onClick={refresh}>Tentar novamente</button></>:<p role="status">Consultando backups e autorizações…</p>}</section>;
 const backups=rows(data.backups),jobs=rows(data.jobs),available=data.provisioning==='ready'&&!data.busy&&!error;
 return <div className="adm-backups">
  <section className="adm-card adm-backup-summary"><div><p className="op-eyebrow">PROTEÇÃO DE DADOS</p><h2>{str(data.name)}</h2><p>Backups criptografados com teste real de recuperação. Somente cópias verificadas e dentro da retenção podem ser restauradas.</p></div><span className="adm-backup-state"><Database size={17}/>{labels[str(data.provisioning)]||str(data.provisioning)}</span></section>
  <div className="adm-backup-notice"><ShieldCheck size={21}/><p>As solicitações são autorizadas aqui e executadas pelo operador privado configurado no servidor. A restauração suspende as operações desta empresa até a conclusão. Fotos e arquivos 3MF ainda não estão incluídos nestas cópias de banco.</p></div>
  {notice&&<p className="op-success" role="status">{notice}</p>}{error&&!draft&&<p className="op-error" role="alert">{error}</p>}
  <section className="adm-card" aria-busy={loading}>
   <div className="adm-backup-heading"><div><h2><Archive size={20}/> Cópias de segurança</h2><p>{num(data.backup_count)} registro(s) neste filtro. Datas no fuso do seu navegador.</p></div><div className="adm-backup-actions"><button className="op-small-button" disabled={loading} onClick={refresh}><RefreshCw size={16}/> Atualizar</button><button className="primary" disabled={!available||loading} onClick={()=>open({kind:'backup',backup:null,key:crypto.randomUUID(),reason:'',retention:30,resume:false})}><ArrowDownToLine size={16}/> Solicitar backup</button></div></div>
   {!available&&<p className="adm-help">Para uma nova solicitação, o banco precisa estar pronto e sem manutenção pendente. Consulte o histórico abaixo para retomar uma falha.</p>}
   <label className="adm-backup-filter">Situação<select value={status} onChange={e=>{setStatus(e.target.value);setPage(0);setLoading(true)}}><option value="">Todas as situações</option>{['requested','running','verified','failed'].map(v=><option key={v} value={v}>{labels[v]}</option>)}</select></label>
   {backups.length?<div className="op-table-scroll"><table className="op-table"><thead><tr><th>Backup / criação</th><th>Situação</th><th>Última verificação</th><th>Retenção até</th><th>Tamanho</th><th>Ação</th></tr></thead><tbody>{backups.map(row=>{
    const expired=Boolean(row.expired),canRestore=available&&row.restore_eligible===true;
    return <tr key={str(row.id)}><td><time>{date(row.created_at)}</time><small className="adm-record-id">{str(row.id)}</small><small>{str(row.note)}</small></td><td><span className={'adm-backup-pill '+str(row.status)}>{row.status==='verified'?<CheckCircle2 size={15}/>:<Clock3 size={15}/>} {labels[str(row.status)]||str(row.status)}</span></td><td>{date(row.verified_at)}</td><td>{row.retention_until?date(row.retention_until):'Após a execução'}{expired&&<small className="adm-record-id">Prazo encerrado</small>}</td><td>{bytes(row.size_bytes)}</td><td><button className="op-small-button" disabled={!canRestore||loading} title={canRestore?'Revisar impacto e confirmar restauração':'Exige banco pronto e backup verificado dentro da retenção'} onClick={()=>open({kind:'restore',backup:row,key:crypto.randomUUID(),reason:'',retention:30,resume:false})}><RotateCcw size={15}/> Restaurar</button></td></tr>;
   })}</tbody></table></div>:<div className="op-empty"><Archive size={28}/><h3>Nenhum backup neste filtro</h3><p>Uma solicitação só será marcada como verificada depois de criar o arquivo e testar sua recuperação.</p></div>}
   <Pagination page={page} count={num(data.backup_count)} busy={loading} onPage={value=>{setPage(value);setLoading(true)}}/>
  </section>
  <section className="adm-card"><div className="adm-backup-heading"><div><h2>Solicitações e andamento</h2><p>O identificador acompanha cada etapa na auditoria. Uma falha de restauração mantém o acesso suspenso até a retomada.</p></div></div>
   {jobs.length?<div className="adm-backup-jobs">{jobs.map(job=><article key={str(job.id)}><div className="adm-backup-heading"><div><b>{job.kind==='restore'?'Restauração':'Backup'}</b><small className="adm-record-id">{str(job.id)}</small></div><span className={'adm-backup-pill '+str(job.status)}>{labels[str(job.status)]||str(job.status)}</span></div><p>{str(job.reason)}</p><dl><div><dt>Etapa</dt><dd>{labels[str(job.stage)]||str(job.stage)}</dd></div><div><dt>Atualização</dt><dd>{date(job.updated_at)}</dd></div><div><dt>Backup</dt><dd className="adm-record-id">{str(job.backup_id)}</dd></div>{Boolean(job.safety_id)&&<div><dt>Cópia anterior à restauração</dt><dd className="adm-record-id">{str(job.safety_id)}</dd></div>}</dl>{Boolean(job.failure_code)&&<p className="adm-help">A execução não foi concluída. O operador pode consultar a ocorrência {str(job.failure_code)} por este identificador.</p>}{job.status!=='complete'&&job.actor_id===actor&&<button className="op-small-button" onClick={()=>open({kind:job.kind==='restore'?'restore':'backup',backup:job.kind==='restore'?{id:job.backup_id}:null,key:str(job.id),reason:str(job.reason),retention:num(job.retention_days),resume:true})}><ShieldCheck size={16}/> Renovar autorização</button>}</article>)}</div>:<p className="adm-help">Nenhuma solicitação registrada.</p>}
   <Pagination page={jobPage} count={num(data.job_count)} busy={loading} onPage={value=>{setJobPage(value);setLoading(true)}}/>
  </section>
  <Dialog.Root open={!!draft} onOpenChange={value=>{if(!value&&!busy)setDraft(null)}}><Dialog.Portal><Dialog.Overlay className="op-overlay"/><Dialog.Content className="op-sheet adm-dialog adm-backup-dialog"><Dialog.Title>{draft?.resume?'Renovar autorização':draft?.kind==='restore'?'Revisar restauração':'Solicitar backup'}</Dialog.Title><Dialog.Description>Empresa: <strong>{str(data.name)}</strong>. Esta ação exige confirmação recente de dois fatores e será registrada na auditoria.</Dialog.Description><Dialog.Close className="op-close" disabled={busy} aria-label="Fechar"><X/></Dialog.Close>
   {identity?<AdminMfa db={db} onVerified={()=>{setIdentity(false);setError('')}}/>:draft&&<form onSubmit={e=>{e.preventDefault();void submit()}}>
    {draft.kind==='restore'&&<div className="adm-restore-impact"><h3>Os dados atuais serão substituídos</h3><p>Backup selecionado: <b className="adm-record-id">{str(draft.backup?.id)}</b></p><ol><li>As operações da empresa ficam suspensas.</li><li>Uma cópia do estado atual é criada e verificada, com retenção de 30 dias.</li><li>Os registros do backup são restaurados e conferidos.</li><li>O acesso é liberado após validação. As outras empresas permanecem independentes.</li></ol><p>Alterações posteriores ao backup deixam de aparecer no banco restaurado. Fotos e arquivos 3MF não são restaurados neste procedimento.</p></div>}
    {uncertain&&<p className="adm-help" role="status">A solicitação não foi confirmada. Ao tentar novamente, será usado o mesmo identificador para evitar duplicação.</p>}
    <label>Justificativa<textarea required minLength={10} maxLength={1000} readOnly={draft.resume||uncertain} value={draft.reason} onChange={e=>setDraft({...draft,reason:e.target.value})} placeholder="Explique o motivo desta operação"/></label>
    {draft.kind==='backup'&&<label>Retenção em dias<input type="number" min={1} max={3650} required readOnly={draft.resume||uncertain} value={draft.retention} onChange={e=>setDraft({...draft,retention:Number(e.target.value)})}/><small>Por quanto tempo esta cópia deve permanecer disponível (1 a 3650 dias).</small></label>}
    {draft.kind==='restore'&&<label className="adm-restore-confirm"><input type="checkbox" checked={confirmed} disabled={busy||uncertain} onChange={e=>setConfirmed(e.target.checked)}/><span>Confirmo a restauração de <strong>{str(data.name)}</strong> usando o backup identificado acima e compreendo a substituição dos dados.</span></label>}
    {error&&<p className="op-error" role="alert">{error}</p>}<div className="op-form-footer"><button className="op-small-button" type="button" disabled={busy} onClick={()=>setIdentity(true)}><ShieldCheck size={16}/> Confirmar identidade</button><button className={draft.kind==='restore'?'adm-destructive':'primary'} disabled={busy||(draft.kind==='restore'&&!confirmed)}>{busy?'Registrando…':draft.resume?'Renovar autorização':draft.kind==='restore'?'Autorizar restauração':'Autorizar backup'}</button></div>
   </form>}
  </Dialog.Content></Dialog.Portal></Dialog.Root>
 </div>;
}

function Pagination({page,count,busy,onPage}:{page:number;count:number;busy:boolean;onPage:(page:number)=>void}){
 return <footer className="adm-pagination"><span>{count} registro(s) · página {page+1} de {Math.max(1,Math.ceil(count/20))}</span><button disabled={busy||page===0} aria-label="Página anterior" onClick={()=>onPage(page-1)}><ChevronLeft size={18}/></button><button disabled={busy||(page+1)*20>=count} aria-label="Próxima página" onClick={()=>onPage(page+1)}><ChevronRight size={18}/></button></footer>;
}
