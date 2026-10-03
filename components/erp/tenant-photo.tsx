"use client";
import {useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import Image from 'next/image';
import {Box} from 'lucide-react';
import {downloadAsset} from '@/lib/assets';
import {str,type Row} from '@/lib/operations';
export default function TenantPhoto({product,db,large=false}:{product:Row;db:SupabaseClient|null;large?:boolean}){
 const path=str(product.image_path),company=str(product.business_id),preview=str(product.image_preview),name=str(product.name);
 const [loaded,setLoaded]=useState<{path:string;company:string;url:string}|null>(null),[failed,setFailed]=useState<string|null>(null);
 useEffect(()=>{if(!path||!company||!db||preview)return;const controller=new AbortController();let active=true,url='';
  downloadAsset(db,company,'product-photos',path,controller.signal).then(blob=>{if(!active)return;url=URL.createObjectURL(blob);setFailed(null);setLoaded({path,company,url});}).catch(()=>{if(active)setFailed(path)});
  return()=>{active=false;controller.abort();if(url)URL.revokeObjectURL(url)};
 },[db,path,company,preview]);
 const url=preview||(loaded?.path===path&&loaded.company===company?loaded.url:'');
 return <span className={large?'product-photo large':'product-photo'}>{url&&failed!==path?<Image unoptimized width={large?160:40} height={large?160:40} src={url} alt={name} onError={()=>setFailed(path)}/>:<Box size={large?38:21}/>}</span>;
}
