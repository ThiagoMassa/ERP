// Operator-only command. Never import this script into the application or a route.
import postgres from 'postgres';
import {tenantIdentity,tenantConnectionOptions,TenantConfigurationError} from '../lib/server/tenant-identity.ts';
import {provisionTenant,tenantMigrations,inspectTenant} from '../lib/server/tenant-database.ts';
import {operatorConnection} from '../lib/server/operator-connection.ts';
import {tenantPreflight,assertProvisionPreflight} from '../lib/server/tenant-preflight.ts';

let maintenance;
try {
 const companyId=process.argv[2],identity=tenantIdentity(companyId||'');
 const runtimeUrl=process.env[identity.credentialRef];
 if(!runtimeUrl||!process.env.ERP_PROVISIONER_URL)throw new TenantConfigurationError('CONFIGURATION','Configure ERP_PROVISIONER_URL e a credencial exclusiva da empresa no ambiente privado do operador.');
 const runtime=tenantConnectionOptions(runtimeUrl,companyId,{ca:process.env.ERP_TENANT_CA});
 const settings=operatorConnection(process.env.ERP_PROVISIONER_URL,process.env.ERP_TENANT_CA);
 maintenance=postgres(settings);
 assertProvisionPreflight(await tenantPreflight(maintenance,companyId));
 const result=await provisionTenant({companyId,runtimePassword:runtime.password,maintenance,connectMaintenanceDatabase:database=>postgres({...settings,database}),migrations:await tenantMigrations()});
 const health=await inspectTenant(runtimeUrl,companyId,{ca:process.env.ERP_TENANT_CA});
 console.log(JSON.stringify({company:result.companyId,database:result.database,engineInstalled:health.engine_installed,reconciled:health.reconciled,state:result.state}));
 console.log('Estrutura verificada. A migração/conciliação dos dados e a ativação central ainda são necessárias.');
} catch(error) {
 // Do not print driver errors: SQL diagnostics may include connection secrets.
 console.error(error instanceof TenantConfigurationError?error.message:'Provisionamento não concluído. Confira conectividade, TLS e privilégios do operador. Nenhuma empresa foi ativada.');
 process.exitCode=1;
} finally {await maintenance?.end({timeout:2});}
