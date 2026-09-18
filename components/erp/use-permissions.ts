"use client";
import {useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {readERP,type Row} from '@/lib/operations';

export function usePermissions(db:SupabaseClient|null,business:string,user:string,revision:string){
 const [snapshot,setSnapshot]=useState<{business:string;user:string;permissions:Row}|null>(null);
 useEffect(()=>{if(!db||!business||!user)return;let active=true;let sequence=0;
  const refresh=()=>{const request=++sequence;readERP(db,business,'permissions').then(v=>{if(active&&request===sequence)setSnapshot({business,user,permissions:v as Row})}).catch(()=>{if(active&&request===sequence)setSnapshot(null)})};
  refresh();window.addEventListener('focus',refresh);
  return()=>{active=false;window.removeEventListener('focus',refresh)};
 },[db,business,user,revision]);
 return snapshot?.business===business&&snapshot?.user===user?snapshot.permissions:{};
}

