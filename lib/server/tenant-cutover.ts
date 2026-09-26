import type {Sql} from 'postgres';
import {importLegacyCompany} from './tenant-import.ts';
import {inspectTenant,assertTenantReady,assertTenantStructure,tenantMigrations} from './tenant-database.ts';
import {tenantIdentity,TenantConfigurationError} from './tenant-identity.ts';
import type {LegacyPhotoBundle} from './legacy-photo-bundle.ts';

type CutoverOptions={control:Sql;target:Sql;runtimeConnection:string;jobId:string;allowLocalTest?:boolean;ca?:string;photoBundle?:LegacyPhotoBundle};
/** Operator worker: API handlers must never receive these maintenance connections. */
export async function runTenantCutover(options:CutoverOptions) {
 const {control,target,jobId}=options;
 try {
  const started=(await control`select erp_control.cutover_step(${jobId},'start','{}') as data`)[0].data;
  if(started.status==='activated')return {company:started.company,status:'activated',repeated:true};
  const identity=tenantIdentity(started.company);
  // Verify the restricted credential before spending time copying records.
  const required=await tenantMigrations();
  assertTenantStructure(await inspectTenant(options.runtimeConnection,identity.company,{allowLocalTest:options.allowLocalTest,ca:options.ca}),required);
  const report=await importLegacyCompany(control,target,jobId,options.photoBundle);
  await control`select erp_control.cutover_step(${jobId},'verify',${control.json(report)})`;
  await target.begin(async tx=>{
   const marker=await tx`select company_id,database_name from tenant.identity where singleton for update`;
   if(marker[0]?.company_id!==identity.company||marker[0]?.database_name!==identity.database)throw new TenantConfigurationError('IDENTITY_MISMATCH','Destino divergente da empresa autorizada.');
   if(!(await tx`select 1 from tenant.reconciliations where id=${jobId} and source_digest=${report.source_digest} and target_digest=${report.target_digest}`).length)throw new TenantConfigurationError('RECONCILIATION_FAILED','Conciliação ausente no destino.');
   await tx`update tenant.identity set operational_state='active' where singleton`;
  });
  assertTenantReady(await inspectTenant(options.runtimeConnection,identity.company,{allowLocalTest:options.allowLocalTest,ca:options.ca}),required);
  const result=(await control`select erp_control.cutover_step(${jobId},'activate',${control.json({source_digest:report.source_digest,schema_version:required.at(-1)?.version})}) as data`)[0].data;
  return {...result,counts:report.counts};
 } catch(error) {
  // A lost response may follow a committed activation. The state machine returns
  // "activated" and must never regress that company to failed or unlock the legacy DB.
  const code=error instanceof TenantConfigurationError?error.code:'MIGRATION_FAILED';
  const recovered=await control`select erp_control.cutover_step(${jobId},'fail',${control.json({code})}) as data`.catch(()=>null);
  if(recovered?.[0]?.data?.status==='activated')return {...recovered[0].data,recovered:true};
  throw error;
 }
}
