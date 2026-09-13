import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('public/3d',{recursive:true});
await Promise.all(['manifold.js','manifold.wasm'].map(file=>copyFile(`node_modules/manifold-3d/${file}`,`public/3d/${file}`)));
