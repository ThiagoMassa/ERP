import {z} from 'zod';
export const adminRecordOperations=['products','partners','orders','order_detail','titles','title_detail','stock','movements','jobs','spools','printers','recipes'] as const;
export const adminRecordRequest=z.object({company:z.string().uuid(),operation:z.enum(adminRecordOperations),filters:z.object({query:z.string().max(160).optional(),id:z.string().uuid().optional(),page:z.number().int().min(0).max(100000).default(0),size:z.number().int().min(1).max(50).default(20),kind:z.enum(['sale','purchase','quote']).optional()}).strict().default({})}).strict();
