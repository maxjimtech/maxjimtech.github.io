const REPO = 'maxjimtech/maxjimtech.github.io';
const BRANCH = 'main';
const SCORE_PATH = 'xiaoyuge/scores.json';

function setCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed = origin === 'https://maxjimtech.github.io' || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
  if (allowed) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function cleanName(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 12);
}

function defaultBoard() {
  return {
    highScore: { name: '尚未有人上榜', score: 0, date: '' },
    top10: []
  };
}

async function githubRequest(path, options = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not configured');
  const response = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'xiaoyuge-score-api',
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.message || `GitHub API ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return data;
}

async function readBoard() {
  try {
    const file = await githubRequest(`/contents/${SCORE_PATH}?ref=${encodeURIComponent(BRANCH)}`);
    const text = Buffer.from(file.content || '', 'base64').toString('utf8');
    const board = JSON.parse(text);
    return { board, sha: file.sha };
  } catch (err) {
    if (err.status === 404) return { board: defaultBoard(), sha: null };
    throw err;
  }
}

async function writeBoard(board, sha) {
  const body = {
    message: `Update 小宇哥漁場 leaderboard: ${board.highScore.name} ${board.highScore.score}`,
    content: Buffer.from(JSON.stringify(board, null, 2) + '\n', 'utf8').toString('base64'),
    branch: BRANCH
  };
  if (sha) body.sha = sha;
  await githubRequest(`/contents/${SCORE_PATH}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { board, sha } = await readBoard();

    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, ...board });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const name = cleanName(body.name);
    const score = Number(body.score);

    if (!name) return res.status(400).json({ ok: false, error: '請輸入姓名' });
    if (!Number.isInteger(score) || score < 0 || score > 100000) {
      return res.status(400).json({ ok: false, error: '分數格式不正確' });
    }

    const now = new Date().toISOString();
    const entry = { name, score, date: now.slice(0, 10) };
    const oldHigh = Number(board.highScore?.score || 0);

    const top10 = Array.isArray(board.top10) ? board.top10.slice() : [];
    top10.push(entry);
    top10.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    board.top10 = top10.slice(0, 10);

    let newHigh = false;
    if (score > oldHigh) {
      board.highScore = entry;
      newHigh = true;
    }

    if (newHigh || board.top10.some(x => x.name === name && Number(x.score) === score)) {
      await writeBoard(board, sha);
    }

    return res.status(200).json({ ok: true, newHigh, ...board });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: '排行榜暫時無法更新' });
  }
}
