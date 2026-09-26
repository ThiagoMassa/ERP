import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';

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
  if(body.mode==='read'&&body.section==='maintenance'){
   const input=z.object({company:z.string().uuid(),page:z.number().int().min(0).max(100000).default(0),jobPage:z.number().int().min(0).max(100000).default(0),status:z.enum(['requested','running','verified','failed']).nullable().default(null)}).strict().safeParse(body.filters);
   if(!input.success)return reply({error:'Selecione uma empresa e filtros válidos.'},400);
   const {company,page,jobPage,status}=input.data;
   const {data,error}=await db.rpc('erp_read_maintenance',{p_company:company,p_page:page,p_job_page:jobPage,p_status:status});
   if(error)return reply({error:error.code==='PGRST202'?'Backups aguardando instalação do controle de manutenção.':'Consulta indisponível. Verifique sua sessão administrativa.'},403);
   return reply({data});
  }
  if(body.mode==='command'&&body.action==='maintenance.request'){
   const input=z.object({kind:z.enum(['backup','restore']),company:z.string().uuid(),backup:z.string().uuid().nullable(),retention:z.number().int().min(1).max(3650),version:z.number().int().positive(),reason:z.string().trim().min(10).max(1000),confirmCompany:z.string().uuid().nullable(),confirmBackup:z.string().uuid().nullable(),key:z.string().uuid()}).strict().safeParse(body.data);
   if(!input.success)return reply({error:'Confira a empresa, o backup, a retenção e a justificativa.'},400);
   const v=input.data;
   if(v.kind==='restore'&&(!v.backup||v.confirmCompany!==v.company||v.confirmBackup!==v.backup))return reply({error:'Confirme explicitamente a empresa e o backup.'},400);
   const {data,error}=await db.rpc('erp_request_maintenance',{p_kind:v.kind,p_company:v.company,p_backup:v.backup,p_retention:v.retention,p_version:v.version,p_reason:v.reason,p_confirm_company:v.confirmCompany,p_confirm_backup:v.confirmBackup,p_key:v.key});
   if(error)return reply({error:error.code==='PGRST202'?'Controle de manutenção aguardando instalação.':'Não foi possível autorizar a manutenção. Atualize a sessão e tente novamente.'},403);
   if(data?.ok===false)return reply({error:data.error},403);
   return reply({data});
  }
  if(body.mode==='read'&&body.section==='permission_matrix'){
   const input=z.object({company:z.string().uuid(),user:z.string().uuid()}).strict().safeParse(body.filters);
   if(!input.success)return reply({error:'Selecione uma empresa e um usuário vinculados.'},400);
   const {data,error}=await db.rpc('erp_admin_permission_matrix',{p_company:input.data.company,p_user:input.data.user,p_correlation:crypto.randomUUID()});
   if(error)return reply({error:error.code==='PGRST202'?'Consulta de permissões aguardando instalação.':'Consulta indisponível. Verifique a sessão administrativa e o vínculo selecionado.'},403);
   return reply({data});
  }
  if(body.mode!=='read'&&body.mode!=='command')return reply({error:'Operação inválida.'},400);
  const name=body.mode==='read'?'erp_admin_read':'erp_admin_command';
  const args=body.mode==='read'?{p_section:body.section,p_filters:body.filters||{}}:{p_action:body.action,p_data:body.data||{},p_correlation:crypto.randomUUID()};
  const {data,error}=await db.rpc(name,args);
  if(error)return reply({error:error.code==='PGRST202'?'Módulo administrativo aguardando instalação.':error.message},403);
  if(data?.ok===false)return reply({error:data.error},403);
  return reply({data});
 }catch{return reply({error:'Não foi possível processar a solicitação.'},400)}
}
