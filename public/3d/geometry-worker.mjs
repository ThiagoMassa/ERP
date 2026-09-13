import Module from './manifold.js';
import {operate} from './operations.mjs';
const ready=Module({locateFile:file=>new URL(file,import.meta.url).href}).then(m=>{m.setup();return m});
self.onmessage=async ({data})=>{try{self.postMessage({id:data.id,result:operate(await ready,data)})}catch(error){self.postMessage({id:data.id,error:error.message||'Não foi possível processar esta malha. Repare-a no Bambu Studio e tente novamente.'})}};
