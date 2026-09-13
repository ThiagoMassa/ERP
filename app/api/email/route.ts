const env=process.env;
import {createClient} from '@supabase/supabase-js';
export async function POST(req:Request){
 const e=env as any;
 const authorization=req.headers.get('authorization');
 if(!authorization?.startsWith('Bearer '))return Response.json({error:'Entre na sua conta.'},{status:401});
 if(!e.SUPABASE_URL||!e.SUPABASE_PUBLISHABLE_KEY)return Response.json({error:'Banco indisponível.'},{status:503});
 const db=createClient(e.SUPABASE_URL,e.SUPABASE_PUBLISHABLE_KEY,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await db.auth.getUser(authorization.slice(7));
 if(error||!data.user?.email||!data.user.email_confirmed_at)return Response.json({error:'Confirme seu e-mail e entre novamente.'},{status:401});
 if(!e.RESEND_API_KEY||!e.RESEND_FROM)return Response.json({error:'O envio ainda precisa ser configurado.'},{status:503});
 let body:any;try{body=await req.json()}catch{return Response.json({error:'Pedido inválido.'},{status:400})}
 if(!body||typeof body!=='object'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.period))return Response.json({error:'Período inválido.'},{status:400});
 const [year,month]=body.period.split('-').map(Number);const start=body.period+'-01';const end=month===12?`${year+1}-01-01`:`${year}-${String(month+1).padStart(2,'0')}-01`;
 if(!/^[0-9a-f-]{36}$/i.test(body.business_id||'')||!/^[A-Z]{3}$/.test(body.currency||''))return Response.json({error:'Negócio e moeda são obrigatórios.'},{status:400});
 const business=await db.from('business_units').select('id').eq('id',body.business_id).is('deleted_at',null).maybeSingle();
 if(business.error||!business.data)return Response.json({error:'Negócio indisponível.'},{status:404});
 let records:any[]=[];for(let offset=0;;offset+=1000){const part=await db.from('entries').select('id,type,amount').eq('business_id',body.business_id).eq('currency',body.currency).is('deleted_at',null).eq('status','paid').gte('date',start).lt('date',end).order('id').range(offset,offset+999);if(part.error)return Response.json({error:'Não foi possível consultar o financeiro.'},{status:503});records.push(...part.data);if(part.data.length<1000)break}
 const r={data:records,error:null};
 if(r.error)return Response.json({error:'Não foi possível consultar o financeiro.'},{status:503});
 const sum=(type:string)=>(r.data||[]).filter(x=>x.type===type).reduce((a,x)=>a+Number(x.amount),0),income=sum('income'),expense=sum('expense');
 const brl=(v:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:body.currency}).format(v);
 try{const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${e.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`summary-${data.user.id}-${body.business_id}-${body.currency}-${body.period}-${new Date().toISOString().slice(0,10)}`},body:JSON.stringify({from:e.RESEND_FROM,to:[data.user.email],subject:`Seu resumo Fluxo · ${body.period}`,html:`<div style="font-family:Arial;color:#153e2e"><h1>Seu negócio, por inteiro.</h1><p>Resumo de caixa · ${body.period}</p><p>Receitas: <b>${brl(income)}</b></p><p>Despesas: <b>${brl(expense)}</b></p><p>Resultado: <b>${brl(income-expense)}</b></p><p>Somente lançamentos realizados.</p></div>`})});if(!response.ok)return Response.json({error:'O provedor não aceitou o envio. Verifique o remetente e a configuração.'},{status:502});return Response.json({ok:true})}catch{return Response.json({error:'Serviço de e-mail indisponível.'},{status:503})}
}

