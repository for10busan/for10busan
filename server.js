// 포텐체대입시 부산교육원 앱 서버 (외부 라이브러리 없이 Node 22 만으로 동작)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionUser, COOKIE, csrfFor } from './lib/auth.js';
import { match, allowed, HttpError } from './lib/router.js';
import { layout, html, pageTitle, homeFor, icon } from './lib/html.js';
import { DATA_DIR } from './lib/db.js';
import { serveFile } from './lib/static.js';
import './routes/index.js';
import { ensureSeed } from './scripts/seed.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const MAX_FORM = 2 * 1024 * 1024;

ensureSeed();

function parseCookies(h = '') {
  const o = {};
  for (const p of h.split(/;\s*/)) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); }
  return o;
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(new HttpError(413, '요청이 너무 큽니다')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function parseForm(buf) {
  const o = {};
  for (const [k, v] of new URLSearchParams(buf.toString('utf8'))) {
    if (k.endsWith('[]')) { (o[k.slice(0, -2)] ||= []).push(v); }
    else if (k in o) { o[k] = [].concat(o[k], v); } else o[k] = v;
  }
  return o;
}

function errorPage(ctx, status, msg) {
  const body = html`${pageTitle(status === 404 ? '페이지를 찾을 수 없어요' : status === 403 ? '접근 권한이 없어요' : '문제가 생겼어요', msg)}
  <a class="btn" href="${homeFor(ctx.user)}">${icon('left')}홈으로</a>`;
  return layout(ctx, { title: '오류', body });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ctx = { req, res, url, query: Object.fromEntries(url.searchParams), params: {}, body: {} };
  try {
    // 정적 파일
    if ((req.method === 'GET' || req.method === 'HEAD') && /^\/(css|js|img|vendor)\//.test(url.pathname) || ['/manifest.webmanifest', '/sw.js', '/robots.txt'].includes(url.pathname)) {
      const f = path.join(PUBLIC, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
      if (f.startsWith(PUBLIC) && serveFile(req, res, f, { cache: url.pathname === '/sw.js' ? 'no-cache' : (url.search ? 'public, max-age=31536000, immutable' : 'public, max-age=3600') })) return;
    }
    const cookies = parseCookies(req.headers.cookie);
    ctx.token = cookies[COOKIE];
    ctx.user = sessionUser(ctx.token);
    ctx.csrf = csrfFor(ctx.token);
    if (cookies.f10f) { try { ctx.flash = JSON.parse(cookies.f10f); } catch {} res.setHeader('Set-Cookie', 'f10f=; Path=/; Max-Age=0'); }
    ctx.secure = req.headers['x-forwarded-proto'] === 'https' || url.protocol === 'https:';

    ctx.send = (body, status = 200, headers = {}) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(String(body)); };
    ctx.json = (obj, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
    ctx.redirect = (to, flash) => {
      const h = { Location: to, 'Cache-Control': 'no-store' };
      const sc = [].concat(res.getHeader('Set-Cookie') || []).filter(c => !c.startsWith('f10f='));
      if (flash) sc.push(`f10f=${encodeURIComponent(JSON.stringify(typeof flash === 'string' ? { msg: flash, type: 'ok' } : flash))}; Path=/; Max-Age=30; SameSite=Lax`);
      if (sc.length) h['Set-Cookie'] = sc;
      res.writeHead(303, h); res.end();
    };
    ctx.page = (title, body, opts = {}) => ctx.send(layout(ctx, { title, body, ...opts }));
    ctx.back = (flash, fallback = '/') => ctx.redirect(safeBack(req.headers.referer, url) || fallback, flash);

    const m = match(req.method, url.pathname);
    if (!m) throw new HttpError(404, '주소를 다시 확인해 주세요.');
    ctx.params = m.params;
    if (!allowed(m.r.guard, ctx.user)) {
      if (!ctx.user) return ctx.redirect('/login?next=' + encodeURIComponent(url.pathname + url.search));
      if (ctx.user.status !== 'approved') return ctx.redirect('/pending');
      throw new HttpError(403, '이 화면은 볼 수 없는 계정이에요.');
    }
    if (req.method === 'POST') {
      const ct = req.headers['content-type'] || '';
      if (ct.startsWith('application/x-www-form-urlencoded')) ctx.body = parseForm(await readBody(req, MAX_FORM));
      else if (ct.startsWith('application/json')) ctx.body = JSON.parse((await readBody(req, 16 * 1024 * 1024)).toString('utf8') || '{}');
      const sent = ctx.body._csrf || req.headers['x-csrf'];
      if (m.r.guard !== 'public' && sent !== ctx.csrf) throw new HttpError(403, '세션이 만료되었어요. 새로고침 후 다시 시도해 주세요.');
    }
    if (req.method === 'PUT') { const sent = req.headers['x-csrf']; if (sent !== ctx.csrf) throw new HttpError(403, 'CSRF'); }
    await m.r.handler(ctx);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (res.headersSent) return res.end();
    if ((req.headers.accept || '').includes('application/json') || req.headers['x-csrf']) return ctx.json({ error: e.message }, status);
    if (status === 400 && req.method === 'POST' && req.headers.referer) return ctx.redirect(safeBack(req.headers.referer, url) || '/', { msg: e.message, type: 'err' });
    ctx.send ? ctx.send(errorPage(ctx, status, status === 500 ? '잠시 후 다시 시도해 주세요.' : e.message), status) : (res.writeHead(status), res.end());
  }
});
function safeBack(ref, url) {
  try { const r = new URL(ref); if (r.host === url.host) return r.pathname + r.search + r.hash; } catch {}
  return null;
}

if (process.env.NODE_TEST !== '1') server.listen(PORT, () => console.log(`▶ http://localhost:${PORT}  (data: ${DATA_DIR})`));
export default server;
