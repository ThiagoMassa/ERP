import 'server-only';
import {createClient} from '@supabase/supabase-js';
import postgres from 'postgres';
import {inspectTenant,assertTenantReady,tenantMigrations} from './tenant-database';
import {tenantIdentity,tenantConnectionOptions,TenantConfigurationError} from './tenant-identity';

export type TenantRequest = {company: string|null; mode: 'read'|'command'; operation: string; data: Record<string,unknown>; key?: string};

/** Each request rechecks the central live session and policies. No authorization cache. */
export async function executeTenantRequest(authorization: string, request: TenantRequest) {
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)throw new TenantConfigurationError('UNAVAILABLE','Autenticação indisponível.');
  const control=createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:identity,error:authError}=await control.auth.getUser(authorization.slice(7));
  if(authError||!identity.user)throw new TenantConfigurationError('UNAUTHENTICATED','Sessão inválida. Entre novamente.');
  const centralRead=request.mode==='read'&&['businesses','members','permissions'].includes(request.operation);
  const centralCommand=request.mode==='command'&&['business.save','business.archive','business.restore','member.save'].includes(request.operation);
  if(centralRead||centralCommand){
    const {data,error}=await control.rpc(centralRead?'erp_workspace_read':'erp_workspace_command',centralRead?
      {p_company:request.company,p_module:request.operation,p_filters:request.data}:
      {p_company:request.company,p_action:request.operation,p_data:request.data,p_key:request.key});
    if(error){
      if(error.code==='PGRST202')throw new TenantConfigurationError('UNAVAILABLE','O cadastro central está aguardando instalação.');
      if(error.code==='28000')throw new TenantConfigurationError('UNAUTHENTICATED','Sessão expirada ou revogada. Entre novamente.');
      if(error.code==='42501')throw new TenantConfigurationError('FORBIDDEN','Acesso negado ao cadastro desta empresa.');
      if(error.code==='40001')throw new TenantConfigurationError('CONFLICT','O cadastro foi alterado. Atualize os dados antes de salvar.');
      if(error.code==='P0001'||error.code==='55000')throw new TenantConfigurationError('INVALID_OPERATION',error.message.slice(0,300));
      throw new TenantConfigurationError('INVALID_OPERATION','Confira os dados e as permissões do cadastro.');
    }
    return data;
  }
  if(!request.company)throw new TenantConfigurationError('INVALID_OPERATION','Selecione uma empresa para continuar.');
  const {data:context,error}=await control.rpc('erp_tenant_context',{p_company:request.company});
  if(error||!context||context.actor!==identity.user.id||context.company!==request.company.toLowerCase()) {
    throw new TenantConfigurationError('FORBIDDEN','Empresa ou sessão indisponível para esta conta.');
  }
  const expected=tenantIdentity(request.company);
  if(context.provisioning!=='ready')throw new TenantConfigurationError('PROVISIONING_PENDING','O banco exclusivo desta empresa ainda está em preparação.');
  if(context.database_identity!==expected.database||context.credential_ref!==expected.credentialRef) {
    throw new TenantConfigurationError('IDENTITY_MISMATCH','A referência empresarial precisa ser validada pelo administrador.');
  }
  const connection=process.env[expected.credentialRef];
  if(!connection)throw new TenantConfigurationError('CREDENTIAL_MISSING','Conexão empresarial ainda não configurada no servidor.');
  const options={ca:process.env.ERP_TENANT_CA};
  const health=await inspectTenant(connection,request.company,options);
  assertTenantReady(health,await tenantMigrations());
  const sql=postgres(tenantConnectionOptions(connection,request.company,options));
  try {
    // Whitelist the context returned by the central DB. Never forward a client context.
    const trusted={actor:context.actor,company:context.company,expires_at:context.expires_at,permissions:context.permissions,epoch:context.access_epoch};
    const result=await sql`select tenant.dispatch(${sql.json(trusted)},${request.mode},${request.operation},${sql.json(request.data as postgres.JSONValue)},${request.key||null}) as data`;
    return result[0].data;
  } catch(error) {
    const code=error instanceof postgres.PostgresError?error.code:'';
    if(code==='42501'||code==='28000')throw new TenantConfigurationError('FORBIDDEN','Acesso negado ou autorização expirada. Atualize a tela.');
    if(code==='23505')throw new TenantConfigurationError('CONFLICT','Já existe um registro com esse código.');
    if(code==='P0001')throw new TenantConfigurationError('INVALID_OPERATION',error instanceof Error?error.message.slice(0,300):'Operação recusada.');
    throw new TenantConfigurationError('OPERATION_FAILED','Não foi possível concluir a operação empresarial. Nenhuma alteração parcial foi confirmada.');
  } finally {await sql.end({timeout:2});}
}
