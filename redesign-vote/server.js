import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './votes.db';
const PUBLIC_DIR = new URL('./public', import.meta.url).pathname;

const SLUGS = new Set([
  'terminal', 'broadsheet', 'neon-wire', 'wire-feed', 'magazine',
  'brutalist', 'swiss', 'teletext', 'ticker', 'zine',
]);

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS votes (
    voter      TEXT NOT NULL,
    slug       TEXT NOT NULL,
    value      INTEGER NOT NULL CHECK (value IN (1, -1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (voter, slug)
  )
`);

const upsertVote = db.prepare(`
  INSERT INTO votes (voter, slug, value, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT (voter, slug) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);
const deleteVote = db.prepare('DELETE FROM votes WHERE voter = ? AND slug = ?');
const countsAll = db.prepare(`
  SELECT slug,
         SUM(CASE WHEN value = 1  THEN 1 ELSE 0 END) AS likes,
         SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END) AS dislikes
  FROM votes GROUP BY slug
`);
const votesByVoter = db.prepare('SELECT slug, value FROM votes WHERE voter = ?');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function aggregated() {
  const out = {};
  for (const slug of SLUGS) out[slug] = { likes: 0, dislikes: 0 };
  for (const row of countsAll.all()) {
    out[row.slug] = { likes: Number(row.likes), dislikes: Number(row.dislikes) };
  }
  return out;
}

async function readBody(req, limit = 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/votes' && req.method === 'GET') {
    const voter = url.searchParams.get('voter');
    const mine = {};
    if (voter && /^[a-z0-9-]{8,64}$/i.test(voter)) {
      for (const row of votesByVoter.all(voter)) mine[row.slug] = Number(row.value);
    }
    return json(res, 200, { counts: aggregated(), mine });
  }

  if (url.pathname === '/api/vote' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, { error: 'bad body' });
    }
    const { slug, value, voter } = body || {};
    if (!SLUGS.has(slug)) return json(res, 400, { error: 'unknown slug' });
    if (![1, -1, 0].includes(value)) return json(res, 400, { error: 'bad value' });
    if (typeof voter !== 'string' || !/^[a-z0-9-]{8,64}$/i.test(voter)) {
      return json(res, 400, { error: 'bad voter' });
    }
    if (value === 0) deleteVote.run(voter, slug);
    else upsertVote.run(voter, slug, value, new Date().toISOString());
    return json(res, 200, { counts: aggregated() });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, 405, { error: 'method not allowed' });
  }

  let filePath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (filePath.endsWith('/')) filePath += 'index.html';
  const full = join(PUBLIC_DIR, filePath);
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  try {
    const data = await readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[extname(full)] || 'application/octet-stream',
      'Cache-Control': full.includes('/static/') ? 'public, max-age=86400' : 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
});

server.listen(PORT, () => console.log(`redesign-vote on :${PORT}, db at ${DB_PATH}`));
