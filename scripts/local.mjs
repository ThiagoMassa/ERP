import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
if(existsSync('.dev.vars'))process.loadEnvFile('.dev.vars');
const mode=process.argv[2]||'dev';
const args=['node_modules/next/dist/bin/next',mode,...(mode==='dev'?['--webpack']:[]),'-p',process.env.LOCAL_PORT||'5173'];
const child=spawn(process.execPath,args,{stdio:'inherit',env:process.env});
child.on('exit',code=>process.exit(code??1));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));

