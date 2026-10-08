"use client";
import {useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Check,ChevronLeft,ChevronRight,Info,RefreshCw,ShieldCheck,X} from 'lucide-react';
import {z} from 'zod';
import {permissionActions,permissionModules,permissionRoles,permissionScopes,permissionOrigin} from '@/lib/admin-permissions';
import type {Row} from '@/lib/operations';

const peopleSchema=z.object({rows:z.array(z.object({id:z.string().uuid(),email:z.string().nullable(),status:z.string()})),count:z.number()});
const decisionSchema=z.object({allowed:z.boolean(),origin:z.string(),rules:z.array(z.object({scope:z.string(),action:z.string(),allowed:z.boolean()})).optional()});
const matrixSchema=z.object({company:z.string().uuid(),company_name:z.string(),user:z.string().uuid(),email:z.string().nullable(),role:z.string(),membership_active:z.boolean(),company_archived:z.boolean(),login_blocked:z.boolean(),permissions:z.record(z.record(decisionSchema)),overrides:z.array(z.object({id:z.string().uuid(),module:z.string(),action:z.string(),allowed:z.boolean(),version:z.number().int()})),checked_at:z.string()});
type Matrix=z.infer<typeof matrixSchema>;
type People=z.infer<typeof peopleSchema>;
async function readAdmin(db:SupabaseClient,section:string,filters:Row,signal:AbortSignal):Promise<unknown>{
 const {data}=await db.auth.getSession();
 if(!data.session)throw new Error('Entre novamente na conta administrativa.');
 const response=await fetch('/api/admin',{method:'POST',signal,headers:{Authorization:`Bearer ${data.session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({mode:'read',section,filters})});
 const payload=z.object({data:z.unknown().optional(),error:z.string().optional()}).parse(await response.json());
 if(!response.ok)throw new Error(typeof payload.error==='string'?payload.error:'Consulta indisponível.');
 return payload.data;
}

export function AdminPermissionMatrix({db,company,onRule}:{db:SupabaseClient;company:string;onRule:(row:Row)=>void}){
 const [query,setQuery]=useState(''),[page,setPage]=useState(0),[user,setUser]=useState(''),[revision,setRevision]=useState(0);
 const [result,setResult]=useState<{key:string;data?:People;error?:string}|null>(null);
 const requestKey=JSON.stringify([company,query,page,revision]);
 useEffect(()=>{
  const controller=new AbortController();
  const timer=setTimeout(()=>{
   readAdmin(db,'users',{company,query,page,size:20},controller.signal).then(value=>{
    const parsed=peopleSchema.parse(value);if(!controller.signal.aborted)setResult({key:requestKey,data:parsed});
   }).catch(e=>{if(!controller.signal.aborted)setResult({key:requestKey,error:e instanceof Error?e.message:'Não foi possível carregar os usuários.'});});
  },250);
  return()=>{clearTimeout(timer);controller.abort();};
 },[db,company,query,page,requestKey]);
 const current=result?.key===requestKey?result:null;
 return <div className="adm-permission-panel">
  <header><ShieldCheck size={24} aria-hidden="true"/><div><h3>Acesso efetivo por usuário</h3><p>Selecione um vínculo para conferir as decisões calculadas pelo servidor e entender quais regras prevalecem.</p></div></header>
  <div className="adm-permission-picker">
   <label>Buscar usuário vinculado<input type="search" value={query} placeholder="E-mail ou identificador completo" onChange={e=>{setQuery(e.target.value);setPage(0);setUser('');}}/></label>
   <label>Usuário<select value={user} disabled={!current?.data} onChange={e=>setUser(e.target.value)}><option value="">Selecione um usuário</option>{current?.data?.rows.map(person=><option key={person.id} value={person.id}>{person.email||person.id}{person.status!=='active'?' · conta restrita':''}</option>)}</select></label>
   <button type="button" className="op-small-button" onClick={()=>setRevision(v=>v+1)}><RefreshCw size={15}/> Atualizar acesso</button>
  </div>
  {!current?<p role="status">Buscando vínculos…</p>:current.error?<p className="op-error" role="alert">{current.error}</p>:current.data?<div className="adm-permission-pages"><span>{current.data.count} usuário(s) vinculado(s){current.data.count>20?` · página ${page+1}`:''}</span><button type="button" disabled={page===0} aria-label="Usuários anteriores" onClick={()=>{setPage(v=>v-1);setUser('');}}><ChevronLeft size={16}/></button><button type="button" disabled={(page+1)*20>=current.data.count} aria-label="Próximos usuários" onClick={()=>{setPage(v=>v+1);setUser('');}}><ChevronRight size={16}/></button></div>:null}
  {user?<PermissionSnapshot key={`${company}:${user}:${revision}`} db={db} company={company} user={user} onRule={onRule}/>:<p className="adm-permission-placeholder"><Info size={17} aria-hidden="true"/> A consulta não altera permissões. Cada mudança exige justificativa e confirmação de identidade.</p>}
 </div>;
}

function PermissionSnapshot({db,company,user,onRule}:{db:SupabaseClient;company:string;user:string;onRule:(row:Row)=>void}){
 const [matrix,setMatrix]=useState<Matrix|null>(null),[error,setError]=useState('');
 const [selected,setSelected]=useState<{module:string;action:string}|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  readAdmin(db,'permission_matrix',{company,user},controller.signal).then(value=>{
   const parsed=matrixSchema.parse(value);
   if(parsed.company!==company||parsed.user!==user)throw new Error('O contexto da consulta mudou. Atualize a tela.');
   if(!controller.signal.aborted)setMatrix(parsed);
  }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Consulta indisponível.');});
  return()=>controller.abort();
 },[db,company,user]);
 if(error)return <p className="op-error" role="alert">{error}</p>;
 if(!matrix)return <p role="status">Consultando regras e perfil no servidor…</p>;
 const detail=selected?matrix.permissions[selected.module]?.[selected.action]:undefined;
 const override=selected?matrix.overrides.find(rule=>rule.module===selected.module&&rule.action===selected.action):undefined;
 const moduleLabel=permissionModules.find(([key])=>key===selected?.module)?.[1];
 const actionLabel=permissionActions.find(([key])=>key===selected?.action)?.[1];
 return <>
  <div className="adm-permission-context"><div><b>{matrix.email||matrix.user}</b><span>{matrix.company_name} · {permissionRoles[matrix.role]||matrix.role}</span></div><small>Consultado em {new Date(matrix.checked_at).toLocaleString('pt-BR')}</small></div>
  {(!matrix.membership_active||matrix.company_archived||matrix.login_blocked)&&<p className="adm-permission-warning" role="status">{!matrix.membership_active?'Vínculo suspenso. ':''}{matrix.company_archived?'Empresa arquivada. ':''}{matrix.login_blocked?'Login bloqueado. ':''}O acesso permanece indisponível enquanto essa restrição existir.</p>}
  <div className="op-table-scroll adm-matrix-scroll" role="region" aria-label="Matriz de permissões por módulo e ação" tabIndex={0}><table className="adm-matrix"><caption>Clique em uma decisão para ver a origem. “Disponível” habilita o módulo; “Visível” controla sua exibição no menu.</caption><thead><tr><th scope="col">Módulo</th>{permissionActions.map(([action,label])=><th scope="col" key={action}>{label}</th>)}</tr></thead><tbody>{permissionModules.map(([module,label])=><tr key={module}><th scope="row">{label}</th>{permissionActions.map(([action,name])=>{
   const decision=matrix.permissions[module]?.[action];
   return <td key={action}><button type="button" className={decision?.allowed?'is-allowed':'is-denied'} disabled={!decision} aria-pressed={selected?.module===module&&selected.action===action} aria-label={`${label}: ${name} — ${decision?.allowed?'permitido':'bloqueado'}`} title={decision?permissionOrigin(decision.origin):'Política ausente'} onClick={()=>setSelected({module,action})}>{decision?.allowed?<Check size={17} aria-hidden="true"/>:<X size={17} aria-hidden="true"/>}<span>{decision?.allowed?'Sim':'Não'}</span></button></td>;
  })}</tr>)}</tbody></table></div>
  {selected&&detail?<div className="adm-permission-detail" role="status"><div><h4>{moduleLabel} / {actionLabel}</h4><p><b>{detail.allowed?'Permitido':'Bloqueado'}</b> · {permissionOrigin(detail.origin)}</p>{detail.rules?.length?<ul>{detail.rules.map((rule,index)=><li key={index}>{permissionScopes[rule.scope]||rule.scope}: {permissionActions.find(([key])=>key===rule.action)?.[1]||rule.action} — {rule.allowed?'permitir':'bloquear'}</li>)}</ul>:<p>Decisão do perfil ou da situação do vínculo/empresa, sem regra individual aplicável.</p>}<small>Uma permissão individual não remove um bloqueio da empresa ou do perfil. As regras cadastradas podem ser editadas na lista abaixo.</small></div><button type="button" className="op-small-button" onClick={()=>onRule({company_id:company,scope:'user',subject:user,module:selected.module,action:selected.action,allowed:override?.allowed??detail.allowed,version:override?.version??0,...(override?{id:override.id}:{})})}>{override?'Editar regra individual':'Criar regra individual'}</button></div>:<p className="adm-permission-placeholder">Selecione uma célula para entender a decisão e preparar uma regra individual.</p>}
 </>;
}
