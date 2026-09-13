"use client";
import {useEffect,useRef} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {bounds,type MeshData} from '@/lib/three-mf';
export default function ModelViewer({mesh,axis,cut,showPlane}:{mesh?:MeshData;axis:number;cut:number;showPlane:boolean}){
 const host=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const el=host.current;if(!el||!mesh)return;
  let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true})}catch{el.textContent='Visualização 3D indisponível: habilite WebGL no navegador.';return}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));el.replaceChildren(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.1,100000);
  const b=bounds(mesh),center=new THREE.Vector3(...b.min.map((v,i)=>(v+b.max[i])/2) as [number,number,number]),size=Math.max(...b.size,1);
  camera.up.set(0,0,1);camera.position.copy(center).add(new THREE.Vector3(size*1.8,-size*2.2,size*1.6));
  const control=new OrbitControls(camera,renderer.domElement);control.target.copy(center);control.enableDamping=true;
  scene.add(new THREE.HemisphereLight(0xffffff,0x586e6a,2.5));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(size,-size,size*3);scene.add(light);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(mesh.positions,3));geometry.setIndex(mesh.triangles);geometry.computeVertexNormals();
  const material=new THREE.MeshStandardMaterial({color:'#64bd9c',metalness:.12,roughness:.38,side:THREE.DoubleSide});scene.add(new THREE.Mesh(geometry,material));
  const grid=new THREE.GridHelper(size*2,20,0xa9bfbc,0xd9e5df);grid.rotation.x=Math.PI/2;grid.position.set(center.x,center.y,b.min[2]-.02);scene.add(grid);
  const planeGeometry=new THREE.PlaneGeometry(size*1.5,size*1.5),planeMaterial=new THREE.MeshBasicMaterial({color:0xe3ae51,opacity:.25,transparent:true,side:THREE.DoubleSide,depthWrite:false});const plane=new THREE.Mesh(planeGeometry,planeMaterial);
  plane.position.copy(center);plane.position.setComponent(axis,cut);if(axis===0)plane.rotation.y=Math.PI/2;if(axis===1)plane.rotation.x=Math.PI/2;if(showPlane)scene.add(plane);
  const resize=()=>{renderer.setSize(el.clientWidth,el.clientHeight);camera.aspect=el.clientWidth/el.clientHeight;camera.updateProjectionMatrix()};const observer=new ResizeObserver(resize);observer.observe(el);resize();
  let frame=0;const draw=()=>{control.update();renderer.render(scene,camera);frame=requestAnimationFrame(draw)};draw();
  return()=>{cancelAnimationFrame(frame);observer.disconnect();control.dispose();geometry.dispose();material.dispose();planeGeometry.dispose();planeMaterial.dispose();grid.geometry.dispose();(grid.material as THREE.Material).dispose();renderer.dispose();el.replaceChildren()};
 },[mesh,axis,cut,showPlane]);
 return <div className="model-viewport" ref={host} aria-label="Prévia 3D interativa">{!mesh&&<span>Gere uma peça ou carregue um arquivo 3MF para começar.</span>}</div>;
}
