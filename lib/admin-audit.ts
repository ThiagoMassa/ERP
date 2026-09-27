import {z} from 'zod';

const id=z.string().regex(/^[1-9][0-9]{0,18}$/).refine(v=>/^[0-9]{1,19}$/.test(v)&&BigInt(v)<=BigInt('9223372036854775807'));
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v});
export const auditFilters=z.object({
 company:z.string().uuid().nullable().default(null),actor:z.string().uuid().nullable().default(null),subject:z.string().uuid().nullable().default(null),
 entity:z.string().trim().max(200).default(''),action:z.string().trim().max(160).default(''),result:z.enum(['success','denied','failed']).nullable().default(null),
 from:date,to:date,upper:id.nullable().default(null),before:id.nullable().default(null),
}).strict().refine(v=>{const days=(Date.parse(v.to)-Date.parse(v.from))/86400000;return days>=0&&days<366},{message:'Selecione até 366 dias, com início anterior ao fim.'});
export type AuditFilters=z.infer<typeof auditFilters>;
export const auditRequest=z.object({mode:z.enum(['read','export']),filters:auditFilters}).strict();
