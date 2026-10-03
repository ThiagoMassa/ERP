// Read-only catalog report. Run only in the private Linux operator environment.
import postgres from 'postgres';
import {operatorConnection} from '../lib/server/operator-connection.ts';
import {tenantIdentity,TenantConfigurationError} from '../lib/server/tenant-identity.ts';
import {tenantPreflight} from '../lib/server/tenant-preflight.ts';

let sql;
try {
 if(process.argv[2]==='--help') {
  console.log('Uso: node --experimental-strip-types scripts/preflight-tenant.mjs <UUID da empresa>');
  console.log('Requer ERP_PROVISIONER_URL e, se necessário, ERP_TENANT_CA no ambiente privado. Apenas consulta catálogos; não cria nem ativa bancos. Saída 2 indica impedimentos conhecidos.');
 } else {
  if(process.argv.length!==3) throw Error('Invalid arguments');
  const identity=tenantIdentity(process.argv[2]);
  sql=postgres(operatorConnection(process.env.ERP_PROVISIONER_URL,process.env.ERP_TENANT_CA));
  const report=await tenantPreflight(sql,identity.company);
  console.log(JSON.stringify(report,null,2));
  if(!report.can_attempt_automatic_provisioning) process.exitCode=2;
 }
} catch(error) {
 console.error(error instanceof TenantConfigurationError?error.message:'Verificação não concluída. Confira UUID, conexão privada, TLS e acesso aos catálogos.');
 process.exitCode=1;
} finally { await sql?.end({timeout:2}); }
