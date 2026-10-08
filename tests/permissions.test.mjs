import assert from 'node:assert/strict';
import {decision,commandPolicy} from '../lib/permissions.ts';

assert.equal(decision({},'catalog','edit').allowed,false);
const policy={catalog:{available:{allowed:false,origin:'Empresa desativada'},edit:{allowed:true,origin:'Usuário'}},finance:{available:{allowed:true,origin:'Perfil'},read:{allowed:true,origin:'Perfil'},export:{allowed:false,origin:'Bloqueio explícito'}}};
assert.deepEqual(decision(policy,'products','edit'),{allowed:false,origin:'Empresa desativada'});
assert.equal(decision(policy,'titles','read').allowed,true);
assert.equal(decision(policy,'titles','export').allowed,false);
assert.equal(decision(policy,'unknown','read').allowed,false);
assert.deepEqual(commandPolicy('fulfillment.reverse',{},'purchase'),{area:'purchases',action:'reverse'});
assert.deepEqual(commandPolicy('product.archive',{},'sale'),{area:'catalog',action:'delete'});
assert.deepEqual(commandPolicy('order.confirm',{},'sale'),{area:'sales',action:'approve'});
assert.equal(commandPolicy('unknown.save',{},'sale'),null);
console.log('PASS: UI permission defaults, company deny precedence, export/read separation and command action mapping.');

