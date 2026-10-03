import {adminRecordRequest,adminProductCorrection} from '@/lib/admin-records';
import {readBoundedBody} from '@/lib/server/asset-content';
import {executeTenantRequest} from '@/lib/server/tenant-request';
import {TenantConfigurationError} from '@/lib/server/tenant-identity';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function PATCH(request:Request){
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 const authorization=request.headers.get('authorization');if(!authorization?.startsWith('Bearer '))return reply({error:'Entre na conta administrativa.'},401);
 try{
  const input=adminProductCorrection.safeParse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBody(request,16384))));
  if(!input.success)return reply({error:'Confira a empresa, os campos, a versão e a justificativa.'},400);
  const v=input.data;return reply({data:await executeTenantRequest(authorization,{company:v.company,mode:'command',operation:v.operation,data:v.data,key:v.key},'admin-correct')});
 }catch(error){
  if(error instanceof TenantConfigurationError)return reply({error:error.message},error.code==='UNAUTHENTICATED'?401:error.code==='FORBIDDEN'?403:error.code==='CONFLICT'?409:error.code==='INVALID_OPERATION'?400:503);
  return reply({error:'Não foi possível corrigir o registro. Atualize a consulta antes de tentar novamente.'},400);
 }
}
export async function POST(request:Request){
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 const authorization=request.headers.get('authorization');if(!authorization?.startsWith('Bearer '))return reply({error:'Entre na conta administrativa.'},401);
 try{
  const input=adminRecordRequest.safeParse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBody(request,8192))));
  if(!input.success)return reply({error:'Selecione empresa, consulta e filtros válidos.'},400);
  const v=input.data;return reply({data:await executeTenantRequest(authorization,{company:v.company,mode:'read',operation:v.operation,data:v.filters},'admin-read')});
 }catch(error){
  if(error instanceof TenantConfigurationError)return reply({error:error.message},error.code==='UNAUTHENTICATED'?401:error.code==='FORBIDDEN'?403:503);
  return reply({error:'Não foi possível consultar os registros. Confira os filtros e a disponibilidade do banco.'},400);
 }
}
