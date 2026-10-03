import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {readBoundedBody} from '@/lib/server/asset-content';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const input=z.discriminatedUnion('mode',[
 z.object({mode:z.literal('read'),company:z.string().uuid()}).strict(),
 z.object({mode:z.literal('request'),company:z.string().uuid(),version:z.number().int().positive(),reason:z.string().trim().min(10).max(1000),confirmCompany:z.string().uuid(),correlation:z.string().uuid()}).strict(),
]);
export async function POST(request:Request){
 const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 const authorization=request.headers.get('authorization');
 if(!authorization?.startsWith('Bearer '))return reply({error:'Entre na conta administrativa.'},401);
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)return reply({error:'Autenticação indisponível.'},503);
 try{
  const parsed=input.safeParse(JSON.parse(new TextDecoder().decode(await readBoundedBody(request,8192))));
  if(!parsed.success)return reply({error:'Confira a empresa, a versão e a justificativa.'},400);
  const v=parsed.data;
  if(v.mode==='request'&&v.confirmCompany!==v.company)return reply({error:'Confirme a empresa selecionada.'},400);
  const db=createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:identity,error:authError}=await db.auth.getUser(authorization.slice(7));
  if(authError||!identity.user)return reply({error:'Sessão inválida. Entre novamente.'},401);
  // Both RPCs independently require a live ADM/AAL2 session; request also requires recent TOTP.
  const result=v.mode==='read'?await db.rpc('erp_read_cutover',{p_company:v.company}):await db.rpc('erp_request_cutover',{p_company:v.company,p_version:v.version,p_reason:v.reason,p_correlation:v.correlation});
  if(result.error)return reply({error:result.error.code==='PGRST202'?'Migração empresarial aguardando instalação do controle central.':'Não foi possível concluir. Atualize o estado da empresa e confirme novamente sua identidade.'},result.error.code==='PGRST202'?503:403);
  return reply({data:result.data});
 }catch{return reply({error:'Solicitação inválida ou indisponível. Atualize o acompanhamento antes de tentar novamente.'},400);}
}
