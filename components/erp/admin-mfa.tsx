"use client";
import {useEffect,useState} from 'react';
import Image from 'next/image';
import type {SupabaseClient} from '@supabase/supabase-js';
import {ShieldCheck} from 'lucide-react';
import {errorMessage} from '@/lib/operations';

export default function AdminMfa({db,onVerified}:{db:SupabaseClient;onVerified:()=>void}) {
 const [factor,setFactor]=useState(''),[qr,setQr]=useState(''),[code,setCode]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;db.auth.mfa.listFactors().then(({data,error})=>{
  if(!active)return;if(error)setError(error.message);else setFactor(data.totp.find(f=>f.status==='verified')?.id||'');setLoading(false);
 });return()=>{active=false}},[db]);
 async function enroll(){setBusy(true);setError('');try{
  const {data,error}=await db.auth.mfa.enroll({factorType:'totp',friendlyName:'Fluxo ADM '+new Date().toLocaleDateString()});
  if(error)throw error;setFactor(data.id);setQr(data.totp.qr_code);
 }catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
 async function verify(){setBusy(true);setError('');try{
  const {error}=await db.auth.mfa.challengeAndVerify({factorId:factor,code});if(error)throw error;
  setCode('');setQr('');onVerified();
 }catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
 return <section className="adm-mfa"><ShieldCheck size={32}/><h2>Proteja o acesso administrativo</h2><p>{factor?'Informe o código de seis dígitos do seu aplicativo autenticador.':'Ative o segundo fator com um aplicativo autenticador para acessar empresas e usuários.'}</p>
 {loading?<p role="status">Verificando segundo fator…</p>:!factor?<button className="primary" onClick={()=>void enroll()} disabled={busy}>Configurar autenticador</button>:<form onSubmit={e=>{e.preventDefault();void verify()}}>
 {qr&&<div className="adm-qr"><Image src={qr} unoptimized alt="QR code para configurar o autenticador" width={220} height={220}/><p>Escaneie com seu autenticador e confirme o primeiro código.</p></div>}
 <label>Código de autenticação<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} minLength={6} required value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} autoFocus/></label>
 <button className="primary" disabled={busy}>{busy?'Verificando…':'Confirmar acesso'}</button></form>}
 {error&&<p role="alert" className="op-error">{error}</p>}<small>Operações críticas exigem uma confirmação feita nos últimos cinco minutos.</small></section>;
}

