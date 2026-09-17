import {createClient} from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
 const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 const authorization=request.headers.get('authorization');
 if(!authorization?.startsWith('Bearer '))return reply({error:'Entre na sua conta.'},401);
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)return reply({error:'Autenticação indisponível.'},503);
 if(Number(request.headers.get('content-length'))>32768)return reply({error:'Requisição muito grande.'},413);
 try {
  const raw=await request.text();if(raw.length>32768)return reply({error:'Requisição muito grande.'},413);
  const body=JSON.parse(raw);
  const db=createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:identity,error:authError}=await db.auth.getUser(authorization.slice(7));
  if(authError||!identity.user)return reply({error:'Sessão inválida. Entre novamente.'},401);
  if(body.mode!=='read'&&body.mode!=='command')return reply({error:'Operação inválida.'},400);
  const name=body.mode==='read'?'erp_admin_read':'erp_admin_command';
  const args=body.mode==='read'?{p_section:body.section,p_filters:body.filters||{}}:{p_action:body.action,p_data:body.data||{},p_correlation:crypto.randomUUID()};
  const {data,error}=await db.rpc(name,args);
  if(error)return reply({error:error.code==='PGRST202'?'Módulo administrativo aguardando instalação.':error.message},403);
  if(data?.ok===false)return reply({error:data.error},403);
  return reply({data});
 }catch{return reply({error:'Não foi possível processar a solicitação.'},400)}
}

