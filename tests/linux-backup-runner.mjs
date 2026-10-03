// Disposable, offline fixture inside the verification container only.
import {execFileSync,spawn} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
if(process.platform!=='linux'||process.cwd()!=='/app')throw Error('Use only the Linux verification container.');
const bin='/usr/lib/postgresql/17/bin',directory=resolve('work/pg-test-data');
await mkdir('work',{recursive:true});
await writeFile('work/pg-test-password',randomBytes(36).toString('base64url'),{mode:0o600,flag:'wx'});
const env={...process.env,ERP_TEST_PG_BIN:bin};
execFileSync(bin+'/initdb',['-D',directory,'-U','erp_test_admin','--pwfile=/app/work/pg-test-password','--auth=scram-sha-256'],{env,stdio:'ignore'});
let started=false;
try{
 execFileSync(bin+'/pg_ctl',['-D',directory,'-l','/app/work/postgres.log','-o','-h 127.0.0.1 -p 55439','-w','start'],{env,stdio:'ignore'});started=true;
 for(const test of ['tenant-preflight','admin-records','tenant-corrections','tenant-backup'])await new Promise((yes,no)=>{
  const child=spawn(process.execPath,['--experimental-strip-types',`tests/${test}.test.mjs`],{env,stdio:'inherit'});
  child.once('error',no);child.once('exit',code=>code===0?yes():no(Error(`${test} failed (${code})`)));
 });
}finally{if(started)execFileSync(bin+'/pg_ctl',['-D',directory,'-m','fast','-w','stop'],{env,stdio:'ignore'})}
