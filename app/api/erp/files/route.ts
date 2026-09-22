import {z} from 'zod';
import {executeTenantRequest} from '@/lib/server/tenant-request';
import {TenantConfigurationError} from '@/lib/server/tenant-identity';
import {assetLimit,readBoundedBody,validateAsset} from '@/lib/server/asset-content';
import {decision} from '@/lib/permissions';
import {createHash} from 'node:crypto';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const base={company:z.string().uuid(),bucket:z.enum(['product-photos','erp-models'])};
const upload=z.object({...base,key:z.string().uuid(),filename:z.string().min(1).max(180),product_id:z.string().uuid().optional()}).strict();
const download=z.object({...base,path:z.string().min(1).max(500)}).strict();
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
function failure(error:unknown){
 if(error instanceof TenantConfigurationError)return Response.json({error:error.message},{status:error.code==='UNAUTHENTICATED'?401:error.code==='FORBIDDEN'?403:error.code==='CONFLICT'?409:error.code==='INVALID_OPERATION'?422:503,headers});
 return Response.json({error:'Não foi possível processar o arquivo.'},{status:503,headers});
}
export async function POST(request:Request){
 const authorization=request.headers.get('authorization');if(!authorization?.startsWith('Bearer '))return Response.json({error:'Entre na sua conta.'},{status:401,headers});
 const parsed=upload.safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!parsed.success)return Response.json({error:'Dados de envio inválidos.'},{status:400,headers});
 const {company,bucket,key,filename,product_id}=parsed.data;
 try{
  const permissions=await executeTenantRequest(authorization,{company,mode:'read',operation:'permissions',data:{}});
  const area=bucket==='product-photos'?'catalog':'production',action=bucket==='product-photos'&&product_id?'edit':'create';
  if(!decision(permissions,area,'read').allowed||!decision(permissions,area,action).allowed)return Response.json({error:'Sem permissão para enviar este arquivo.'},{status:403,headers});
  let content:Uint8Array,mime:string;
  try{content=await readBoundedBody(request,assetLimit(bucket));mime=validateAsset(content,bucket,filename);}catch(error){return Response.json({error:error instanceof Error?error.message:'Arquivo inválido.'},{status:422,headers});}
  const result=await executeTenantRequest(authorization,{company,mode:'command',operation:'asset.save',key,data:{bucket,filename,mime,content:Buffer.from(content).toString('base64'),...(product_id?{product_id}:{})}});
  return Response.json({data:result},{headers});
 }catch(error){return failure(error);}
}
export async function GET(request:Request){
 const authorization=request.headers.get('authorization');if(!authorization?.startsWith('Bearer '))return Response.json({error:'Entre na sua conta.'},{status:401,headers});
 const parsed=download.safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!parsed.success)return Response.json({error:'Arquivo inválido.'},{status:400,headers});
 try{
  const {company,bucket,path}=parsed.data;
  const result=await executeTenantRequest(authorization,{company,mode:'read',operation:'asset.read',data:{bucket,path}});
  const bytes=Buffer.from(result.content,'base64');
  if(bytes.length!==result.size_bytes||createHash('sha256').update(bytes).digest('hex')!==result.sha256)throw new Error('Integrity mismatch');
  return new Response(bytes,{headers:{...headers,'Content-Type':result.mime,'Content-Length':String(bytes.length),'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`}});
 }catch(error){return failure(error);}
}
