import {TenantConfigurationError} from './tenant-identity.ts';

/** Private CLI only. Never return these settings to an HTTP response or log. */
export function operatorConnection(value:string|undefined,ca?:string){
 try{
  if(!value)throw new Error('missing');
  const url=new URL(value);
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.username||!url.password||!url.pathname.slice(1)||url.search||url.hash)throw new Error('invalid');
  return {host:url.hostname.replace(/^\[|\]$/g,''),port:Number(url.port||5432),username:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:decodeURIComponent(url.pathname.slice(1)),ssl:{rejectUnauthorized:true,...(ca?{ca}:{})},max:1,prepare:false,connect_timeout:10,onnotice:()=>{}};
 }catch{throw new TenantConfigurationError('CONFIGURATION','Configure as conexões privadas e os certificados do operador conforme TENANT-DATABASES.md.');}
}
