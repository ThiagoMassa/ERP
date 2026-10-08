import {z} from 'zod';
import {executeTenantRequest} from '@/lib/server/tenant-request';
import {decision} from '@/lib/permissions';
import {normalizeOffers} from '@/lib/marketplace';
export const runtime='nodejs';
const schema=z.object({query:z.string().trim().min(3).max(160),business_id:z.string().uuid()}).strict();
export async function POST(request:Request){
 const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 const authorization=request.headers.get('authorization');
 if(!authorization?.startsWith('Bearer '))return reply({code:'SIGN_IN'},401);
 let input:unknown;try{input=await request.json()}catch{return reply({code:'INVALID_QUERY'},400)}
 const parsed=schema.safeParse(input);if(!parsed.success)return reply({code:'INVALID_QUERY'},400);
 const {query:q,business_id}=parsed.data;
 try{const permissions=await executeTenantRequest(authorization,{company:business_id,mode:'read',operation:'permissions',data:{}});if(!decision(permissions,'catalog','read').allowed)return reply({code:'FORBIDDEN'},403)}catch{return reply({code:'FORBIDDEN'},403)}
 if(!process.env.SERPAPI_KEY)return reply({code:'NOT_CONFIGURED'},503);
 const url=new URL('https://serpapi.com/search.json');url.search=new URLSearchParams({engine:'google_shopping',q,gl:'br',hl:'pt',api_key:process.env.SERPAPI_KEY}).toString();
 try{
  const result=await fetch(url,{signal:AbortSignal.timeout(25000),cache:'no-store'});
  if(!result.ok)return reply({code:'PROVIDER_ERROR'},502);
  const data:unknown=await result.json();
  if(!data||typeof data!=='object'||'error' in data)return reply({code:'PROVIDER_ERROR'},502);
  return reply({query:q,offers:normalizeOffers(data),retrievedAt:new Date().toISOString(),market:'BR',currency:'BRL'});
 }catch{return reply({code:'PROVIDER_ERROR'},502)}
}
