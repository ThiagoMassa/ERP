import {createClient} from '@supabase/supabase-js';
import {auditRequest} from '@/lib/admin-audit';
import {readBoundedBody} from '@/lib/server/asset-content';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});
 const authorization=request.headers.get('authorization');
 if(!authorization?.startsWith('Bearer '))return reply({error:'Entre na conta administrativa.'},401);
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)return reply({error:'Autenticação indisponível.'},503);
 try{
  const parsed=auditRequest.safeParse(JSON.parse(new TextDecoder().decode(await readBoundedBody(request,8192))));
  if(!parsed.success)return reply({error:'Confira os identificadores e um período de até 366 dias.'},400);
  const {mode,filters}=parsed.data;
  if(mode==='export'&&filters.before)return reply({error:'Exporte o período completo, sem cursor de página.'},400);
  const db=createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:identity,error}=await db.auth.getUser(authorization.slice(7));
  if(error||!identity.user)return reply({error:'Sessão inválida.'},401);
  const result=await db.rpc('erp_admin_audit',{p_filters:filters,p_export:mode==='export'});
  if(result.error)return reply({error:result.error.code==='PGRST202'?'Consulta avançada de auditoria aguardando instalação.':mode==='export'?'Exportação não concluída. Confirme a identidade e reduza os filtros para até 5000 eventos.':'Consulta não autorizada ou indisponível.'},result.error.code==='PGRST202'?503:403);
  if(mode==='export')return Response.json({period:{from:filters.from,to:filters.to,time_zone:'UTC'},filters,...result.data},{headers:{...headers,'Content-Disposition':`attachment; filename="auditoria-${filters.from}-${filters.to}.json"`}});
  return reply({data:result.data});
 }catch{return reply({error:'Não foi possível processar a consulta.'},400);}
}
