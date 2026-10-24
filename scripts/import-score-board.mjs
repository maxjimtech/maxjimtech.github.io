// Run locally with credentials supplied by a secure environment, never command-line values.
import { readFile } from 'node:fs/promises';
import { redisStore } from '../lib/score-store.mjs';
try {
  const store=redisStore();if(!store)throw Error();
  const source=JSON.parse(await readFile(process.argv[2] || 'xiaoyuge/scores.json','utf8'));
  const valid=e=>e && typeof e.name==='string' && e.name.length<=12 && !/[<>\u0000-\u001f\u007f]/.test(e.name) && Number.isSafeInteger(e.score) && e.score>=0 && typeof e.date==='string' && /^(\d{4}-\d{2}-\d{2})?$/.test(e.date);
  if(!valid(source.highScore)||!Array.isArray(source.top10)||!source.top10.every(valid))throw Error();
  const rows=source.top10.map(({name,score,date})=>({name,score,date})).sort((a,b)=>b.score-a.score).slice(0,10);
  const high=rows[0]?.score>source.highScore.score?rows[0]:source.highScore;
  const board={highScore:{name:high.name,score:high.score,date:high.date},top10:rows};
  console.log(await store.initialize(board)?'排行榜已匯入。':'排行榜已存在，未覆寫。');
} catch {console.error('匯入失敗：請檢查安全環境設定與經人工核實的來源檔。');process.exitCode=1;}
