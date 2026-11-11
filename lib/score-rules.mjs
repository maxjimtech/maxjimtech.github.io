// Rules mirror game-v6.js. Only game randomness uses this PRNG; visual FX remain random.
export const MAX_ACTIONS = 10000;
export const SESSION_TTL = 900;
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function replay(seed, actions) {
  if (!Array.isArray(actions) || actions.length > MAX_ACTIONS) throw new Error('actions');
  const random = seededRandom(seed), rnd = (a,b) => a + random() * (b-a);
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const saturation = (T,S) => clamp(14.6244-.367134*T+.0044972*T*T-.0966*S+.00205*S*T+.0002739*S*S,4,14.7);
  let day=1,fish=100,weight=20,score=0,oxygen=6,temp=28,sal=15,feedDone=0,waterDone=0,done=false;
  for (const action of actions) {
    if (done) throw new Error('finished');
    if (action === 'f') {
      if (feedDone>=2) throw new Error('feed');
      feedDone++;
      if (oxygen>=4.5) {weight+=rnd(8,13);score+=12;} else {weight+=rnd(2,5);score-=5;}
      oxygen=Math.max(0,oxygen-.25);
    } else if (action === 'a') {
      const sat=saturation(temp,sal),gap=sat-oxygen;
      if(gap<=.08){oxygen=Math.min(oxygen,sat);score+=1;}
      else {const gain=Math.min(1,Math.max(.15,gap*.45));oxygen=Math.min(sat,oxygen+gain);score+=gain>.25?6:2;}
    } else if (action === 'w') {
      if(waterDone) throw new Error('water');
      waterDone=1;sal=clamp(sal+rnd(-2,2),0,35);temp+=(28-temp)*.35;
      oxygen=Math.min(saturation(temp,sal),oxygen+.45);score+=5;
    } else if (action === 'n') {
      let healthy=true;
      if(oxygen<4){const loss=Math.ceil(rnd(3,8));fish=Math.max(0,fish-loss);score-=loss*8;healthy=false;}
      else if(oxygen<5){fish=Math.max(0,fish-1);score-=4;healthy=false;}
      if(temp<24||temp>33){const l=Math.ceil(rnd(1,4));fish=Math.max(0,fish-l);score-=l*5;healthy=false;}
      if(feedDone===0){score-=5;healthy=false;}else score+=5;
      if(healthy)score+=12;
      day++;feedDone=0;waterDone=0;oxygen=Math.max(0,oxygen-rnd(.45,.85));
      temp=clamp(temp+rnd(-1.2,1.5),22,35);sal=clamp(sal+rnd(-1.7,1.7),0,35);
      if(random()<.22){const e=random();if(e<.34)temp=clamp(temp+rnd(2,3.5),22,36);
        else if(e<.67)oxygen=Math.max(0,oxygen-rnd(.8,1.4));else sal=clamp(sal-rnd(3,5),0,35);}
      done=day>20||fish<=0;
    } else throw new Error('action');
    oxygen=Math.min(oxygen,saturation(temp,sal));
  }
  if(!done) throw new Error('unfinished');
  return Math.max(0,Math.round(score+fish*2+weight*.5));
}
