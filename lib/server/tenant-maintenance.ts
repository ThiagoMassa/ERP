// Private operator. No maintenance credential or native tool belongs in an HTTP route.
import type {Sql,JSONValue} from 'postgres';
import {z} from 'zod';
import {tenantIdentity,TenantConfigurationError} from './tenant-identity.ts';
import {tenantMigrations,inspectTenant,assertTenantReady} from './tenant-database.ts';
import {createTenantBackup,inspectBackup,verifyTenantRecovery,restoreTenantBackup,type BackupKey,type BackupManifest,type PgConnection,type PgTools} from './tenant-backup.ts';

type Options={
 control:Sql;maintenance:Sql;connectMaintenanceDatabase:(database:string)=>Sql;
 connection:PgConnection;tools:PgTools;psql:string;directory:string;jobId:string;
 currentKey:BackupKey;keyFor:(id:string)=>Promise<BackupKey>;
 runtimeConnection:(company:string)=>Promise<string>;allowLocalTest?:boolean;ca?:string;
};
const jobSchema=z.object({id:z.string().uuid(),company_id:z.string().uuid(),kind:z.enum(['backup','restore']),backup_id:z.string().uuid(),safety_id:z.string().uuid().nullable(),actor_id:z.string().uuid(),reason:z.string(),retention_days:z.number().int(),access_epoch:z.string().uuid(),status:z.enum(['requested','running','failed','complete']),stage:z.string()});
const fault=(code:string,message:string)=>new TenantConfigurationError(code,message);

export async function runTenantMaintenance(options:Options){
 if(!z.string().uuid().safeParse(options.jobId).success)throw fault('MAINTENANCE_JOB','Solicitação de manutenção inválida.');
 const control=await options.control.reserve();let target:Sql|undefined;
 const step=async(name:string,report:Record<string,JSONValue>={})=>jobSchema.parse((await control`select erp_control.maintenance_step(${options.jobId},${name},${control.json(report)}) as data`)[0].data);
 try{
  // Session lock prevents two operators from executing the same requested job.
  if(!(await control`select pg_try_advisory_lock(hashtextextended(${options.jobId+'/maintenance'},0)) as locked`)[0].locked)throw fault('MAINTENANCE_BUSY','Esta solicitação já está sendo executada.');
  let job;
  try{job=await step('start');}catch(error){await step('fail',{code:'AUTHORIZATION_EXPIRED'}).catch(()=>{});throw error;}
  if(job.status==='complete')return {job:job.id,status:job.status,repeated:true};
  const company=job.company_id,identity=tenantIdentity(company);
  try{
  const runtime=await options.runtimeConnection(company);
  target=options.connectMaintenanceDatabase(identity.database);
  const required=await tenantMigrations();
  const common={company,directory:options.directory,connection:options.connection,tools:options.tools,maintenance:options.maintenance,connectMaintenanceDatabase:options.connectMaintenanceDatabase};
  const artifact=async(manifest:BackupManifest)=>{await step('artifact',{id:manifest.id,company:manifest.company,sha256:manifest.sha256,bytes:manifest.bytes,key_id:manifest.key_id,created_at:manifest.created_at,verified_at:manifest.verified_at,retention_until:manifest.retention_until});};
   if(job.kind==='backup'){
    assertTenantReady(await inspectTenant(runtime,company,{allowLocalTest:options.allowLocalTest,ca:options.ca}),required);
    // A retry must use the key recorded by an earlier successful artifact, if any.
    const registered=(await control`select key_id from erp_control.backups where id=${job.backup_id} and company_id=${company}`)[0];
    const key=registered?.key_id?await options.keyFor(registered.key_id):options.currentKey;
    await createTenantBackup({...common,key,source:target,id:job.backup_id,retentionDays:job.retention_days});
    await artifact(await verifyTenantRecovery({...common,key,backup:job.backup_id}));
    return {job:job.id,status:'complete',repeated:false};
   }
   const selected=(await control`select key_id,retention_until,status from erp_control.backups where id=${job.backup_id} and company_id=${company}`)[0];
   if(selected?.status!=='verified'||!selected.key_id||new Date(selected.retention_until).getTime()<=Date.now())throw fault('BACKUP_RETENTION','O backup selecionado não está verificado ou está fora da retenção.');
   const key=await options.keyFor(selected.key_id);
   const safetyRecord=(await control`select key_id from erp_control.backups where id=${job.safety_id} and company_id=${company}`)[0];
   const safetyKey=safetyRecord?.key_id?await options.keyFor(safetyRecord.key_id):options.currentKey;
   if(!job.safety_id)throw fault('RESTORE_CONFIRMATION','Cópia de segurança não autorizada.');
   const safety=job.safety_id;
   const restored=await restoreTenantBackup({...common,key,safetyKey,backup:job.backup_id,target,psql:options.psql,
    job:{id:job.id,actor:job.actor_id,reason:job.reason,safety,epoch:job.access_epoch,confirmCompany:company,confirmBackup:job.backup_id},
    authorize:async()=>{await control`select erp_control.authorize_maintenance(${job.id})`;},
    onSafetyVerified:async manifest=>{await artifact(manifest);await step('restoring');}
   });
   // Also recover a lost response after the tenant transaction committed.
   await artifact(await inspectBackup({...common,key:safetyKey,backup:safety}));
   await step('restoring');await step('restored',{backup:job.backup_id,safety});await step('release');
   await target.begin(async tx=>{
    const marker=(await tx`select company_id,database_name,access_epoch from tenant.identity where singleton for update`)[0];
    const audit=(await tx`select after_data from tenant.audit where action='tenant.restore' and entity=${job.id}`)[0]?.after_data;
    if(marker?.company_id!==company||marker.database_name!==identity.database||marker.access_epoch!==job.access_epoch||audit?.backup!==job.backup_id||audit?.safety!==safety||audit?.epoch!==job.access_epoch)throw fault('RESTORE_VERIFICATION','Identidade ou confirmação da restauração divergente.');
    await tx`update tenant.identity set operational_state='active' where singleton`;
   });
   assertTenantReady(await inspectTenant(runtime,company,{allowLocalTest:options.allowLocalTest,ca:options.ca}),required);
   await step('complete');
   return {job:job.id,status:'complete',repeated:restored.repeated};
  }catch(error){
   const code=error instanceof TenantConfigurationError?error.code:'MAINTENANCE_FAILED';
   const recovered=await step('fail',{code}).catch(()=>null);
   if(recovered?.status==='complete')return {job:job.id,status:'complete',recovered:true};
   throw error;
  }
 }finally{
  try{await target?.end({timeout:2});}finally{
   try{await control`select pg_advisory_unlock(hashtextextended(${options.jobId+'/maintenance'},0))`;}finally{control.release();}
  }
 }
}
