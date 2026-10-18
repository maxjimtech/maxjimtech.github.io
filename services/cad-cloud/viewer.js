// Display saved STEP tessellation. No CAD kernel or model generation runs here.
export class Viewer {
  constructor(canvas) {
    this.canvas=canvas; this.gl=canvas.getContext('webgl',{antialias:true,alpha:true});this.yaw=-.6;this.pitch=.65;this.zoom=1;this.parts=[];
    if(!this.gl)return;
    const gl=this.gl,compile=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('WebGL shader failed');return s;};
    this.program=gl.createProgram();gl.attachShader(this.program,compile(gl.VERTEX_SHADER,`attribute vec3 p;attribute vec3 n;uniform mat4 m;varying float l;void main(){gl_Position=m*vec4(p,1.0);l=0.35+0.65*abs(dot(normalize(n),normalize(vec3(.4,-.5,1.))));}`));gl.attachShader(this.program,compile(gl.FRAGMENT_SHADER,`precision mediump float;uniform vec3 c;varying float l;void main(){gl_FragColor=vec4(c*l,1.0);}`));gl.linkProgram(this.program);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error('WebGL program failed');
    canvas.addEventListener('pointerdown',e=>{this.drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{if(!this.drag)return;this.yaw+=(e.clientX-this.drag[0])*.008;this.pitch=Math.max(-1.5,Math.min(1.5,this.pitch+(e.clientY-this.drag[1])*.008));this.drag=[e.clientX,e.clientY];this.draw();});
    canvas.addEventListener('pointerup',()=>this.drag=null);canvas.addEventListener('pointercancel',()=>this.drag=null);
    canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom=Math.max(.3,Math.min(5,this.zoom*Math.exp(-e.deltaY*.001)));this.draw();},{passive:false});
    new ResizeObserver(()=>this.draw()).observe(canvas);
  }
  reset(){this.yaw=-.6;this.pitch=.65;this.zoom=1;this.draw();}
  load(scene){
    if(!this.gl)throw Error('此瀏覽器未提供 WebGL，可下載 STEP 查看。');
    const gl=this.gl;for(const p of this.parts){gl.deleteBuffer(p.positions);gl.deleteBuffer(p.normals);}this.parts=[];
    let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const p of scene.parts)for(const v of p.vertices)for(let a=0;a<3;a++){min[a]=Math.min(min[a],v[a]);max[a]=Math.max(max[a],v[a]);}
    const centre=min.map((v,i)=>(v+max[i])/2),radius=Math.max(...max.map((v,i)=>v-min[i]))/2;
    if(!Number.isFinite(radius)||radius<=0)throw Error('預覽網格無效');
    for(const p of scene.parts){const pos=[],norm=[];for(const f of p.faces){const [a,b,c]=f.map(i=>p.vertices[i].map((v,j)=>(v-centre[j])/radius));const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];const len=Math.hypot(...n)||1;for(const vert of [a,b,c]){pos.push(...vert);norm.push(...n.map(x=>x/len));}}
      const buffer=data=>{const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);return b;};
      this.parts.push({positions:buffer(pos),normals:buffer(norm),count:pos.length/3,color:[1,3,5].map(i=>parseInt(p.color.slice(i,i+2),16)/255)});
    }this.reset();
  }
  draw(){
    if(!this.gl)return;const gl=this.gl,c=this.canvas;const dpr=Math.min(devicePixelRatio||1,2);c.width=Math.round(c.clientWidth*dpr);c.height=Math.round(c.clientHeight*dpr);if(!c.width||!c.height)return;gl.viewport(0,0,c.width,c.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.useProgram(this.program);
    const cy=Math.cos(this.yaw),sy=Math.sin(this.yaw),cp=Math.cos(this.pitch),sp=Math.sin(this.pitch),s=this.zoom*.65,aspect=c.width/c.height;
    // Orthographic camera; enough depth to keep all geometry in the clip volume.
    const matrix=new Float32Array([cy*s/aspect,sy*sp*s,sy*cp*.2,0, -sy*s/aspect,cy*sp*s,cy*cp*.2,0, 0,-cp*s,sp*.2,0, 0,0,0,1]);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program,'m'),false,matrix);
    const attr=(name,buf)=>{const loc=gl.getAttribLocation(this.program,name);gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);};
    for(const p of this.parts){attr('p',p.positions);attr('n',p.normals);gl.uniform3fv(gl.getUniformLocation(this.program,'c'),p.color);gl.drawArrays(gl.TRIANGLES,0,p.count);}
  }
}
