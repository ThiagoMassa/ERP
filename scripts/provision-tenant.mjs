// Operator-only command. Never import this script into the application or a route.
import postgres from 'postgres';
import {tenantIdentity,tenantConnectionOptions,TenantConfigurationError} from '../lib/server/tenant-identity.ts';
import {provisionTenant,tenantMigrations,inspectTenant} from '../lib/server/tenant-database.ts';

let maintenance;
try {
 const companyId=process.argv[2],identity=tenantIdentity(companyId||'');
 const runtimeUrl=process.env[identity.credentialRef];
 if(!runtimeUrl||!process.env.ERP_PROVISIONER_URL)throw new TenantConfigurationError('CONFIGURATION','Configure ERP_PROVISIONER_URL e a credencial exclusiva da empresa no ambiente privado do operador.');
 const runtime=tenantConnectionOptions(runtimeUrl,companyId,{ca:process.env.ERP_TENANT_CA});
 const admin=new URL(process.env.ERP_PROVISIONER_URL);
 if(!['postgres:','postgresql:'].includes(admin.protocol)||admin.search||admin.hash||!admin.username||!admin.password)throw new Error('Invalid operator connection');
 const settings={host:admin.hostname,port:Number(admin.port||5432),username:decodeURIComponent(admin.username),password:decodeURIComponent(admin.password),ssl:{rejectUnauthorized:true,...(process.env.ERP_TENANT_CA?{ca:process.env.ERP_TENANT_CA}:{})},max:1,prepare:false,connect_timeout:10,onnotice:()=>{}};
 maintenance=postgres({...settings,database:decodeURIComponent(admin.pathname.slice(1))});
 const result=await provisionTenant({companyId,runtimePassword:runtime.password,maintenance,connectMaintenanceDatabase:database=>postgres({...settings,database}),migrations:await tenantMigrations()});
 const health=await inspectTenant(runtimeUrl,companyId,{ca:process.env.ERP_TENANT_CA});
 console.log(JSON.stringify({company:result.companyId,database:result.database,engineInstalled:health.engine_installed,reconciled:health.reconciled,state:result.state}));
 console.log('Estrutura verificada. A migração/conciliação dos dados e a ativação central ainda são necessárias.');
} catch(error) {
 // Do not print driver errors: SQL diagnostics may include connection secrets.
 console.error(error instanceof TenantConfigurationError?error.message:'Provisionamento não concluído. Confira conectividade, TLS e privilégios do operador. Nenhuma empresa foi ativada.');
 process.exitCode=1;
} finally {await maintenance?.end({timeout:2});}
