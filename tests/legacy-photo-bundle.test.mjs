import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {openLegacyPhotoBundle} from '../lib/server/legacy-photo-bundle.ts';

const parent=resolve('work');await mkdir(parent,{recursive:true});
const directory=await mkdtemp(join(parent,'photos-test-'));
const company=randomUUID(),manifest=join(directory,'manifest.json');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=','base64');
const hash=createHash('sha256').update(png).digest('hex');
const photo={name:company+'/photo.png',filename:'Foto.png',mime:'image/png',size_bytes:png.length,sha256:hash};
const write=async data=>writeFile(manifest,JSON.stringify(data));
const valid={version:1,company,photos:[photo]};
const invalid=e=>e.code==='ASSET_BUNDLE_INVALID';
try{
 await writeFile(join(directory,hash+'.bin'),png);await write(valid);
 const bundle=await openLegacyPhotoBundle(manifest,company);
 assert.deepEqual(Buffer.from(await bundle.read(bundle.photos[0])),png);
 assert.ok(Object.isFrozen(bundle)&&Object.isFrozen(bundle.photos)&&Object.isFrozen(bundle.photos[0]));
 await assert.rejects(bundle.read({...photo}),invalid);
 await assert.rejects(openLegacyPhotoBundle(manifest,randomUUID()),invalid);
 for(const photos of [[photo,photo],[{...photo,name:'../secret'}],[{...photo,filename:'../secret'}],[{...photo,sha256:'../secret'}],[{...photo,size_bytes:5242881}],[{...photo,mime:'text/html'}],[{...photo,url:'https://example.test'}]]){
  await write({...valid,photos});await assert.rejects(openLegacyPhotoBundle(manifest,company),invalid);
 }
 await write(valid);
 await writeFile(join(directory,hash+'.bin'),Buffer.alloc(png.length,1));
 await assert.rejects(bundle.read(bundle.photos[0]),invalid);
 await writeFile(join(directory,hash+'.bin'),Buffer.alloc(png.length+1,1));
 await assert.rejects(bundle.read(bundle.photos[0]),invalid);
 await writeFile(join(directory,hash+'.bin'),png);
 await write({...valid,photos:[{...photo,mime:'image/jpeg'}]});
 const wrongMime=await openLegacyPhotoBundle(manifest,company);await assert.rejects(wrongMime.read(wrongMime.photos[0]),invalid);
 await writeFile(manifest,'{broken');await assert.rejects(openLegacyPhotoBundle(manifest,company),invalid);
 await writeFile(manifest,Buffer.alloc(4*1024*1024+1));await assert.rejects(openLegacyPhotoBundle(manifest,company),invalid);
 console.log('PASS: pacote local limitado; empresa e campos verificados; referências imutáveis; caminhos inválidos, duplicatas, formato, tamanho e adulteração recusados.');
}finally{
 assert.equal(dirname(resolve(directory)),parent);await rm(directory,{recursive:true,force:true});
}
