// 입시 계산 공통 로직: 내신 환산, 실기 배점, 총점·여유·감, 수능 등급컷 변환
import { one, all, J } from './db.js';

export const REGION_GROUPS = [
  ['수도권', ['서울', '경기', '인천']], ['강원/제주', ['강원', '제주']], ['대전/충청', ['대전', '세종', '충북', '충남']],
  ['대구/경북', ['대구', '경북']], ['부산/경남', ['부산', '울산', '경남']], ['광주/전라', ['광주', '전북', '전남']],
];
export function regionGroup(region) {
  const r = (region || '').trim(); if (!r) return '기타';
  for (const [g, list] of REGION_GROUPS) if (list.some(x => r.startsWith(x))) return g;
  return '기타';
}
export const uniLabel = u => `${u.name}${u.dept ? ' ' + u.dept : ''}`;

// 내신 환산표: { "5": [[등급, 점수]...], "9": [...] } — 사이 값은 직선 보간
export function schoolScore(u, grade, system) {
  const t = J(u.grade_table)[String(system)];
  if (!t || !t.length || grade == null) return null;
  const rows = [...t].sort((a, b) => a[0] - b[0]);
  if (grade <= rows[0][0]) return rows[0][1];
  for (let i = 1; i < rows.length; i++) if (grade <= rows[i][0]) { const [g0, s0] = rows[i - 1], [g1, s1] = rows[i]; return s0 + ((s1 - s0) * (grade - g0)) / (g1 - g0); }
  return rows[rows.length - 1][1];
}
// 실기 배점표: { [종목ID]: { M: [[기록, 점수]...], F: [...] } }
export function practicalScore(u, exId, gender, record, hb, which = 'scoring') {
  const t = (J(u[which])[exId] || {})[gender || 'M'];
  if (!t || !t.length || record == null) return null;
  let best = 0;
  for (const [th, pts] of t) if (hb ? record >= th : record <= th) best = Math.max(best, pts);
  return best;
}
export function maxPoints(u, exId, gender) { const t = (J(u.scoring)[exId] || {})[gender || 'M']; return t && t.length ? Math.max(...t.map(r => r[1])) : null; }
export function practicalMax(u) {
  if (u.practical_max != null) return u.practical_max;
  const ids = J(u.exercises, []); let s = 0, any = false;
  for (const i of ids) { const m = maxPoints(u, i, 'M'); if (m != null) { s += m; any = true; } }
  return any ? s : null;
}
// 실기 한 급간 점수 (감 계산용): 직접 넣은 값이 없으면 배점표에서 이웃한 점수 차이의 중앙값
export function stepPoints(u) {
  if (u.step_points) return u.step_points;
  const diffs = [];
  for (const g of Object.values(J(u.scoring))) for (const t of Object.values(g || {})) {
    const pts = [...new Set((t || []).map(r => r[1]))].sort((a, b) => b - a);
    for (let i = 1; i < pts.length; i++) diffs.push(pts[i - 1] - pts[i]);
  }
  if (!diffs.length) return null;
  diffs.sort((a, b) => a - b); return diffs[Math.floor(diffs.length / 2)];
}
export function latestCutoff(uid) { return one('SELECT * FROM cutoffs WHERE university_id=? ORDER BY year DESC LIMIT 1', uid) || null; }
// 판정: 감(=여유÷급간) 2 이상 여유, 0 이상 적정, 그 아래 도전
export function verdictOf(margin, gam) {
  if (margin == null) return null;
  if (margin < 0) return ['도전', 'risk'];
  if (gam != null ? gam >= 2 : margin >= 10) return ['여유', 'safe'];
  return ['적정', 'ok'];
}
// 수능(정시) 간이 환산: 최근 모의고사의 국어·수학·탐구 백분위 평균 × 수능 만점
export function suneungScore(u, studentId) {
  if (!studentId || !u.suneung_max) return null;
  const ex = one('SELECT scores FROM mock_exams WHERE student_id=? ORDER BY date DESC, id DESC LIMIT 1', studentId);
  if (!ex) return null;
  const s = J(ex.scores); const pcts = ['국어', '수학', '탐구1', '탐구2'].map(k => s[k]?.pct).filter(v => v != null);
  if (!pcts.length) return null;
  return (pcts.reduce((a, b) => a + b, 0) / pcts.length / 100) * u.suneung_max;
}
// 한 대학(전형) 줄 계산. 정시는 내신 대신 수능 점수
export function programRow(u, { grade, system, studentId, gender = 'M', records = null }) {
  const isJ = u.admission === '정시';
  const base = isJ ? suneungScore(u, studentId) : schoolScore(u, grade, system);
  const pmaxV = practicalMax(u);
  let prac = pmaxV;
  if (records) { prac = 0; for (const i of J(u.exercises, [])) prac += practicalScore(u, i, gender, records[i], exHb(i)) || 0; }
  const total = base == null && prac == null ? null : (base || 0) + (prac || 0);
  const c = latestCutoff(u.id);
  const step = stepPoints(u);
  const m1 = c && total != null && base != null ? total - c.cutoff : null;
  const m2 = c && c.final != null && total != null && base != null ? total - c.final : null;
  return { base, pmax: pmaxV, prac, total, cut: c, m1, m2, g1: m1 != null && step ? m1 / step : null, g2: m2 != null && step ? m2 / step : null, step, verdict: verdictOf(m1, m1 != null && step ? m1 / step : null) };
}
const hbCache = new Map();
function exHb(id) { if (!hbCache.has(id)) hbCache.set(id, one('SELECT higher_better FROM exercises WHERE id=?', id)?.higher_better ?? 1); return hbCache.get(id); }

// ---------- 수능·모의고사 ----------
export const EXAMS = ['3월', '6월', '9월', '수능'];
export const EXAM_SUBJECTS = [
  ['국어', ['언매', '화작']], ['수학', ['확통', '미적', '기하']],
  ['탐구', ['생윤', '윤사', '한지', '세지', '동아', '세계', '법정', '경제', '사문', '물리1', '물리2', '화학1', '화학2', '생과1', '생과2', '지과1', '지과2']],
];
export const SUBJECT_MAX = s => (['언매', '화작', '확통', '미적', '기하'].includes(s) ? 100 : 50);
// rows: [{raw:[hi,lo], std:[hi,lo], pct:[hi,lo], grade}] — 구간 안은 비례 계산
export function convertRaw(rows, raw) {
  if (raw == null) return null;
  for (const r of rows || []) {
    const hi = r.raw?.[0], lo = r.raw?.[1] ?? hi;
    if (hi == null) continue;
    if (raw <= hi && raw >= lo) {
      const f = hi === lo ? 0 : (hi - raw) / (hi - lo);
      const lerp = v => (v?.[0] == null ? null : v[1] == null ? v[0] : Math.round((v[0] + (v[1] - v[0]) * f) * 10) / 10);
      return { std: lerp(r.std), pct: lerp(r.pct), grade: r.grade ?? null };
    }
  }
  return null;
}
export function coverage(rows, max) {
  const have = new Set();
  for (const r of rows || []) { const hi = r.raw?.[0], lo = r.raw?.[1] ?? hi; if (hi == null) continue; for (let x = Math.max(0, lo); x <= Math.min(max, hi); x++) have.add(x); }
  const missing = []; for (let x = 0; x <= max; x++) if (!have.has(x)) missing.push(x);
  return { count: have.size, missing };
}
export function rangeText(nums) { // [91,92,...,100] -> "91~100점"
  if (!nums.length) return ''; const out = []; let s = nums[0], p = nums[0];
  for (const n of nums.slice(1).concat([null])) { if (n === p + 1) { p = n; continue; } out.push(s === p ? `${s}` : `${s}~${p}`); s = p = n; }
  return out.join(', ') + '점';
}
export function englishGrade(raw) { if (raw == null) return null; return Math.min(9, Math.max(1, 10 - Math.floor(raw / 10) - (raw >= 90 ? 0 : 0))) ; }
export function historyGrade(raw) { if (raw == null) return null; const t = [40, 35, 30, 25, 20, 15, 10, 5]; for (let i = 0; i < t.length; i++) if (raw >= t[i]) return i + 1; return 9; }
export function examTable(year, exam, subject) { const r = one('SELECT rows FROM exam_tables WHERE year=? AND exam=? AND subject=?', year, exam, subject); return r ? J(r.rows, []) : []; }
export function examYears() { return all('SELECT DISTINCT year FROM exam_tables ORDER BY year').map(r => r.year); }

// 메모·변경사항 정리: '출처:' 부분은 지우고, 이어 붙은 문장은 한 줄에 하나씩(· 머리표)
export function tidyNote(s) {
  if (s == null) return s;
  const parts = [];
  for (const line of String(s).replace(/\s*출처\s*[:：][^\n]*?(?=\s\/\s|\n|$)/g, '').split(/\r?\n/)) {
    let depth = 0, cur = '';
    const push = () => { const t = cur.replace(/^[·•\-\s]+/, '').trim().replace(/[.。]\s*$/, '').trim(); if (t) parts.push(t); cur = ''; };
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '(' || ch === '[') depth++;
      if ((ch === ')' || ch === ']') && depth > 0) depth--;
      if (depth === 0 && ch === '.' && /\s/.test(line[i + 1] || '') && !/\d/.test(line[i - 1] || 'x') ) { cur += ch; push(); continue; }
      if (depth === 0 && ch === '.' && /\s/.test(line[i + 1] || '') && /[%)]/.test(line[i - 1] || '')) { cur += ch; push(); continue; }
      if (depth === 0 && line.startsWith(' / ', i)) { push(); i += 2; continue; }
      cur += ch;
    }
    push();
  }
  const kept = parts.map(p => p.replace(/\s*출처\s*[:：].*$/, '').trim()).filter(p => p && !/^출처/.test(p));
  if (!kept.length) return null;
  return kept.length === 1 ? kept[0] : kept.map(p => '· ' + p).join('\n');
}
