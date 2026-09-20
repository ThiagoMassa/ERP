"use client";
import {AdminBackups} from './admin-backups';
import {AdminDatabaseCheck} from './admin-database-check';
import {AdminPermissionMatrix} from './admin-permission-matrix';
import {permissionActions,permissionModules,permissionRoles,permissionScopes} from '@/lib/admin-permissions';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {createClient,type Session,type SupabaseClient} from '@supabase/supabase-js';
import {ShieldCheck,Building2,Users,KeyRound,History,Database,LayoutDashboard,LogOut,Menu,X,RefreshCw,ChevronLeft,ChevronRight} from 'lucide-react';
import {Dialog} from 'radix-ui';
import AccountDialog from './account-dialog';
import AdminMfa from './admin-mfa';
import {Fields,values,type FieldSpec} from './operation-fields';
import {str,num,rows,errorMessage,type Row} from '@/lib/operations';

const sections=[{id:'overview',name:'Visão global',icon:LayoutDashboard},{id:'companies',name:'Empresas',icon:Building2},{id:'users',name:'Usuários e vínculos',icon:Users},{id:'permissions',name:'Permissões',icon:KeyRound},{id:'audit',name:'Auditoria',icon:History},{id:'backups',name:'Bancos e backups',icon:Database}];
const statusNames:Record<string,string>={active:'Ativo',blocked:'Bloqueado',suspended:'Suspenso',pending:'Pendente',provisioning:'Em configuração',ready:'Pronto',failed:'Falhou',success:'Concluído',denied:'Negado',requested:'Solicitado',running:'Em andamento',verified:'Verificado'};
const statusLabel=(v:unknown)=>statusNames[str(v)]||str(v);
async function api(db:SupabaseClient,body:Row):Promise<Row>{
 const {data}=await db.auth.getSession();if(!data.session)throw new Error('Entre na sua conta.');
 const response=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},body:JSON.stringify(body)});
 const result=await response.json() as {error?:string;data:Row};if(!response.ok)throw new Error(result.error||'Falha na administração.');return result.data;
}

export default function AdminWorkspace(){
 const [db,setDb]=useState<SupabaseClient|null>(null),[session,setSession]=useState<Session|null>(null),[boot,setBoot]=useState(true),[error,setError]=useState('');
 useEffect(()=>{let active=true;let unsubscribe:undefined|(()=>void);fetch('/api/config').then(r=>r.json() as Promise<{url:string;key:string}>).then(async c=>{
  if(!c.url||!c.key)throw new Error('Configuração indisponível.');if(!active)return;
  const client=createClient(c.url,c.key,{auth:{flowType:'pkce'}});setDb(client);
  const listener=client.auth.onAuthStateChange((_event,s)=>{if(active)setSession(s)});unsubscribe=()=>listener.data.subscription.unsubscribe();
  const {data,error}=await client.auth.getSession();if(error)throw error;if(active)setSession(data.session);
 }).catch(e=>active&&setError(errorMessage(e))).finally(()=>active&&setBoot(false));return()=>{active=false;unsubscribe?.()}},[]);
 return <div className="adm-app"><header className="adm-topbar"><Link href="/" className="adm-brand">fluxo<span>controle</span></Link><span className="adm-badge"><ShieldCheck size={15}/> ADMINISTRADOR GLOBAL</span><span>{session?.user.email||'Acesso administrativo'}</span>{session&&<button onClick={()=>void db?.auth.signOut()} aria-label="Sair"><LogOut size={18}/></button>}</header>
 {boot?<main className="adm-gate" role="status">Verificando acesso…</main>:!session||!db?<main className="adm-gate"><ShieldCheck size={32}/><h1>Administração global</h1><p>Entre com a conta autorizada. A validação de dois fatores será solicitada em seguida.</p><AccountDialog db={db} google={false} recovery={false} allowSignup={false} onDone={()=>{}}/>{error&&<p className="op-error" role="alert">{error}</p>}<Link href="/">Voltar ao ERP</Link></main>:<AuthorizedAdmin key={session.user.id} db={db}/>}
 </div>;
}

function AuthorizedAdmin({db}:{db:SupabaseClient}){
 const [context,setContext]=useState<Row|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;api(db,{mode:'read',section:'context'}).then(v=>{if(active)setContext(v)}).catch(e=>active&&setError(errorMessage(e)));return()=>{active=false}},[db,revision]);
 if(error)return <main className="adm-gate"><h1>Acesso indisponível</h1><p role="alert">{error}</p><Link href="/">Voltar ao ERP</Link></main>;
 if(!context)return <main className="adm-gate" role="status">Validando autorização no servidor…</main>;
 if(!context.eligible)return <main className="adm-gate"><h1>Acesso exclusivo</h1><p>Esta conta não possui autorização de administrador global.</p><Link href="/">Voltar ao ERP</Link></main>;
 if(context.aal!=='aal2')return <main className="adm-gate"><AdminMfa db={db} onVerified={()=>setRevision(v=>v+1)}/></main>;
 return <AdminPanel db={db}/>;
}

function AdminPanel({db}:{db:SupabaseClient}){
 const [section,setSection]=useState('overview'),[company,setCompany]=useState(''),[companies,setCompanies]=useState<Row[]>([]),[menu,setMenu]=useState(false);
 const [query,setQuery]=useState(''),[page,setPage]=useState(0),[revision,setRevision]=useState(0),[modal,setModal]=useState<{type:string;row:Row}|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reauth,setReauth]=useState(false);
 useEffect(()=>{let active=true;api(db,{mode:'command',action:'access',data:{}}).catch(e=>active&&setError(errorMessage(e)));return()=>{active=false}},[db]);
 useEffect(()=>{let active=true;api(db,{mode:'read',section:'companies',filters:{size:100}}).then(v=>active&&setCompanies(rows(v.rows))).catch(e=>active&&setError(errorMessage(e)));return()=>{active=false}},[db,revision]);
 const selected=companies.find(c=>c.id===company);
 function navigate(next:string){setSection(next);setPage(0);setQuery('');setError('');setMenu(false)}
 async function save(form:HTMLFormElement){if(!modal||busy)return;setBusy(true);setError('');try{
  const data=values(form);await api(db,{mode:'command',action:modal.type,data:{...data,company:modal.type==='membership.save'?(modal.row.company_id||data.company):(modal.row.company_id||modal.row.id||company),user:modal.type.startsWith('user.')||modal.type==='membership.save'?(modal.row.user_id||modal.row.id):undefined,version:modal.row.version??0}});
  setModal(null);setNotice('Alteração registrada na auditoria.');setRevision(v=>v+1);
 }catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
 const reason:FieldSpec={key:'reason',label:'Justificativa',type:'textarea',required:true,hint:'Descreva o motivo em pelo menos 10 caracteres.'};
 function formFields():FieldSpec[]{if(!modal)return [];
  const statuses:FieldSpec={key:'status',label:'Situação',options:[['active','Ativo'],['suspended','Suspenso'],['blocked','Bloqueado']]};
  if(modal.type==='company.update')return [{key:'legal_name',label:'Razão social'},{key:'document',label:'Documento'}, {...statuses,options:[['active','Ativa'],['suspended','Suspensa']]},reason];
  if(modal.type==='user.status')return [statuses,reason];
  if(modal.type==='provision.note')return [{key:'status',label:'Etapa',options:[['pending','Aguardando configuração'],['provisioning','Em configuração manual'],['failed','Falha identificada']]},reason];
  if(modal.type==='permission.save')return [{key:'scope',label:'Nível',options:[['company','Empresa'],['role','Perfil'],['user','Usuário']]},{key:'subject',label:'Destinatário',required:true,value:'*',hint:'Empresa: *. Perfil: admin, sales, purchases, stock, finance ou read. Na matriz, o usuário já vem selecionado.'},{key:'module',label:'Módulo',options:permissionModules.map(([key,label])=>[key,label])},{key:'action',label:'Ação',options:permissionActions.map(([key,label])=>[key,label])},{key:'allowed',label:'Regra',options:[['false','Bloquear'],['true','Permitir']]},reason];
  if(modal.type==='membership.save')return [{key:'company',label:'Empresa',required:true,options:companies.map(c=>[str(c.id),str(c.name)])},{key:'role',label:'Perfil',options:[['read','Leitura'],['admin','Administrador da empresa'],['sales','Comercial'],['purchases','Compras'],['stock','Estoque'],['finance','Financeiro']]},{key:'active',label:'Vínculo',options:[['true','Ativo'],['false','Suspenso']]},reason];
  return [reason];
 }
 return <><aside className={'adm-sidebar '+(menu?'open':'')}><div className="adm-sidebar-title">CENTRAL DE CONTROLE</div>{sections.map(s=><button key={s.id} aria-current={section===s.id?'page':undefined} onClick={()=>navigate(s.id)}><s.icon size={18}/>{s.name}</button>)}<Link href="/">Voltar ao meu ERP</Link><div className="adm-sidebar-note"><ShieldCheck size={22}/><b>Ações rastreáveis</b><p>Alterações exigem justificativa e ficam no histórico administrativo.</p></div></aside>
 <main className="adm-main"><div className="adm-banner"><button className="adm-menu" onClick={()=>setMenu(!menu)} aria-label="Abrir menu"><Menu size={20}/></button><ShieldCheck size={18}/><b>Você está em modo administrativo</b><span>{selected?str(selected.name):'Contexto global'}</span></div>
 <div className="adm-heading"><div><p className="op-eyebrow">ADMINISTRAÇÃO / {selected?str(selected.name):'GLOBAL'}</p><h1>{sections.find(s=>s.id===section)?.name}</h1><p>Controle de acesso, acompanhamento e histórico da plataforma.</p></div><button className="op-small-button" onClick={()=>setReauth(true)}><KeyRound size={16}/> Confirmar identidade</button></div>
 <div className="adm-toolbar"><label>Contexto<select value={company} onChange={e=>{setCompany(e.target.value);setPage(0);setQuery('');setModal(null);setError('')}}><option value="">Contexto global</option>{companies.map(c=><option key={str(c.id)} value={str(c.id)}>{str(c.name)}</option>)}</select></label>{section!=='overview'&&section!=='backups'&&<label>Buscar<input placeholder={section==='users'?'E-mail ou ID':section==='audit'?'Operação':'Nome'} value={query} onChange={e=>{setQuery(e.target.value);setPage(0)}}/></label>}<button className="op-small-button" onClick={()=>setRevision(v=>v+1)}><RefreshCw size={16}/> Atualizar</button></div>
 {error&&!modal&&<p role="alert" className="op-error">{error}</p>}{notice&&<p className="op-success" role="status">{notice}</p>}
 {section==='backups'?<AdminBackups key={[company,revision].join(':')} db={db} company={company}/>:<AdminContent key={[section,company,query,page,revision].join(':')} db={db} section={section} company={company} query={query} page={page} onPage={setPage} onAction={(type,row)=>{setError('');setModal({type,row})}}/>}
 </main>
 <Dialog.Root open={!!modal} onOpenChange={o=>{if(!o&&!busy)setModal(null)}}><Dialog.Portal><Dialog.Overlay className="op-overlay"/><Dialog.Content className="op-sheet adm-dialog"><Dialog.Title>{modal?.type==='database.inspect'?'Diagnóstico do banco':'Alteração administrativa'}</Dialog.Title><Dialog.Description>{modal?.type==='database.inspect'?'Identidade, conexão e preparação do banco exclusivo da empresa.':'Confira o contexto e descreva o motivo. A operação exige confirmação recente de dois fatores.'}</Dialog.Description><Dialog.Close className="op-close" disabled={busy} aria-label="Fechar"><X/></Dialog.Close>{modal?.type==='database.inspect'?<AdminDatabaseCheck key={str(modal.row.id)} db={db} company={str(modal.row.id)}/>:<form onSubmit={e=>{e.preventDefault();void save(e.currentTarget)}}><Fields fields={formFields()} row={modal?.row}/>{error&&<p role="alert" className="op-error">{error}</p>}<div className="op-form-footer"><button type="button" className="op-small-button" onClick={()=>setReauth(true)}>Confirmar identidade</button><button className="primary" disabled={busy}>{busy?'Salvando…':'Confirmar alteração'}</button></div></form>}</Dialog.Content></Dialog.Portal></Dialog.Root>
 <Dialog.Root open={reauth} onOpenChange={setReauth}><Dialog.Portal><Dialog.Overlay className="op-overlay"/><Dialog.Content className="op-sheet adm-dialog"><Dialog.Title>Confirmar identidade</Dialog.Title><Dialog.Description>Seu código autoriza operações críticas por cinco minutos.</Dialog.Description><Dialog.Close className="op-close" aria-label="Fechar"><X/></Dialog.Close><AdminMfa db={db} onVerified={()=>{setReauth(false);setError('');setNotice('Identidade confirmada. Você pode continuar a alteração.')}}/></Dialog.Content></Dialog.Portal></Dialog.Root></>;
}

function AdminContent({db,section,company,query,page,onPage,onAction}:{db:SupabaseClient;section:string;company:string;query:string;page:number;onPage:(p:number)=>void;onAction:(type:string,row:Row)=>void}){
 const [data,setData]=useState<Row|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;const timer=setTimeout(()=>{if(section==='permissions'&&!company){setData({rows:[],count:0});return}api(db,{mode:'read',section,filters:{company,query,page,size:20}}).then(v=>active&&setData(v)).catch(e=>active&&setError(errorMessage(e)))},200);return()=>{active=false;clearTimeout(timer)}},[db,section,company,query,page]);
 if(error)return <p role="alert" className="op-error">{error}</p>;
 if(!data)return <div className="adm-loading" role="status">Carregando dados do servidor…</div>;
 if(section==='overview')return <><div className="adm-metrics">{[['Empresas ativas','active_companies'],['Empresas suspensas','suspended_companies'],['Usuários cadastrados','users'],['Contas bloqueadas / suspensas','blocked_users'],['E-mails aguardando confirmação','pending_users'],['Bancos aguardando liberação','pending_databases'],['Falhas de provisionamento','failed_databases'],['Eventos negados ou falhos · 24 h','recent_errors']].map(([name,key])=><article key={key}><span>{name}</span><strong>{num(data[key])}</strong></article>)}</div><section className="adm-card"><h2>Últimas ações administrativas</h2>{rows(data.recent_audit).length?rows(data.recent_audit).map(r=><div className="adm-event" key={str(r.id)}><b>{str(r.action)}</b><span>{statusLabel(r.result)}</span><time>{new Date(str(r.occurred_at)).toLocaleString('pt-BR')}</time></div>):<p>Nenhuma ação registrada.</p>}</section></>;
 const records=rows(data.rows);const total=num(data.count);
 const columns:Record<string,[string,string][]>={companies:[['name','Empresa'],['legal_name','Razão social'],['status','Situação'],['members','Vínculos ativos'],['provisioning','Banco exclusivo']],users:[['email','E-mail'],['status','Conta'],['last_sign_in_at','Último acesso']],permissions:[['scope','Nível'],['subject','Destinatário'],['module','Módulo'],['action','Ação'],['allowed','Permissão']],audit:[['occurred_at','Data'],['action','Operação'],['actor_id','Responsável'],['result','Resultado'],['reason','Justificativa']],backups:[['company_id','Empresa (ID)'],['status','Situação'],['created_at','Solicitado'],['verified_at','Verificado'],['retention_until','Retenção']]};
 return <section className="adm-card">{section==='backups'&&<div className="adm-info"><h2>Provisionamento e proteção de dados</h2><p>Os bancos exclusivos aguardam configuração manual e verificação de conexão. Não há backup automático ou restauração disponíveis nesta versão. Um registro vazio não representa um backup realizado.</p><p>Acompanhe a etapa de configuração em Empresas. A ativação como “Pronto” exige verificação pelo servidor.</p></div>}{section==='permissions'&&<div className="adm-info"><h2>Regras de acesso</h2><p>{company?'Bloqueios explícitos prevalecem em todos os níveis. Consulte o acesso efetivo na matriz e gerencie abaixo as regras da empresa, dos perfis e dos usuários.':'Selecione uma empresa para consultar e configurar regras.'}</p>{company&&<button className="op-small-button" onClick={()=>onAction('permission.save',{company_id:company})}>Adicionar regra</button>}</div>}
 {section==='permissions'&&company&&<AdminPermissionMatrix key={company} db={db} company={company} onRule={row=>onAction('permission.save',row)}/>}
 {records.length?<div className="op-table-scroll"><table className="op-table"><thead><tr>{columns[section].map(([k,l])=><th key={k}>{l}</th>)}<th>Detalhes / ações</th></tr></thead><tbody>{records.map(r=><tr key={str(r.id)}>{columns[section].map(([k])=><td key={k}>{typeof r[k]==='boolean'?(r[k]?'Permitir':'Bloquear'):k.endsWith('_at')||k==='retention_until'?(r[k]?new Date(str(r[k])).toLocaleString('pt-BR'):'—'):(section==='permissions'?(k==='scope'?permissionScopes[str(r[k])]:k==='module'?permissionModules.find(([key])=>key===r[k])?.[1]:k==='action'?permissionActions.find(([key])=>key===r[k])?.[1]:k==='subject'&&r.scope==='role'?permissionRoles[str(r[k])]:null):null)||statusLabel(r[k])||'—'}</td>)}<td><div className="adm-row-actions">{section==='companies'&&<><button onClick={()=>onAction('company.update',r)}>Editar</button><button onClick={()=>onAction('database.inspect',r)}>Verificar banco</button><button onClick={()=>onAction('provision.note',r)}>Registrar etapa</button><small>{str(r.provisioning_note)}</small></>}{section==='users'&&<><button onClick={()=>onAction('user.status',r)}>Acesso</button><button onClick={()=>onAction('user.revoke',r)}>Revogar sessões</button><button onClick={()=>onAction('membership.save',{user_id:r.id})}>Adicionar vínculo</button>{rows(r.memberships).map(m=><button key={str(m.company_id)} onClick={()=>onAction('membership.save',{...m,user_id:r.id})}>{str(m.name)} · {str(m.role)} · {m.active?'ativo':'suspenso'}</button>)}</>}{section==='permissions'&&<button onClick={()=>onAction('permission.save',r)}>Editar regra</button>}{section==='audit'&&<details><summary>Ver alterações</summary><p>Correlação: {str(r.correlation_id)}</p><pre>{JSON.stringify({antes:r.before_data,depois:r.after_data},null,2)}</pre></details>}</div></td></tr>)}</tbody></table></div>:<div className="op-empty"><Database size={28}/><h3>Nenhum registro encontrado</h3><p>{query?'Tente outra busca ou ajuste o contexto.':'Os registros aparecerão quando houver operações.'}</p></div>}
 <footer className="adm-pagination"><span>{total} registro(s) · página {page+1}</span><button disabled={page===0} aria-label="Página anterior" onClick={()=>onPage(page-1)}><ChevronLeft size={18}/></button><button disabled={(page+1)*20>=total} aria-label="Próxima página" onClick={()=>onPage(page+1)}><ChevronRight size={18}/></button></footer></section>;
}
