import {z} from 'zod';
import {executeTenantRequest} from '@/lib/server/tenant-request';
import {TenantConfigurationError} from '@/lib/server/tenant-identity';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const schema=z.object({company:z.string().uuid().nullable(),mode:z.enum(['read','command']),operation:z.string().min(1).max(60),data:z.record(z.unknown()).default({}),key:z.string().uuid().optional()}).strict();
export async function POST(request:Request) {
 const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 const authorization=request.headers.get('authorization');
 if(!authorization?.startsWith('Bearer '))return reply({error:'Entre na sua conta.'},401);
 try {
  if(Number(request.headers.get('content-length'))>110000)return reply({error:'Requisição muito grande.'},413);
  const text=await request.text();if(text.length>110000)return reply({error:'Requisição muito grande.'},413);
  const parsed=schema.safeParse(JSON.parse(text));
  if(!parsed.success||(parsed.data.mode==='command'&&!parsed.data.key))return reply({error:'Solicitação empresarial inválida.'},400);
  if(!parsed.data.company&&!((parsed.data.mode==='read'&&parsed.data.operation==='businesses')||(parsed.data.mode==='command'&&parsed.data.operation==='business.save')))return reply({error:'Selecione uma empresa para continuar.'},400);
  return reply({data:await executeTenantRequest(authorization,parsed.data)});
 } catch(error) {
  if(error instanceof SyntaxError)return reply({error:'Formato inválido.'},400);
  if(error instanceof TenantConfigurationError) {
   const status=error.code==='UNAUTHENTICATED'?401:error.code==='FORBIDDEN'?403:error.code==='CONFLICT'?409:error.code==='INVALID_OPERATION'?422:503;
   return reply({error:error.message,code:error.code},status);
  }
  return reply({error:'Serviço empresarial temporariamente indisponível.'},503);
 }
}
