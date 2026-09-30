// Every operation affecting security is atomic in Redis, shared by all instances.
export const RATE_SCRIPT = `
local ip = redis.call('INCR', KEYS[1])
if ip == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local total = redis.call('INCR', KEYS[2])
if total == 1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end
return {ip, total}`;
export const SUBMIT_SCRIPT = `
local session = redis.call('GET', KEYS[1])
if not session or session ~= ARGV[1] then return false end
local raw = redis.call('GET', KEYS[2]) or ARGV[3]
local board = cjson.decode(raw)
local entry = cjson.decode(ARGV[2])
local high = entry.score > board.highScore.score
local rows = board.top10
rows[#rows+1] = entry
table.sort(rows, function(a,b) return a.score > b.score end)
while #rows > 10 do table.remove(rows) end
if high then board.highScore = entry end
local encoded = cjson.encode(board)
redis.call('SET', KEYS[2], encoded)
redis.call('DEL', KEYS[1])
return {encoded, high and 1 or 0}`;
export function redisStore(env=process.env, fetcher=fetch) {
  const url=env.UPSTASH_REDIS_REST_URL, token=env.UPSTASH_REDIS_REST_TOKEN;
  if(!url || !token) return null;
  if(new URL(url).protocol!=='https:') throw new Error('Redis configuration');
  const prefix=env.VERCEL_ENV==='production'?'xiaoyuge:v2:production:':'xiaoyuge:v2:preview:';
  async function command(args){
    const response=await fetcher(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(4000)});
    if(!response.ok)throw new Error('Redis unavailable');
    const data=await response.json();if(data.error)throw new Error('Redis unavailable');return data.result;
  }
  return {
    async rate(ip, now){const bucket=Math.floor(now/60000);
      const [client,total]=await command(['EVAL',RATE_SCRIPT,2,`${prefix}rate:${bucket}:${ip}`,`${prefix}global:${bucket}`,120]);
      return client<=12 && total<=120;},
    async create(id,session,ttl){return await command(['SET',prefix+'session:'+id,JSON.stringify(session),'EX',ttl,'NX'])==='OK';},
    async session(id){const raw=await command(['GET',prefix+'session:'+id]);return raw?JSON.parse(raw):null;},
    async initialize(board){return await command(['SET',prefix+'board',JSON.stringify(board),'NX'])==='OK';},
    async board(){const raw=await command(['GET',prefix+'board']);if(!raw)return null;const board=JSON.parse(raw);if(!Array.isArray(board.top10))board.top10=[];return board;},
    async submit(id,session,entry,fallback){const result=await command(['EVAL',SUBMIT_SCRIPT,2,prefix+'session:'+id,prefix+'board',JSON.stringify(session),JSON.stringify(entry),JSON.stringify(fallback)]);
      if(!result)return null;const board=JSON.parse(result[0]);if(!Array.isArray(board.top10))board.top10=[];return {board,newHigh:result[1]===1};}
  };
}
