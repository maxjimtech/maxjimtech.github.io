import {compileProgram,simulate} from './sixaxis-core.mjs';
import {compareStock} from './sixaxis-compare.mjs';
self.onmessage=({data})=>{
 try{if(data.type==='compare'){const comparison=compareStock(data.sim,data.model,data.offset);self.postMessage({type:'comparison',comparison},[comparison.nominal.buffer]);return;}
  const program=compileProgram(data.source,data.setup);const sim=simulate(program,value=>self.postMessage({type:'progress',value}));self.postMessage({type:'done',program,sim},[sim.removedAt.buffer]);}
 catch(error){self.postMessage({type:'error',message:error.message});}
};
