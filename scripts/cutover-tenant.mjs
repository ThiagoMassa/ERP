// Private operator process. Must not run in the web service.
import postgres from 'postgres';
import {runTenantCutover} from '../lib/server/tenant-cutover.ts';
import {openLegacyPhotoBundle} from '../lib/server/legacy-photo-bundle.ts';
import {operatorConnection} from '../lib/server/operator-connection.ts';
import {tenantIdentity,tenantConnectionOptions,TenantConfigurationError} from '../lib/server/tenant-identity.ts';

if(process.argv.includes('--help')){
 console.log('Uso: node --experimental-strip-types scripts/cutover-tenant.mjs UUID_DA_SOLICITACAO\nLeia TENANT-DATABASES.md e TENANT-ASSETS.md. Conexões e ERP_LEGACY_PHOTO_MANIFEST são lidos do ambiente privado. A solicitação central precisa de MFA recente.');
 process.exit(0);
}
const pools=[];
try{
 const jobId=tenantIdentity(process.argv[2]||'').company,env=process.env;
 const control=postgres(operatorConnection(env.ERP_CONTROL_OPERATOR_URL,env.ERP_CONTROL_CA));pools.push(control);
 const jobs=await control`select company_id from erp_control.cutovers where id=${jobId}`;
 if(jobs.length!==1)throw new TenantConfigurationError('NOT_FOUND','Solicitação de migração não encontrada.');
 const identity=tenantIdentity(jobs[0].company_id),runtimeConnection=env[identity.credentialRef];
 if(!runtimeConnection)throw new TenantConfigurationError('CONFIGURATION','Configure a credencial restrita da empresa no ambiente privado.');
 // Validate the runtime identity before creating a maintenance pool for its database.
 tenantConnectionOptions(runtimeConnection,identity.company,{ca:env.ERP_TENANT_CA});
 const cluster=operatorConnection(env.ERP_PROVISIONER_URL,env.ERP_TENANT_CA);
 const target=postgres({...cluster,database:identity.database});pools.push(target);
 const photoBundle=env.ERP_LEGACY_PHOTO_MANIFEST?await openLegacyPhotoBundle(env.ERP_LEGACY_PHOTO_MANIFEST,identity.company):undefined;
 const result=await runTenantCutover({control,target,runtimeConnection,jobId,photoBundle,ca:env.ERP_TENANT_CA});
 console.log(JSON.stringify(result));
}catch(error){
 console.error(error instanceof TenantConfigurationError?error.message:'Migração não concluída. Confira MFA, configuração privada e estado no painel. A origem não é desbloqueada automaticamente.');
 process.exitCode=1;
}finally{await Promise.all(pools.map(pool=>pool.end({timeout:2})));}
