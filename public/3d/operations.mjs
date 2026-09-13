export function operate(M, job) {
  const owned=new Set();
  const keep=m=>{owned.add(m);return m};
  const finite=(v,min,max)=>{if(!Number.isFinite(v)||v<min||v>max)throw Error('Parâmetro fora do limite.');return v};
  const output=m=>{
    if(m.isEmpty()||m.volume()<=0)throw Error('A operação não produziu uma peça sólida.');
    if(m.numTri()>400000)throw Error('Resultado muito complexo. Use uma malha menor.');
    const mesh=m.getMesh();
    const positions=[];
    for(let i=0;i<mesh.vertProperties.length;i+=mesh.numProp)positions.push(...mesh.vertProperties.slice(i,i+3));
    return {positions,triangles:Array.from(mesh.triVerts),volume:m.volume(),area:m.surfaceArea(),bounds:m.boundingBox()};
  };
  try {
    if(job.action==='generate'){
      const [w,d,h]=job.size.map(v=>finite(v,2,1000));
      const wall=finite(job.wall,.5,Math.min(w,d,h)/3);
      let result;
      if(job.shape==='box'){
        const outer=keep(M.Manifold.cube([w,d,h]));
        const inner=keep(M.Manifold.cube([w-2*wall,d-2*wall,h]));
        result=keep(outer.subtract(keep(inner.translate([wall,wall,wall]))));
      }else if(job.shape==='vase'){
        const outer=keep(M.Manifold.cylinder(h,w/2,d/2,96));
        const inner=keep(M.Manifold.cylinder(h,w/2-wall,d/2-wall,96));
        result=keep(outer.subtract(keep(inner.translate([0,0,wall]))));
      }else result=keep(M.Manifold.cube([w,d,h]));
      return [output(result)];
    }
    const {positions,triangles}=job.mesh;
    if(positions.length%3||triangles.length%3||triangles.length>450000||!triangles.length||positions.some(v=>!Number.isFinite(v)||Math.abs(v)>100000)||triangles.some(v=>!Number.isInteger(v)||v<0||v>=positions.length/3))throw Error('Malha inválida ou acima do limite de 150 mil triângulos.');
    const mesh=new M.Mesh({numProp:3,vertProperties:new Float32Array(positions),triVerts:new Uint32Array(triangles)});
    mesh.merge();
    const solid=keep(new M.Manifold(mesh));
    if(job.action==='split'){
      if(![0,1,2].includes(job.axis))throw Error('Eixo inválido.');
      const axis=[0,0,0];axis[job.axis]=1;
      const b=solid.boundingBox();
      const cut=finite(job.cut,b.min[job.axis]+.001,b.max[job.axis]-.001);
      return solid.splitByPlane(axis,cut).map(m=>output(keep(m)));
    }
    if(job.action==='smooth'){
      if(solid.numTri()>90000)throw Error('Suavização limitada a 90 mil triângulos de entrada.');
      const smoothed=keep(solid.smoothOut(finite(job.angle,15,90),0));
      return [output(keep(smoothed.refine(2)))];
    }
    return [output(solid)];
  } finally {for(const m of owned)m.delete()}
}
