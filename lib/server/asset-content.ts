import {SaxesParser} from 'saxes';
import {unzipSync,strFromU8} from 'fflate';
export type AssetBucket='product-photos'|'erp-models';
export const assetLimit=(bucket:AssetBucket)=>bucket==='product-photos'?5*1024*1024:25*1024*1024;
/** Bound compressed and expanded content before storage. Geometry suitability is checked in the studio. */
export function validateAsset(bytes:Uint8Array,bucket:AssetBucket,filename:string):string{
 if(!bytes.length||bytes.length>assetLimit(bucket))throw new Error('Arquivo vazio ou acima do limite permitido.');
 if(!filename.trim()||filename.length>180||/[\u0000-\u001f\u007f/\\]/.test(filename))throw new Error('Nome de arquivo inválido.');
 const has=(value:number[],offset=0)=>value.every((v,i)=>bytes[offset+i]===v);
 if(bucket==='product-photos'){
  if(has([137,80,78,71,13,10,26,10])&&bytes.length>=33)return 'image/png';
  if(has([255,216,255])&&bytes.length>=4&&has([255,217],bytes.length-2))return 'image/jpeg';
  if(has([82,73,70,70])&&has([87,69,66,80],8)&&bytes.length>=16&&new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(4,true)+8===bytes.length)return 'image/webp';
  throw new Error('Envie uma imagem PNG, JPEG ou WebP.');
 }
 if(!/\.3mf$/i.test(filename))throw new Error('Selecione um arquivo .3mf.');
 let expanded=0,count=0;const names=new Set<string>();
 const files=unzipSync(bytes,{filter:file=>{
  expanded+=file.originalSize;
  if(!Number.isSafeInteger(expanded)||expanded>80*1024*1024||++count>2000||file.name.split('/').some(p=>p==='..')||file.name.startsWith('/')||file.name.includes('\\')||names.has(file.name))throw new Error('Estrutura ou tamanho do 3MF inválido.');
  names.add(file.name);return /\.(xml|model|rels)$/i.test(file.name);
 }});
 if(!files['[Content_Types].xml']||!files['_rels/.rels'])throw new Error('Pacote 3MF incompleto.');
 let modelPath='',models=0;
 for(const [name,data] of Object.entries(files)){
  const text=strFromU8(data);if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('Entidades XML não são permitidas.');
  const parser=new SaxesParser({xmlns:true});let depth=0,root='';
  parser.on('opentag',tag=>{if(++depth>64)throw new Error('XML excede o limite de profundidade.');if(!root)root=tag.local;
   if(name==='_rels/.rels'&&tag.local==='Relationship'){
    const attr=(key:string)=>Object.values(tag.attributes).find(a=>a.local===key)?.value||'';
    if(attr('Type').endsWith('/3dmodel')){if(attr('TargetMode')==='External')throw new Error('Modelo principal externo não permitido.');modelPath=attr('Target').replace(/^\//,'');}
   }
  });parser.on('closetag',()=>{depth--});parser.write(text).close();
  if(/\.model$/i.test(name)){if(root!=='model')throw new Error('Documento de modelo inválido.');models++;}
 }
 if(!models||!modelPath||!files[modelPath])throw new Error('Modelo principal ausente no 3MF.');
 return 'model/3mf';
}
export async function readBoundedBody(request:Request,limit:number):Promise<Uint8Array>{
 if(Number(request.headers.get('content-length'))>limit)throw new Error('Arquivo acima do limite permitido.');
 const reader=request.body?.getReader();if(!reader)throw new Error('Arquivo vazio.');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('Arquivo acima do limite permitido.');}chunks.push(value);}}finally{reader.releaseLock();}
 const result=new Uint8Array(size);let at=0;for(const chunk of chunks){result.set(chunk,at);at+=chunk.length;}return result;
}
