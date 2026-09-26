import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {inspectTenant,tenantMigrations} from '@/lib/server/tenant-database';
import {tenantIdentity,TenantConfigurationError} from '@/lib/server/tenant-identity';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request) {
 const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 const authorization=request.headers.get('authorization');
 if(!authorization?.startsWith('Bearer '))return reply({error:'Entre na conta administrativa.'},401);
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)return reply({error:'Autenticação indisponível.'},503);
 try {
  if(Number(request.headers.get('content-length'))>2048)return reply({error:'Solicitação inválida.'},400);
  const raw=await request.text();if(raw.length>2048)return reply({error:'Solicitação inválida.'},400);
  const parsed=z.object({company:z.string().uuid()}).strict().safeParse(JSON.parse(raw));
  if(!parsed.success)return reply({error:'Selecione uma empresa válida.'},400);
  const db=createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:identity,error}=await db.auth.getUser(authorization.slice(7));
  if(error||!identity.user)return reply({error:'Sessão inválida.'},401);
  // This RPC requires a live session, global ADM and verified AAL2, server-side.
  const company=await db.rpc('erp_admin_read',{p_section:'companies',p_filters:{company:parsed.data.company,size:1}});
  if(company.error||!company.data?.rows?.length)return reply({error:'Empresa indisponível ou acesso administrativo não autorizado.'},403);
  const audit=await db.rpc('erp_admin_command',{p_action:'access',p_data:{company:parsed.data.company},p_correlation:crypto.randomUUID()});
  if(audit.error||audit.data?.ok!==true)return reply({error:'Não foi possível registrar este acesso administrativo.'},403);
  const expected=tenantIdentity(parsed.data.company),record=company.data.rows[0];
  const details={company:expected.company,name:record.name,database:expected.database,provisioning:record.provisioning,checked_at:new Date().toISOString()};
  const connection=process.env[expected.credentialRef];
  if(!connection)return reply({...details,stage:'configuration',checks:[{label:'Credencial no servidor',ok:false}],message:'Configure a conexão exclusiva desta empresa no ambiente do servidor. Senhas não são cadastradas neste painel.'});
  try {
   const health=await inspectTenant(connection,expected.company,{ca:process.env.ERP_TENANT_CA});
   const migrations=await tenantMigrations();
   const schemaMatches=health.migrations.length===migrations.length&&migrations.every(m=>health.migrations.some(x=>x.version===m.version&&x.checksum===m.checksum));
   const checks=[{label:'Conexão e identidade da empresa',ok:health.identity_matches},{label:'Credencial restrita ao banco exclusivo',ok:health.runtime_restricted},{label:'Migrações verificadas',ok:schemaMatches},{label:'Rotinas operacionais instaladas',ok:health.engine_installed},{label:'Dados conciliados',ok:health.reconciled},{label:'Operação liberada no banco',ok:health.operational_state==='active'},{label:'Ativação registrada no controle central',ok:record.provisioning==='ready'}];
   const validated=checks.every(c=>c.ok);
   return reply({...details,stage:validated?'validated':'preparation',checks,message:validated?'Banco exclusivo conciliado e ativado. As verificações de conexão e estrutura passaram.':'Conclua as etapas pendentes antes da liberação. Esta verificação não altera o banco nem ativa a empresa.'});
  } catch(error) {
   return reply({...details,stage:'failed',checks:[{label:'Conexão, identidade e isolamento',ok:false}],message:error instanceof TenantConfigurationError?error.message:'Não foi possível verificar o banco. Confira a configuração no servidor.'});
  }
 } catch {return reply({error:'Não foi possível verificar a solicitação.'},400);}
}
