import type {SupabaseClient} from '@supabase/supabase-js';

export type Row = Record<string, unknown>;
export type PageData = {rows: Row[]; count: number};
export type Filters = {query?: string; page?: number; size?: number; currency?: string; start?: string; end?: string; status?: string; kind?: string; id?: string};
export const str = (v: unknown) => v == null ? '' : String(v);
export const num = (v: unknown) => Number(v || 0);
export const rows = (v: unknown): Row[] => Array.isArray(v) ? v as Row[] : [];
export const today = () => new Date().toLocaleDateString('en-CA');
export const labels: Record<string,string> = {draft:'Rascunho',confirmed:'Confirmado',completed:'Concluído',cancelled:'Cancelado',converted:'Convertido',planned:'Planejada',printing:'Imprimindo',failed:'Falhou',income:'A receber',expense:'A pagar',sale:'Venda',purchase:'Compra',quote:'Orçamento',admin:'Administrador',sales:'Comercial',purchases:'Compras',stock:'Estoque',finance:'Financeiro',read:'Leitura',opening:'Abertura',inventory:'Inventário',adjustment:'Ajuste',transfer:'Transferência',reversal:'Estorno',return:'Devolução',print:'Consumo 3D',production:'Produção',bank:'Banco',cash:'Caixa'};
export const label = (v: unknown) => labels[str(v)] || str(v);
export function titleStatus(row: Row) {return row.cancelled_at?'Cancelado':num(row.paid)>=num(row.amount)?'Liquidado':str(row.due_date)<today()?'Vencido':num(row.paid)>0?'Parcial':'Em aberto';}
export async function readERP(db: SupabaseClient,business: string|null,module: string,filters: Filters={}): Promise<unknown> {
 const {data,error}=await db.rpc('erp_read',{p_business:business,p_module:module,p_filters:filters});
 if(error)throw new Error(error.message);return data;
}
export async function commandERP(db: SupabaseClient,business: string|null,action: string,data: Row,key: string): Promise<Row> {
 const {data:result,error}=await db.rpc('erp_command',{p_business:business,p_action:action,p_data:data,p_key:key});
 if(error)throw new Error(error.message);return result as Row;
}
export function downloadCSV(name: string,records: Row[]) {
 const fields=[...new Set(records.flatMap(r=>Object.keys(r).filter(k=>!Array.isArray(r[k])&&typeof r[k]!=='object')))];
 const cell=(v:unknown)=>'"'+str(v).replace(/^[\s]*[=+@-]/,"'").replaceAll('"','""')+'"';
 const csv='\uFEFF'+[fields,...records.map(r=>fields.map(f=>r[f]))].map(line=>line.map(cell).join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function errorMessage(error: unknown) {const message=error instanceof Error?error.message:'Não foi possível concluir. Tente novamente.';if(message.includes('duplicate key'))return 'Já existe um registro com esse código ou documento nesta empresa.';if(message.includes('check constraint')||message.includes('invalid input')||message.includes('not-null'))return 'Confira os campos obrigatórios e os valores informados.';return message;}

export const demoOverview: Row = {income:4260,expense:1840,receivable:1280,payable:680,overdue:220,sales:5540,low_stock:2,open_orders:4,printing:2,series:[{day:'2026-09-01',income:520,expense:100},{day:'2026-09-02',income:320,expense:200},{day:'2026-09-03',income:810,expense:460},{day:'2026-09-04',income:630,expense:120},{day:'2026-09-05',income:980,expense:600},{day:'2026-09-06',income:1000,expense:360}],forecast:[{day:'2026-09-07',income:1280,expense:680}],top_products:[{name:'Vaso geométrico',unit:'un',quantity:24,total:1440},{name:'Suporte de mesa',unit:'un',quantity:18,total:1080}]};

