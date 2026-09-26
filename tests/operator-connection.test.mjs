import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {operatorConnection} from '../lib/server/operator-connection.ts';

for(const value of [undefined,'not-a-url','https://name:secret@example.invalid/postgres','postgres://name@example.invalid/postgres','postgres://name:secret@example.invalid/','postgres://name:secret@example.invalid/postgres?sslmode=disable','postgres://name:secret@example.invalid/postgres#fragment'])assert.throws(()=>operatorConnection(value),e=>e.code==='CONFIGURATION'&&!e.message.includes('secret'));
const options=operatorConnection('postgres://operator:encoded%21@example.invalid:5433/postgres','trusted-ca');
assert.equal(options.ssl.rejectUnauthorized,true);assert.equal(options.ssl.ca,'trusted-ca');assert.equal(options.password,'encoded!');assert.equal(options.port,5433);
const ipv6=operatorConnection('postgres://operator:secret@[::1]/postgres');assert.equal(ipv6.host,'::1');assert.equal(ipv6.ssl.rejectUnauthorized,true);
for(const script of ['prepare-legacy-photos','cutover-tenant']){
 const env={...process.env,ERP_CONTROL_OPERATOR_URL:'postgres://secret:never-print-me@example.invalid/postgres'};
 for(const args of [['--help'],['invalid-uuid']]){
  const result=spawnSync(process.execPath,['--experimental-strip-types',`scripts/${script}.mjs`,...args],{env,encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,args[0]==='--help'?0:1);assert.ok(!(result.stdout+result.stderr).includes('never-print-me'));
 }
}
console.log('PASS: comandos privados, ajuda sem conexão, UUID inválido recusado, segredos não exibidos, TLS validado obrigatório e parâmetros de URL recusados.');
