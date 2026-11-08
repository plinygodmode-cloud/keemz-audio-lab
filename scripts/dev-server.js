#!/usr/bin/env node
'use strict';

/*
  Local development server — no dependencies, no Vercel CLI login.

  It mirrors the deployed behaviour closely enough to develop against:
    · static files from the project root with `cleanUrls` resolution
    · /api/* routed to the same serverless handlers Vercel runs
    · JSON bodies parsed, query strings available as req.query
    · .env.local then .env loaded into process.env

  Usage:
    npm run dev            # http://localhost:3000
    PORT=4000 npm run dev

  This file is excluded from production deployments via .vercelignore.
*/

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

/* ------------------------------- env files ------------------------------- */
function loadEnvFile(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return;
  const contents = fs.readFileSync(full, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

/* --------------------------------- mime ---------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.zip': 'application/zip',
  '.map': 'application/json; charset=utf-8'
};

/* ------------------------------- utilities ------------------------------- */
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
};

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function resolveStatic(pathname) {
  const safePath = decodeURIComponent(pathname.split('?')[0]);
  if (safePath.includes('\0')) return null;
  const relative = safePath.replace(/^\/+/, '');
  const target = path.resolve(ROOT, relative);
  if (!target.startsWith(ROOT)) return null;

  const candidates = [];
  if (!relative) candidates.push(path.join(ROOT, 'index.html'));
  else {
    candidates.push(target);
    if (!path.extname(target)) {
      candidates.push(`${target}.html`);
      candidates.push(path.join(target, 'index.html'));
    }
  }
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

async function handleApi(req, res, pathname) {
  const name = pathname.replace(/^\/api\//, '').replace(/\.js$/, '');
  if (!/^[a-z0-9-]+$/i.test(name)) return send(res, 404, JSON.stringify({ error: 'Not found' }), { 'Content-Type': 'application/json' });

  const modulePath = path.join(ROOT, 'api', `${name}.js`);
  if (!fs.existsSync(modulePath)) {
    return send(res, 404, JSON.stringify({ error: 'API route not found' }), { 'Content-Type': 'application/json' });
  }

  let handler;
  try {
    handler = require(modulePath);
  } catch (error) {
    console.error('[dev] failed to load handler', name, error);
    return send(res, 500, JSON.stringify({ error: 'Handler failed to load' }), { 'Content-Type': 'application/json' });
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const query = Object.fromEntries(url.searchParams.entries());

  let raw = '';
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    try {
      raw = await readBody(req);
    } catch (error) {
      return send(res, 413, JSON.stringify({ error: 'Payload too large' }), { 'Content-Type': 'application/json' });
    }
  }

  let body;
  if (raw) {
    const type = String(req.headers['content-type'] || '');
    if (type.includes('application/json') || type.includes('+json')) {
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, JSON.stringify({ error: 'Invalid JSON' }), { 'Content-Type': 'application/json' });
      }
    } else {
      body = raw;
    }
  }

  const vReq = Object.assign(req, { query, body });
  const vRes = {
    statusCode: 200,
    headers: {},
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    getHeader(key) {
      return this.headers[key];
    },
    json(payload) {
      this.headers['Content-Type'] = 'application/json; charset=utf-8';
      this.finish(JSON.stringify(payload));
      return this;
    },
    send(payload) {
      this.finish(String(payload));
      return this;
    },
    end(payload) {
      this.finish(payload === undefined ? '' : String(payload));
      return this;
    },
    finish(payload) {
      if (this.ended) return;
      this.ended = true;
      res.writeHead(this.statusCode, { 'Cache-Control': 'no-store', ...this.headers });
      res.end(req.method === 'HEAD' ? undefined : payload);
    }
  };

  try {
    await handler(vReq, vRes);
    if (!vRes.ended) vRes.finish('');
  } catch (error) {
    console.error('[dev] handler error', name, error);
    if (!res.headersSent) send(res, 500, JSON.stringify({ error: 'Internal error' }), { 'Content-Type': 'application/json' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);

  const file = resolveStatic(pathname);
  if (!file) {
    const custom404 = path.join(ROOT, '404.html');
    const body = fs.existsSync(custom404) ? fs.readFileSync(custom404) : 'Not found';
    return send(res, 404, body, { 'Content-Type': 'text/html; charset=utf-8' });
  }

  const ext = path.extname(file).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  if (ext === '.woff2' || ext === '.woff' || pathname.startsWith('/assets/vendor/')) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  } else {
    headers['Cache-Control'] = 'no-cache';
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  KEEMZ AUDIO LAB — local dev server`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  API routes: ${fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js')).join(', ')}`);
  console.log(`  Store configured: ${process.env.PRODUCTS_JSON ? 'PRODUCTS_JSON present' : 'no PRODUCTS_JSON (store shows the empty state)'}\n`);
});
