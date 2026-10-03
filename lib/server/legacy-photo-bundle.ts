import {createHash} from 'node:crypto';
import {open,realpath,mkdir,writeFile} from 'node:fs/promises';
import {dirname,join,basename,resolve,relative,isAbsolute,sep} from 'node:path';
import type {Sql} from 'postgres';
import {z} from 'zod';
import {assetLimit,validateAsset} from './asset-content.ts';
import {tenantIdentity,TenantConfigurationError} from './tenant-identity.ts';

const photoSchema=z.object({
 name:z.string().min(1).max(1024).refine(v=>!/[\u0000-\u001f\u007f\\:<>"|?*]/.test(v)&&!v.startsWith('/')&&!v.split('/').some(p=>!p||p==='.'||p==='..')),
 filename:z.string().min(1).max(180).refine(v=>!/[\u0000-\u001f\u007f/\\:<>"|?*]/.test(v)),
 mime:z.enum(['image/png','image/jpeg','image/webp']),
 size_bytes:z.number().int().positive().max(assetLimit('product-photos')),
 sha256:z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
const manifestSchema=z.object({version:z.literal(1),company:z.string().uuid(),photos:z.array(photoSchema).max(10000)}).strict();
export type LegacyPhoto=z.infer<typeof photoSchema>;
export type LegacyPhotoBundle={company:string;photos:readonly LegacyPhoto[];read:(photo:LegacyPhoto)=>Promise<Uint8Array>};
const invalid=()=>new TenantConfigurationError('ASSET_BUNDLE_INVALID','Pacote de fotos inválido, incompleto ou alterado. Confira o manifesto e os arquivos no ambiente privado do operador.');

/** The operator supplies a reviewed offline export, never a URL or directory from an HTTP request.
 * Files are addressed by digest in the same directory; source names never become local paths.
 * Hash verification is mandatory even on retries. The directory must be operator-owned.
 */
export async function openLegacyPhotoBundle(manifestPath:string,companyId:string):Promise<LegacyPhotoBundle>{
 try {
  const company=tenantIdentity(companyId).company;
  const manifestFile=await realpath(manifestPath),root=dirname(manifestFile);
  const bytes=await boundedFile(manifestFile,4*1024*1024);
  const manifest=manifestSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
  if(manifest.company!==company||new Set(manifest.photos.map(p=>p.name)).size!==manifest.photos.length)throw invalid();
  const photos=manifest.photos.map(p=>Object.freeze(p));
  return Object.freeze({company,photos:Object.freeze(photos),read:async(photo:LegacyPhoto)=>{
   try{
   if(!photos.includes(photo))throw invalid();
   // realpath rejects symlinks/junctions leading outside the bundle directory.
   const path=join(root,photo.sha256+'.bin');
   if(await realpath(path)!==path)throw invalid();
   const content=await boundedFile(path,photo.size_bytes);
   if(content.length!==photo.size_bytes||createHash('sha256').update(content).digest('hex')!==photo.sha256||validateAsset(content,'product-photos',photo.filename)!==photo.mime)throw invalid();
   return content;
   }catch{throw invalid();}
  }});
 } catch {throw invalid();}
}

async function boundedFile(path:string,limit:number):Promise<Uint8Array>{
 const file=await open(path,'r');
 try {
  const stat=await file.stat();if(!stat.isFile()||stat.size<=0||stat.size>limit)throw invalid();
  const content=Buffer.alloc(limit+1);let length=0;
  while(length<content.length){const {bytesRead}=await file.read(content,length,content.length-length,null);if(!bytesRead)break;length+=bytesRead;}
  if(length>limit)throw invalid();return content.subarray(0,length);
 } finally {await file.close();}
}

/** Prepare a bundle from an operator's offline Storage export. This function does
 * not pause Storage or attest its export: that is a documented maintenance step.
 * The final manifest is written last; incomplete directories cannot be imported.
 */
export async function prepareLegacyPhotoBundle(source:Sql,jobId:string,exportDirectory:string,outputDirectory:string){
 return source.begin('isolation level repeatable read',async tx=>{
  const jobs=await tx`select company_id,status from erp_control.cutovers where id=${jobId}`;
  const job=jobs[0];
  if(!job||!['requested','running','verified'].includes(job.status))throw new TenantConfigurationError('SOURCE_NOT_FROZEN','Solicite uma migração autorizada antes de preparar as fotos.');
  const company=tenantIdentity(job.company_id).company;
  const control=await tx`select data_location from erp_control.companies where id=${company} for share`;
  if(control[0]?.data_location!=='migrating')throw new TenantConfigurationError('SOURCE_NOT_FROZEN','As referências dos produtos precisam estar congeladas antes da exportação.');
  const names=await tx<{name:string}[]>`select distinct image_path as name from public.products where business_id=${company} and image_path is not null order by image_path limit 10001`;
  if(names.length>10000)throw invalid();
  const root=await realpath(exportDirectory),output=resolve(outputDirectory);
  // The destination must be fresh and separate from the source export.
  const rel=relative(root,output);
  if(!rel||(!(rel==='..'||rel.startsWith('..'+sep))&&!isAbsolute(rel)))throw invalid();
  await mkdir(output,{recursive:false,mode:0o700});
  const photos:LegacyPhoto[]=[];
  for(const {name} of names){
   photoSchema.shape.name.parse(name);
   const path=join(root,...name.split('/'));
   if(await realpath(path)!==path)throw invalid();
   const content=await boundedFile(path,assetLimit('product-photos'));
   const filename=basename(path),mime=validateAsset(content,'product-photos',filename);
   const sha256=createHash('sha256').update(content).digest('hex');
   const photo=photoSchema.parse({name,filename,mime,size_bytes:content.length,sha256});
   // Identical contents can share a digest file while keeping separate references.
   if(!photos.some(p=>p.sha256===sha256))await writeFile(join(output,sha256+'.bin'),content,{flag:'wx',mode:0o600});
   photos.push(photo);
  }
  const manifest=JSON.stringify({version:1,company,photos},null,2);
  if(Buffer.byteLength(manifest)>4*1024*1024)throw invalid();
  await writeFile(join(output,'manifest.json'),manifest,{flag:'wx',mode:0o600});
  return {company,photos:photos.length,manifest:join(output,'manifest.json')};
 });
}
