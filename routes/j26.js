// 2026 정시 상담 (K:컨설팅 → 2026 정시)
// 계산 자료(학교별 엑셀 수식·상수)는 GitHub에 두지 않고 서버의 DATA_DIR/j26.json 에만 둔다.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { get, post, forbidden, bad } from '../lib/router.js';
import { one, run, J, DATA_DIR } from '../lib/db.js';
import { canSeeCutoff } from '../lib/util.js';

const FILE = path.join(DATA_DIR, 'j26.json');
const CUT_KEYS = ['cut', 'cut_low', 'cut_note', 'cut_busan', 'cut_assoc', 'cut_other'];
let cache = null; // { mtime, full, see:{json,gz}, nosee:{json,gz} }

export function j26Data() {
  let st; try { st = fs.statSync(FILE); } catch { return null; }
  if (!cache || cache.mtime !== st.mtimeMs) {
    const full = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const pack = d => { const json = JSON.stringify(d); return { json, gz: zlib.gzipSync(json) }; };
    const nosee = { ...full, programs: full.programs.map(p => { const q = { ...p }; for (const k of CUT_KEYS) delete q[k]; return q; }) };
    cache = { mtime: st.mtimeMs, full, see: pack(full), nosee: pack(nosee) };
  }
  return cache;
}

// 계산 자료 (커트라인은 원장·부원장에게만)
get('/admin/j26/data.json', 'staff', ctx => {
  const c = j26Data(); if (!c) return ctx.json({ error: '2026 정시 자료가 아직 없어요' }, 404);
  const v = canSeeCutoff(ctx.user) ? c.see : c.nosee;
  const gz = /\bgzip\b/.test(ctx.req?.headers?.['accept-encoding'] || '');
  ctx.raw(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-cache', ...(gz ? { 'Content-Encoding': 'gzip' } : {}) }, gz ? v.gz : v.json);
});

// 자료 올리기 (원장·부원장)
post('/admin/j26/data', 'staff', ctx => {
  if (!canSeeCutoff(ctx.user)) forbidden('원장·부원장만 올릴 수 있어요.');
  const d = ctx.body?.data;
  if (!d || d.version !== 1 || !Array.isArray(d.programs) || !d.sheets || !d.consts || !d.vs) bad('2026 정시 계산 자료(j26.json)가 아니에요.');
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(d)); fs.renameSync(FILE + '.tmp', FILE);
  cache = null;
  ctx.json({ ok: true, programs: d.programs.length });
});

// 학생별 입력값 저장
post('/admin/j26/score', 'staff', ctx => {
  const sid = Number(ctx.body?.s); if (!sid) bad('학생을 먼저 골라 주세요.');
  const st = one("SELECT id FROM users WHERE id=? AND role='student'", sid); if (!st) bad('학생을 찾을 수 없어요.');
  const clean = o => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => /^[A-Z]{1,3}$/.test(k) && (typeof v === 'number' || (typeof v === 'string' && v.length <= 20))));
  const inp = clean(ctx.body.inp);
  const rec = Object.fromEntries(Object.entries(ctx.body.rec || {}).slice(0, 400).map(([k, v]) => [String(k).slice(0, 60), clean(v)]).filter(([, v]) => Object.keys(v).length));
  run(`INSERT INTO j26_scores(student_id,data,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(student_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`, sid, JSON.stringify({ inp, rec }));
  ctx.json({ ok: true });
});
export const j26Score = sid => (sid ? J(one('SELECT data FROM j26_scores WHERE student_id=?', sid)?.data, null) : null);
