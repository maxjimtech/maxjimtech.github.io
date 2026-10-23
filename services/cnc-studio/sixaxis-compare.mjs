// Even/odd ray intervals retain internal cavities and overhangs (not a heightfield).
export function compareStock(sim,model,offset=[0,0,0]){
 if(!model?.audit?.valid||model.audit.solid_count!==1)throw Error('體素比較需要單一有效 STEP 實體；多實體可預覽，請分件比較');
 const [nx,ny,nz]=sim.dims,hits=Array.from({length:nx*ny},()=>[]),verts=model.vertices.map(p=>p.map((v,i)=>v+offset[i]));let visits=0;
 for(const tri of model.triangles){
  const [a,b,c]=tri.map(i=>verts[i]),den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-10)continue;
  const lo=[0,1].map(i=>Math.max(0,Math.ceil((Math.min(a[i],b[i],c[i])-sim.min[i])/sim.cell[i]-.5-1e-8))),hi=[0,1].map(i=>Math.min(sim.dims[i]-1,Math.floor((Math.max(a[i],b[i],c[i])-sim.min[i])/sim.cell[i]-.5+1e-8)));
  for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++){
   if(++visits>40000000)throw Error('STEP 比較超過 4,000 萬次射線測試，請降低網格密度');
   const px=sim.min[0]+(x+.5)*sim.cell[0],py=sim.min[1]+(y+.5)*sim.cell[1];
   const u=((b[1]-c[1])*(px-c[0])+(c[0]-b[0])*(py-c[1]))/den,v=((c[1]-a[1])*(px-c[0])+(a[0]-c[0])*(py-c[1]))/den;
   if(u>=-1e-8&&v>=-1e-8&&u+v<=1+1e-8)hits[x+nx*y].push(u*a[2]+v*b[2]+(1-u-v)*c[2]);
  }
 }
 let overcut=0,residual=0,target=0,oddColumns=0;const nominal=new Uint8Array(nx*ny*nz);
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  const zs=hits[x+nx*y].sort((a,b)=>a-b).filter((v,i,all)=>i===0||v-all[i-1]>1e-6);if(zs.length%2){oddColumns++;continue;}
  for(let z=0;z<nz;z++){const height=sim.min[2]+(z+.5)*sim.cell[2],idx=x+nx*(y+ny*z);let inside=false;for(let k=0;k<zs.length;k+=2)if(height>=zs[k]&&height<=zs[k+1]){inside=true;break;}
   nominal[idx]=inside?1:0;if(inside)target++;if(inside&&Number.isFinite(sim.removedAt[idx]))overcut++;if(!inside&&!Number.isFinite(sim.removedAt[idx]))residual++;
  }
 }
 if(oddColumns)throw Error(`STEP 網格有 ${oddColumns} 條射線交點不成對，無法可靠比較`);
 const outside=verts.some(p=>p.some((v,i)=>v<sim.min[i]-1e-5||v>sim.min[i]+sim.size[i]+1e-5));
 return {overcut_mm3:overcut*sim.voxel_mm3,residual_mm3:residual*sim.voxel_mm3,target_mm3:target*sim.voxel_mm3,target_outside_stock:outside,method:'mesh-even-odd-voxel-centers',nominal};
}
