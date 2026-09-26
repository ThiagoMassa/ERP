import type {SupabaseClient} from '@supabase/supabase-js';
import type {Row} from './operations';
export type AssetBucket='product-photos'|'erp-models';
const uploads=new WeakMap<File,Map<string,string>>();
async function session(db:SupabaseClient){const {data,error}=await db.auth.getSession();if(error||!data.session)throw new Error('Entre novamente na sua conta.');return data.session;}
async function error(response:Response){const body=await response.json().catch(()=>({})) as {error?:string};return new Error(body.error||'Não foi possível acessar o arquivo.');}
export async function uploadAsset(db:SupabaseClient,company:string,bucket:AssetBucket,file:File,product?:string):Promise<Row>{
 const current=await session(db),context=[current.user.id,company,bucket,product||''].join('/');
 let keys=uploads.get(file);if(!keys){keys=new Map();uploads.set(file,keys);}let key=keys.get(context);if(!key){key=crypto.randomUUID();keys.set(context,key);}
 const params=new URLSearchParams({company,bucket,key,filename:file.name,...(product?{product_id:product}:{})});
 const response=await fetch('/api/erp/files?'+params,{method:'POST',headers:{Authorization:'Bearer '+current.access_token,'Content-Type':'application/octet-stream'},body:file,cache:'no-store'});
 if(!response.ok)throw await error(response);return (await response.json() as {data:Row}).data;
}
export async function downloadAsset(db:SupabaseClient,company:string,bucket:AssetBucket,path:string,signal?:AbortSignal):Promise<Blob>{
 const current=await session(db),params=new URLSearchParams({company,bucket,path});
 const response=await fetch('/api/erp/files?'+params,{headers:{Authorization:'Bearer '+current.access_token},cache:'no-store',signal});
 if(!response.ok)throw await error(response);return response.blob();
}
