import {rotate,cuttingRadius,isSolid} from './sixaxis-core.mjs';
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export class View3D{
 constructor(canvas){
  this.canvas=canvas;this.gl=canvas.getContext('webgl',{antialias:true,preserveDrawingBuffer:true});if(!this.gl)throw Error('此瀏覽器無法啟用 WebGL，請開啟硬體加速');
  const gl=this.gl,shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,`attribute vec3 position;attribute vec3 normal;uniform vec3 center,right,up,forward;uniform vec2 scale;varying float light;void main(){vec3 d=position-center;gl_Position=vec4(dot(d,right)/scale.x,dot(d,up)/scale.y,-dot(d,forward)/(scale.y*8.),1.);light=length(normal)<.1?1.:.40+.60*abs(dot(normal,normalize(vec3(.3,.5,1.))));}`));
  gl.attachShader(p,shader(gl.FRAGMENT_SHADER,`precision mediump float;uniform vec4 color;varying float light;void main(){gl_FragColor=vec4(color.rgb*light,color.a);}`));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error('WebGL 著色器連結失敗');
  this.program=p;this.buffers=new Map();this.yaw=-.8;this.pitch=.65;this.extent=65;this.center=[0,0,0];this.zoom=1;this.camera='iso';
  let last=null;canvas.addEventListener('pointerdown',e=>{last=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointermove',e=>{if(!last)return;this.yaw-=(e.clientX-last[0])*.008;this.pitch=Math.max(-1.5,Math.min(1.5,this.pitch+(e.clientY-last[1])*.008));last=[e.clientX,e.clientY];this.draw();});canvas.addEventListener('pointerup',()=>last=null);canvas.addEventListener('pointercancel',()=>last=null);
  canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom=Math.max(.25,Math.min(8,this.zoom*Math.exp(-e.deltaY*.001)));this.draw();},{passive:false});new ResizeObserver(()=>this.draw()).observe(canvas);
 }
 fit(stock){this.center=stock.min.map((v,i)=>v+stock.size[i]/2);this.extent=Math.max(...stock.size)*.78;this.zoom=1;}
 cameraView(view){if(view==='top'){this.pitch=Math.PI/2;this.yaw=-Math.PI/2;}else if(view==='front'){this.pitch=0;this.yaw=-Math.PI/2;}else if(view==='side'){this.pitch=0;this.yaw=0;}else{this.pitch=.65;this.yaw=-.8;}this.draw();}
 set(name,vertices,color,lines=false){const gl=this.gl;let b=this.buffers.get(name);if(!b)b={buffer:gl.createBuffer()};gl.bindBuffer(gl.ARRAY_BUFFER,b.buffer);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);Object.assign(b,{count:vertices.length/6,color,lines,visible:true});this.buffers.set(name,b);}
 visible(name,value){if(this.buffers.has(name))this.buffers.get(name).visible=value;this.draw();}
 draw(){
  const gl=this.gl,c=this.canvas;if(!gl)return;const ratio=Math.min(2,devicePixelRatio||1),w=Math.max(1,Math.floor(c.clientWidth*ratio)),h=Math.max(1,Math.floor(c.clientHeight*ratio));if(c.width!==w||c.height!==h){c.width=w;c.height=h;}gl.viewport(0,0,w,h);gl.clearColor(.033,.055,.09,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.useProgram(this.program);
  const cy=Math.cos(this.yaw),sy=Math.sin(this.yaw),cp=Math.cos(this.pitch),sp=Math.sin(this.pitch);
  const uniform=(name,value)=>gl.uniform3fv(gl.getUniformLocation(this.program,name),value);
  uniform('center',this.center);uniform('right',[-sy,cy,0]);uniform('up',[-cy*sp,-sy*sp,cp]);uniform('forward',[cy*cp,sy*cp,sp]);gl.uniform2fv(gl.getUniformLocation(this.program,'scale'),[this.extent/this.zoom*w/h,this.extent/this.zoom]);
  for(const [name,b] of this.buffers){if(!b.visible||!b.count)continue;gl.bindBuffer(gl.ARRAY_BUFFER,b.buffer);for(const [attr,offset] of [['position',0],['normal',12]]){const loc=gl.getAttribLocation(this.program,attr);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,24,offset);}gl.uniform4fv(gl.getUniformLocation(this.program,'color'),b.color);gl.drawArrays(b.lines?gl.LINES:gl.TRIANGLES,0,b.count);}
 }
}
export function lineVertices(lines){return new Float32Array(lines.flatMap(pair=>pair.flatMap(v=>[...v,0,0,0])));}
export function boxLines(min,max){const corners=Array.from({length:8},(_,i)=>min.map((v,j)=>(i>>j)&1?max[j]:v));return lineVertices(corners.flatMap((p,i)=>[0,1,2].filter(j=>!((i>>j)&1)).map(j=>[p,corners[i|(1<<j)]])));}
export function toolMesh(p,tool,machine){
 const out=[],map=v=>rotate(v,p.abc,machine.order).map((x,i)=>x+p.tip[i]);
 const triangle=(a,b,c)=>{const n=cross(b.map((v,i)=>v-a[i]),c.map((v,i)=>v-a[i])),l=Math.hypot(...n)||1;for(const point of [a,b,c])out.push(...point,...n.map(v=>v/l));};
 const profiles=[];for(let i=0;i<=16;i++){const z=tool.flute_length*i/16;profiles.push([z,Math.max(0,cuttingRadius(tool,z))]);}profiles.push([tool.length,tool.diameter/2],[tool.length,tool.holder_diameter/2],[tool.length+tool.holder_length,tool.holder_diameter/2]);
 for(let j=1;j<profiles.length;j++)for(let i=0;i<24;i++){
  const [za,ra]=profiles[j-1],[zb,rb]=profiles[j],a=i/24*Math.PI*2,b=(i+1)/24*Math.PI*2;
  const pts=[[ra*Math.cos(a),ra*Math.sin(a),za],[ra*Math.cos(b),ra*Math.sin(b),za],[rb*Math.cos(b),rb*Math.sin(b),zb],[rb*Math.cos(a),rb*Math.sin(a),zb]].map(map);triangle(pts[0],pts[1],pts[2]);triangle(pts[0],pts[2],pts[3]);
 }
 for(const [z,r,flip] of [[profiles[0][0],profiles[0][1],true],[profiles.at(-1)[0],profiles.at(-1)[1],false]])for(let i=0;i<24;i++){
  const a=i/24*2*Math.PI,b=(i+1)/24*2*Math.PI,pts=[map([0,0,z]),map([r*Math.cos(a),r*Math.sin(a),z]),map([r*Math.cos(b),r*Math.sin(b),z])];if(flip)pts.reverse();triangle(...pts);
 }
 return new Float32Array(out);
}
export function drawSection(canvas,sim,time,plane,fraction){
 const ctx=canvas.getContext('2d'),w=canvas.width=canvas.clientWidth*2,h=canvas.height=canvas.clientHeight*2;
 ctx.fillStyle='#091321';ctx.fillRect(0,0,w,h);if(!sim)return;
 const [u,v,axis]=plane==='xy'?[0,1,2]:plane==='xz'?[0,2,1]:[1,2,0];
 const slice=Math.min(sim.dims[axis]-1,Math.floor(fraction*(sim.dims[axis]-1))),scale=Math.min((w-40)/sim.size[u],(h-40)/sim.size[v]);
 const left=(w-sim.size[u]*scale)/2,top=(h-sim.size[v]*scale)/2;
 for(let b=0;b<sim.dims[v];b++)for(let a=0;a<sim.dims[u];a++){const p=[0,0,0];p[axis]=slice;p[u]=a;p[v]=b;const solid=isSolid(sim,...p,time);ctx.fillStyle=solid?'#7caec0':'#213145';ctx.fillRect(left+a*sim.cell[u]*scale,top+(sim.dims[v]-1-b)*sim.cell[v]*scale,sim.cell[u]*scale+.3,sim.cell[v]*scale+.3);}
 ctx.fillStyle='#b5c8db';ctx.font='20px sans-serif';ctx.fillText(`${plane.toUpperCase()} · ${'XYZ'[axis]} = ${(sim.min[axis]+(slice+.5)*sim.cell[axis]).toFixed(2)} mm`,14,25);
}
export function drawGraph(canvas,program,sim,time){
 const ctx=canvas.getContext('2d'),w=canvas.width=canvas.clientWidth*2,h=canvas.height=canvas.clientHeight*2;ctx.clearRect(0,0,w,h);if(!program)return;
 ctx.strokeStyle='#314156';ctx.beginPath();ctx.moveTo(0,h-2);ctx.lineTo(w,h-2);ctx.stroke();
 const colors=['#4fd1c5','#87a8ff','#f2bf66'],limits=program.setup.machine.limits.slice(3);
 for(let a=0;a<3;a++){ctx.strokeStyle=colors[a];ctx.lineWidth=2;ctx.beginPath();for(let i=0;i<program.moves.length;i++){const m=program.moves[i];const y=v=>h-8-(v-limits[a][0])/(limits[a][1]-limits[a][0])*(h-16);if(i===0)ctx.moveTo(m.t0/program.duration*w,y(m.abc_a[a]));ctx.lineTo(m.t1/program.duration*w,y(m.abc_b[a]));}ctx.stroke();}
 ctx.strokeStyle='#ffffff';ctx.beginPath();ctx.moveTo(time/program.duration*w,0);ctx.lineTo(time/program.duration*w,h);ctx.stroke();
}
