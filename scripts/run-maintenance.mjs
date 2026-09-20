// Run in the private operator environment, never in the web process.
import postgres from 'postgres';
import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {tenantIdentity,TenantConfigurationError} from '../lib/server/tenant-identity.ts';
import {runTenantMaintenance} from '../lib/server/tenant-maintenance.ts';

if(process.argv.includes('--help')){
 console.log('Uso: node --experimental-strip-types scripts/run-maintenance.mjs <UUID da solicitação autorizada>\nLeia BACKUP-RESTORE.md. Credenciais, chaves e caminhos são lidos exclusivamente do ambiente privado.');
 process.exit(0);
}
const pools=[];
const missing=()=>new TenantConfigurationError('CONFIGURATION','Configure os segredos e utilitários do operador conforme BACKUP-RESTORE.md.');
try{
 const env=process.env;
 const settings=(value,ca)=>{
  if(!value)throw missing();const parsed=new URL(value);
  if(!['postgres:','postgresql:'].includes(parsed.protocol)||!parsed.username||!parsed.password||!parsed.hostname||!parsed.pathname.slice(1)||parsed.search||parsed.hash)throw missing();
  return {host:parsed.hostname.replace(/^\[|\]$/g,''),port:Number(parsed.port||5432),username:decodeURIComponent(parsed.username),password:decodeURIComponent(parsed.password),database:decodeURIComponent(parsed.pathname.slice(1)),ssl:{rejectUnauthorized:true,...(ca?{ca}:{})},max:1,prepare:false,connect_timeout:10,onnotice:()=>{}};
 };
 if(env.ERP_PG_ROOT_CERT&&!isAbsolute(env.ERP_PG_ROOT_CERT))throw missing();
 const ca=env.ERP_PG_ROOT_CERT?await readFile(env.ERP_PG_ROOT_CERT,'utf8'):undefined;
 const central=settings(env.ERP_CONTROL_OPERATOR_URL,env.ERP_CONTROL_CA),cluster=settings(env.ERP_PROVISIONER_URL,ca);
 const control=postgres(central),maintenance=postgres(cluster);pools.push(control,maintenance);
 const keyring=JSON.parse(env.ERP_BACKUP_KEYS||'{}');
 const keyFor=async id=>{
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(id)||!Object.hasOwn(keyring,id)||typeof keyring[id]!=='string'||!/^[0-9a-fA-F]{64}$/.test(keyring[id]))throw missing();
  return {id,value:Buffer.from(keyring[id],'hex')};
 };
 const currentKey=await keyFor(env.ERP_BACKUP_KEY_ID||'');
 const result=await runTenantMaintenance({control,maintenance,jobId:process.argv[2]||'',
  connectMaintenanceDatabase:database=>postgres({...cluster,database}),
  connection:{host:cluster.host,port:cluster.port,username:cluster.username,password:cluster.password,sslRootCert:env.ERP_PG_ROOT_CERT},
  tools:{dump:env.ERP_PG_DUMP||'',restore:env.ERP_PG_RESTORE||''},psql:env.ERP_PSQL||'',directory:env.ERP_BACKUP_DIRECTORY||'',currentKey,keyFor,
  runtimeConnection:async company=>{const value=env[tenantIdentity(company).credentialRef];if(!value)throw missing();return value;},ca
 });
 console.log(JSON.stringify(result));
}catch(error){
 // Never log driver errors, URLs, SQL diagnostics or secrets.
 console.error(error instanceof TenantConfigurationError?error.message:'Manutenção não concluída. Confira a autorização MFA, a configuração privada e o estado no painel.');
 process.exitCode=1;
}finally{await Promise.all(pools.map(pool=>pool.end({timeout:2})));}
