import assert from 'node:assert/strict';
import {dateRange,financialSeries,calculatePrice,priceDefaults,recommendModels} from '../lib/erp.ts';
import {normalizeOffers} from '../lib/marketplace.ts';
assert.deepEqual(dateRange('week','2026-01-01','',''),{start:'2025-12-29',end:'2026-01-04'});
assert.deepEqual(dateRange('month','2024-02-25','',''),{start:'2024-02-01',end:'2024-02-29'});
assert.equal(dateRange('custom','2026-09-13','2026-09-20','2026-09-01'),null);
const r=financialSeries([{date:'2026-09-01',type:'income',status:'paid',amount:100},{date:'2026-09-01',type:'expense',status:'paid',amount:20},{date:'2026-09-01',type:'income',status:'pending',amount:500},{date:'2026-10-01',type:'income',status:'paid',amount:700}],{start:'2026-09-01',end:'2026-09-30'});
assert.equal(r.length,30);assert.equal(r[0].Receitas,100);assert.equal(r[0].Despesas,20);
const p=calculatePrice('mechanic',{...priceDefaults,material:100,hours:2,hourly:50,rent:1600,fixedEnergy:160,otherFixed:240,productiveHours:160,fees:10,margin:20});assert.equal(p.cost,225);assert.ok(Math.abs(p.price-321.428571)<.00001);
assert.ok(calculatePrice('mechanic',{...priceDefaults,productiveHours:0}).error);
assert.ok(calculatePrice('printing',{...priceDefaults,fees:50,margin:50}).error);
const print=calculatePrice('printing',{...priceDefaults,grams:100,kgCost:100,loss:0,machineHours:2,power:100,kwh:1,maintenance:100,monthlyMachineHours:100,finishHours:1,hourly:10,rent:0,otherFixed:0,packaging:2,fees:0,margin:0});assert.equal(print.cost,24.2);
assert.equal(recommendModels('Oficina mecanica')[0].id,'mechanic');
const offers=normalizeOffers({shopping_results:[{title:'A',source:'Loja',price:'R$ 99,00',extracted_price:99,product_link:'https://example.com/a'},{title:'A',source:'Loja',price:'R$ 99,00',extracted_price:99,product_link:'https://example.com/a'},{title:'B',source:'Other',price:'$20',extracted_price:20,product_link:'https://example.com/b'},{title:'C',source:'Other',price:'R$ 10',extracted_price:10,product_link:'javascript:alert(1)'}]});assert.equal(offers.length,1);assert.equal(offers[0].currency,'BRL');
console.log('Passed: date boundaries, leap year, range validation, paid-only series, pricing models, division by zero, invalid margins, model matching, offer deduplication and currency/URL validation.');

import {currencyStep,roundCurrency} from '../lib/currency.ts';
assert.equal(currencyStep('KWD'),.001);assert.equal(currencyStep('JPY'),1);assert.equal(roundCurrency(12.3456,'KWD'),12.346);assert.equal(roundCurrency(12.8,'JPY'),13);
