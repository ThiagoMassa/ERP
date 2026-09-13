export function currencyDigits(code:string){
  return new Intl.NumberFormat('en',{style:'currency',currency:code}).resolvedOptions().maximumFractionDigits ?? 2;
}
export function currencyStep(code:string){return 10 ** -currencyDigits(code)}
export function roundCurrency(value:number,code:string){const factor=10 ** currencyDigits(code);return Math.round((value+Number.EPSILON)*factor)/factor}
