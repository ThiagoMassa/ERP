import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {Matrix4,Vector3} from 'three';
export type MeshData={positions:number[];triangles:number[];volume?:number;area?:number;bounds?:{min:number[];max:number[]}};
export type Part={id:string;name:string;mesh:MeshData};
const children=(e:Element,tag:string)=>Array.from(e.children).filter(c=>c.localName===tag);
const child=(e:Element,tag:string)=>children(e,tag)[0];
function xml(text:string){if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('XML com entidades não é suportado.');const d=new DOMParser().parseFromString(text,'application/xml');if(d.querySelector('parsererror'))throw Error('XML inválido no 3MF.');return d}
function path(value:string,base=''){const parts=(value.startsWith('/')?value:base+'/'+value).split('/'),out:string[]=[];for(const p of parts){if(p==='..'){if(!out.length)throw Error('Caminho inválido.');out.pop()}else if(p&&p!=='.')out.push(p)}return out.join('/')}
function transform(value:string|null){if(!value)return new Matrix4();const n=value.trim().split(/\s+/).map(Number);if(n.length!==12||n.some(v=>!Number.isFinite(v)))throw Error('Transformação inválida.');return new Matrix4().set(n[0],n[3],n[6],n[9],n[1],n[4],n[7],n[10],n[2],n[5],n[8],n[11],0,0,0,1)}
export function read3MF(buffer:ArrayBuffer):Part[]{
 if(buffer.byteLength>25*1024*1024)throw Error('O limite é 25 MB por arquivo.');
 let expanded=0,count=0;
 const files=unzipSync(new Uint8Array(buffer),{filter:f=>{expanded+=f.originalSize;count++;if(expanded>80*1024*1024||count>2000)throw Error('3MF expandido excede o limite de segurança.');return /\.model$|\.rels$/i.test(f.name)}});
 const relations=files['_rels/.rels'];if(!relations)throw Error('Arquivo 3MF sem relacionamentos.');
 const rel=Array.from(xml(strFromU8(relations)).getElementsByTagNameNS('*','Relationship')).find(e=>e.getAttribute('Type')?.endsWith('/3dmodel'));
 if(!rel||rel.getAttribute('TargetMode')==='External')throw Error('Modelo principal não encontrado.');
 const rootPath=path(rel.getAttribute('Target')||'');
 const docs=new Map<string,Element>();
 const model=(file:string)=>{if(!docs.has(file)){if(!files[file])throw Error('Peça referenciada não encontrada no 3MF.');docs.set(file,xml(strFromU8(files[file])).documentElement)}return docs.get(file)!};
 const root=model(rootPath),unit=root.getAttribute('unit')||'millimeter';
 const scale=({micron:.001,millimeter:1,centimeter:10,inch:25.4,foot:304.8,meter:1000} as Record<string,number>)[unit];if(!scale)throw Error('Unidade 3MF não suportada.');
 const parts:Part[]=[];let total=0;
 function visit(file:string,id:string,matrix:Matrix4,seen:Set<string>){
  const key=file+'#'+id;if(seen.has(key)||seen.size>32)throw Error('Referências cíclicas no 3MF.');
  const document=model(file);if((document.getAttribute('unit')||'millimeter')!==unit)throw Error('Unidades diferentes entre componentes. Normalize no Bambu Studio.');
  const resources=child(document,'resources');const object=resources&&children(resources,'object').find(o=>o.getAttribute('id')===id);if(!object)throw Error('Objeto 3MF ausente.');
  const mesh=child(object,'mesh');
  if(mesh){
   const verts=child(mesh,'vertices'),faces=child(mesh,'triangles');if(!verts||!faces)throw Error('Malha incompleta.');
   const vertices=children(verts,'vertex'),tri=children(faces,'triangle');total+=tri.length;if(total>150000||vertices.length>450000||parts.length>=128)throw Error('Limite: 150 mil triângulos e 128 partes.');
   const positions:number[]=[],triangles:number[]=[];
   for(const v of vertices){const values=['x','y','z'].map(a=>Number(v.getAttribute(a)));if(values.some(v=>!Number.isFinite(v)))throw Error('Vértice inválido.');const p=new Vector3(...values as [number,number,number]).applyMatrix4(matrix).multiplyScalar(scale);positions.push(p.x,p.y,p.z)}
   const mirror=matrix.determinant()<0;
   for(const t of tri){const ids=['v1','v2','v3'].map(a=>Number(t.getAttribute(a)));if(ids.some(i=>!Number.isInteger(i)||i<0||i>=vertices.length))throw Error('Triângulo inválido.');triangles.push(ids[0],ids[mirror?2:1],ids[mirror?1:2])}
   if(triangles.length)parts.push({id:crypto.randomUUID(),name:object.getAttribute('name')||`Peça ${parts.length+1}`,mesh:{positions,triangles}});
  }else {const components=child(object,'components');if(!components)throw Error('Este objeto não contém malha editável.');for(const c of children(components,'component')){const ref=Array.from(c.attributes).find(a=>a.localName==='path')?.value;const target=ref?path(ref,file.slice(0,file.lastIndexOf('/'))):file;visit(target,c.getAttribute('objectid')||'',matrix.clone().multiply(transform(c.getAttribute('transform'))),new Set([...seen,key]))}}
 }
 const build=child(root,'build');if(!build)throw Error('3MF sem objetos na mesa.');
 for(const item of children(build,'item')){if(item.getAttribute('printable')==='0'||item.getAttribute('printable')==='false')continue;visit(rootPath,item.getAttribute('objectid')||'',transform(item.getAttribute('transform')),new Set())}
 if(!parts.length)throw Error('Não há malhas imprimíveis neste arquivo.');return parts;
}
const escape=(s:string)=>s.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
export function write3MF(parts:Part[]):Uint8Array{
 if(!parts.length)throw Error('Adicione uma peça.');
 const objects=parts.map((p,i)=>{const {positions:v,triangles:t}=p.mesh;let verts='',faces='';for(let j=0;j<v.length;j+=3)verts+=`<vertex x="${v[j]}" y="${v[j+1]}" z="${v[j+2]}"/>`;for(let j=0;j<t.length;j+=3)faces+=`<triangle v1="${t[j]}" v2="${t[j+1]}" v3="${t[j+2]}"/>`;return `<object id="${i+1}" type="model" name="${escape(p.name)}"><mesh><vertices>${verts}</vertices><triangles>${faces}</triangles></mesh></object>`}).join('');
 const model=`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="pt-BR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">Fluxo ERP — geometria para Bambu Studio</metadata><resources>${objects}</resources><build>${parts.map((_,i)=>`<item objectid="${i+1}"/>`).join('')}</build></model>`;
 return zipSync({'[Content_Types].xml':strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),'_rels/.rels':strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),'3D/3dmodel.model':strToU8(model)},{level:6});
}
export function bounds(mesh:MeshData){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];mesh.positions.forEach((v,i)=>{min[i%3]=Math.min(min[i%3],v);max[i%3]=Math.max(max[i%3],v)});return {min,max,size:max.map((v,i)=>v-min[i])}}
