import {z} from 'zod';
export const adminProductCorrection=z.object({
 company:z.string().uuid(),operation:z.literal('admin.product.correct'),key:z.string().uuid(),
 data:z.object({id:z.string().uuid(),version:z.number().int().min(1).max(2147483647),reason:z.string().trim().min(10).max(1000),
  patch:z.object({name:z.string().trim().min(1).max(160).optional(),description:z.string().max(2000).optional(),category:z.string().trim().min(1).max(240).optional(),sku:z.string().max(240).optional(),supplier:z.string().max(240).optional(),location:z.string().max(240).optional()}).strict().refine(v=>Object.keys(v).length>0),
 }).strict(),
}).strict();
export const adminRecordOperations=['products','partners','orders','order_detail','titles','title_detail','stock','movements','jobs','spools','printers','recipes'] as const;
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v});
export const adminRecordRequest=z.object({company:z.string().uuid(),operation:z.enum(adminRecordOperations),filters:z.object({query:z.string().max(160).optional(),id:z.string().uuid().optional(),page:z.number().int().min(0).max(100000).default(0),size:z.number().int().min(1).max(50).default(20),kind:z.enum(['sale','purchase','quote']).optional(),currency:z.string().regex(/^[A-Z]{3}$/).optional(),start:date.optional(),end:date.optional()}).strict().refine(v=>!v.start&&!v.end||!!v.start&&!!v.end&&v.start<=v.end,{message:'Informe um período válido.'}).default({})}).strict().refine(v=>!['order_detail','title_detail'].includes(v.operation)||!!v.filters.id,{message:'Informe o identificador do registro.'});
