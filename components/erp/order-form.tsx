"use client";
import {useState} from 'react';
import {Plus,Trash2,PackageCheck} from 'lucide-react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Fields,EntityPicker,values} from './operation-fields';
import {num,rows,str,today,type Row} from '@/lib/operations';
import {useLocale} from './locale';
type Item={product_id:string;name:string;quantity:string;price:string;discount:string};
export default function OrderForm({db,business,kind,row,lookup,busy,onSave}:{db:SupabaseClient;business:string;kind:string;row:Row;lookup:Row;busy:boolean;onSave:(d:Row)=>void}) {
 const {currency,money}=useLocale();const [partner,setPartner]=useState(str(row.partner_id)),[items,setItems]=useState<Item[]>(rows(row.items).map(r=>({product_id:str(r.product_id),name:str(r.name),quantity:str(r.quantity),price:str(r.price),discount:str(r.discount)}))),[selected,setSelected]=useState(''),[selectedProduct,setProduct]=useState<Row>(),[terms,setTerms]=useState('');
 const total=items.reduce((a,l)=>a+num(l.quantity)*num(l.price)-num(l.discount),0);const term=rows(lookup.terms).find(t=>t.id===terms);
 function change(i:number,key:keyof Item,value:string){setItems(items.map((r,index)=>index===i?{...r,[key]:value}:r))}
 return <form onSubmit={e=>{e.preventDefault();onSave({...values(e.currentTarget),...(row.id?{id:row.id}:{}),kind,partner_id:partner,currency:row.currency||currency,items})}}>
 <div className="op-step-note"><span>1</span><div><b>Defina o parceiro e as condições</b><small>Os preços e as condições ficam preservados neste documento.</small></div></div>
 <EntityPicker db={db} business={business} currency={currency} source="partners" label={kind==='purchase'?'Fornecedor':'Cliente'} value={partner} onChange={setPartner} filter={r=>!!r[kind==='purchase'?'supplier':'customer']} initial={rows(lookup.partners).concat(row.partner_id?[{id:row.partner_id,name:row.partner_name}]:[])}/>
 <label className="op-field">Condição cadastrada<select value={terms} onChange={e=>setTerms(e.target.value)}><option value="">Personalizar condições abaixo</option>{rows(lookup.terms).map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.name)}</option>)}</select></label>
 <Fields key={terms} row={row} fields={[{key:'date',label:'Data comercial',type:'date',required:true,value:today()},{key:'due_date',label:'Primeiro vencimento',type:'date',required:true,value:today()},{key:'installments',label:'Parcelas',type:'number',required:true,min:1,max:36,step:'1',value:num(term?.installments)||1},{key:'interval_days',label:'Intervalo entre parcelas (dias)',type:'number',required:true,min:1,max:365,step:'1',value:num(term?.interval_days)||30},{key:'payment_method',label:'Forma de pagamento',value:str(term?.method)||'transfer',options:[['transfer','Transferência'],['card','Cartão'],['cash','Dinheiro'],['other','Outro']]}]}/>
 <div className="op-step-note"><span>2</span><div><b>Monte os itens do pedido</b><small>Desconto é o valor total retirado da linha. Estoque só muda no atendimento.</small></div></div>
 <EntityPicker db={db} business={business} currency={currency} source="products" required={false} label="Buscar produto ou serviço" value={selected} onChange={(id,r)=>{setSelected(id);setProduct(r)}}/>
 <button type="button" className="secondary" disabled={!selectedProduct} onClick={()=>{if(!selectedProduct)return;setItems([...items,{product_id:selected,name:str(selectedProduct.name),quantity:'1',price:str(selectedProduct[kind==='purchase'?'cost':'price']),discount:'0'}]);setSelected('');setProduct(undefined)}}><Plus size={16}/>Adicionar item</button>
 <div className="op-order-items">{items.map((item,i)=><div className="op-order-item" key={i}><b>{item.name}</b><div className="op-item-inputs">{(['quantity','price','discount'] as const).map((k,j)=><label key={k}>{['Quantidade','Preço unitário','Desconto'][j]}<input type="number" min={k==='quantity'?'.001':'0'} step={k==='quantity'?'.001':'.0001'} required value={item[k]} onChange={e=>change(i,k,e.target.value)}/></label>)}<button type="button" className="op-icon danger-text" aria-label={'Remover '+item.name} onClick={()=>setItems(items.filter((_,n)=>n!==i))}><Trash2 size={18}/></button></div><small>Total da linha: {money(num(item.quantity)*num(item.price)-num(item.discount))}</small></div>)}</div>
 <Fields fields={[{key:'notes',label:'Observações e condições acordadas',type:'textarea'}]} row={row}/>
 <div className="op-form-footer"><span><small>Total estimado</small><strong>{money(total)}</strong></span><button className="primary" disabled={busy||!items.length||!partner||total<0}><PackageCheck size={18}/>{busy?'Salvando…':'Salvar rascunho'}</button></div><p className="op-muted">O total definitivo é calculado no servidor, com arredondamento da moeda e distribuição exata das parcelas.</p>
 </form>
}

