// 입시 계산 공통 로직: 내신 환산, 실기 배점, 총점·여유·감, 수능 등급컷 변환
import { one, all, J } from './db.js';

export const REGION_GROUPS = [
  ['서울', ['서울']], ['수도권', ['경기', '인천']], ['강원/제주', ['강원', '제주']], ['대전/충청', ['대전', '세종', '충북', '충남']],
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

// 학교 → [지역, 시] (지역이 비어 있는 대학을 채울 때 씀)
export const SCHOOL_REGION = {
  '고려대학교': ['서울', ''], '연세대학교': ['서울', ''], '서울대학교': ['서울', ''], '동국대학교': ['서울', ''], '한국체육대학교': ['서울', ''], '국민대학교': ['서울', ''],
  '성신여자대학교': ['서울', ''], '삼육대학교': ['서울', ''], '중앙대학교': ['서울', ''], '숙명여자대학교': ['서울', ''], '이화여자대학교': ['서울', ''], '건국대학교': ['서울', ''],
  '서울시립대학교': ['서울', ''], '서울과학기술대학교': ['서울', ''], '세종대학교': ['서울', ''], '서울여자대학교': ['서울', ''], '동덕여자대학교': ['서울', ''], '덕성여자대학교': ['서울', ''],
  '경희대학교': ['서울', ''], '광운대학교': ['서울', ''], '숭실대학교': ['서울', ''], '서경대학교': ['서울', ''], '한양대학교': ['경기', '안산'], '성균관대학교': ['경기', '수원'],
  '한신대학교': ['경기', '오산'], '성결대학교': ['경기', '안양'], '경기대학교': ['경기', '수원'], '용인대학교': ['경기', '용인'], '수원대학교': ['경기', '화성'], '단국대학교': ['경기', '용인'],
  '가천대학교': ['경기', '성남'], '명지대학교': ['경기', '용인'], '강남대학교': ['경기', '용인'], '인천대학교': ['인천', ''], '인하대학교': ['인천', ''],
  '강원대학교': ['강원', '춘천'], '강릉원주대학교': ['강원', '강릉'], '가톨릭관동대학교': ['강원', '강릉'], '관동대학교': ['강원', '강릉'], '상지대학교': ['강원', '원주'], '제주대학교': ['제주', ''],
  '한국교원대학교': ['충북', '청주'], '충북대학교': ['충북', '청주'], '서원대학교': ['충북', '청주'], '한국교통대학교': ['충북', '충주'], '충남대학교': ['대전', ''], '목원대학교': ['대전', ''],
  '대전대학교': ['대전', ''], '한남대학교': ['대전', ''], '호서대학교': ['충남', '아산'], '순천향대학교': ['충남', '아산'], '선문대학교': ['충남', '아산'], '백석대학교': ['충남', '천안'],
  '상명대학교': ['충남', '천안'], '나사렛대학교': ['충남', '천안'], '남서울대학교': ['충남', '천안'], '공주대학교': ['충남', '공주'], '한서대학교': ['충남', '서산'], '중부대학교': ['충남', '금산'],
  '경북대학교': ['대구', ''], '계명대학교': ['대구', ''], '대구가톨릭대학교': ['경북', '경산'], '영남대학교': ['경북', '경산'], '대구한의대학교': ['경북', '경산'], '대구대학교': ['경북', '경산'],
  '경일대학교': ['경북', '경산'], '국립경국대학교': ['경북', '안동'], '위덕대학교': ['경북', '경주'], '김천대학교': ['경북', '김천'],
  '부산대학교': ['부산', ''], '부경대학교': ['부산', ''], '동의대학교': ['부산', ''], '동서대학교': ['부산', ''], '부산외국어대학교': ['부산', ''], '한국해양대학교': ['부산', ''],
  '동아대학교': ['부산', ''], '신라대학교': ['부산', ''], '경성대학교': ['부산', ''], '동명대학교': ['부산', ''], '울산대학교': ['울산', ''], '경상대학교': ['경남', '진주'],
  '경상국립대학교': ['경남', '진주'], '경남대학교': ['경남', '창원'], '창원대학교': ['경남', '창원'], '인제대학교': ['경남', '김해'], '영산대학교': ['경남', '양산'],
  '원광대학교': ['전북', '익산'], '군산대학교': ['전북', '군산'], '전북대학교': ['전북', '전주'], '전주대학교': ['전북', '전주'], '우석대학교': ['전북', '완주'],
  '전남대학교': ['광주', ''], '조선대학교': ['광주', ''], '광주대학교': ['광주', ''], '호남대학교': ['광주', ''], '동신대학교': ['전남', '나주'], '순천대학교': ['전남', '순천'], '목포대학교': ['전남', '목포'],
};
// 같은 대학이라도 캠퍼스가 다른 학과
export function schoolRegion(name, dept = '') {
  const n = String(name || '').replace(/\(.*?\)/g, '').trim(); const d = String(dept || '');
  if (n === '단국대학교' && /생활체육|스포츠경영|운동처방|천안/.test(d)) return ['충남', '천안'];
  if (n === '건국대학교' && /스포츠건강|글로컬/.test(d)) return ['충북', '충주'];
  if (n === '강원대학교' && /강릉/.test(d)) return ['강원', '강릉'];
  if (n === '경북대학교' && /체육학부|상주/.test(d)) return ['경북', '상주'];
  return regionOverride(n, d) || SCHOOL_REGION[n] || null;
}
// 이미 지역이 들어 있어도 바로잡아야 하는 학과 (캠퍼스가 다른 곳)
export function regionOverride(name, dept = '') {
  const n = String(name || '').replace(/\(.*?\)/g, '').trim(); const d = String(dept || '');
  if (n === '동국대학교' && /스포츠과학|스포츠의학|WISE|경주/.test(d)) return ['경북', '경주'];
  if (n === '상명대학교' && /스포츠건강|서울/.test(d)) return ['서울', ''];
  return null;
}
// 국립·공립 대학
export const NATIONAL = new Set(['서울대학교', '부산대학교', '부경대학교', '한국해양대학교', '경상대학교', '경상국립대학교', '창원대학교', '경북대학교', '국립경국대학교', '충남대학교', '충북대학교',
  '공주대학교', '한국교원대학교', '한국교통대학교', '강원대학교', '강릉원주대학교', '제주대학교', '전남대학교', '전북대학교', '군산대학교', '순천대학교', '목포대학교', '인천대학교',
  '서울과학기술대학교', '한국체육대학교', '서울시립대학교']);
export const PUBLIC = new Set();
// 교직 이수가 되는 학과 (모집요강 기준)
const CERT = new Set(['경기대학교 체육학과', '경성대학교 스포츠건강학과', '경희대학교 체육학과', '계명대학교 체육학과', '국민대학교 스포츠건강재활학과', '국민대학교 스포츠교육학과',
  '국민대학교 스포츠산업레저학과', '군산대학교 체육학부', '대구대학교 체육학과', '동덕여자대학교 체육학전공', '동아대학교 체육학과', '동의대학교 체육학과', '성균관대학교 스포츠과학과',
  '세종대학교 체육학과', '신라대학교 체육학부', '영남대학교 체육학과', '이화여자대학교 체육과학부', '한양대학교 스포츠과학부', '한양대학교 스포츠산업과학부']);
export function teacherCert(name, dept = '') {
  const n = String(name || '').replace(/\(.*?\)/g, '').trim(); const d = String(dept || '').replace(/\(.*?\)|\s/g, '');
  if (/체육교육|특수체육교육/.test(d)) return true;
  return [...CERT].some(k => { const [a, b] = k.split(' '); return a === n && d.startsWith(b); });
}
export function foundingOf(name) {
  const n = String(name || '').replace(/\(.*?\)/g, '').trim();
  return NATIONAL.has(n) ? '국립' : PUBLIC.has(n) ? '공립' : '사립';
}

// ---- 실기 종목 정리 ----
// 같은 종목을 하나로 합침 (왼쪽 이름 → 오른쪽 이름), 이름만 바꿈, 아예 뺄 종목
export const EX_MERGE = {
  '지그재그 달리기(2회 왕복)': '지그재그 달리기', '왕복달리기': '10m 왕복달리기', '앉아윗몸앞으로굽히기': '좌전굴', '반복옆뛰기': '사이드스텝',
  '배구(월패스)': '배구', '60m Z런': 'Z런', '제자리높이뛰기': '서전트 점프', '공던지기(핸드볼공)': '핸드볼 던지기', '10m 반복달리기': '10m 왕복달리기', 'Z자 달리기': 'Z런',
  '장좌체전굴': '체전굴', '20m 왕복오래달리기': '셔틀런', '에르고미터 1000m': '에르고미터',
};
export const EX_DROP = ['600m 달리기'];
const exKey = s => String(s || '').replace(/\s/g, '').toLowerCase();
const MERGE_K = Object.fromEntries(Object.entries(EX_MERGE).map(([a, b]) => [exKey(a), b]));
export const canonicalExName = n => MERGE_K[exKey(n)] || n;
export const isDroppedEx = n => EX_DROP.some(d => exKey(d) === exKey(n));
// 종목 분류
export function exCategory(name) {
  const n = String(name || '');
  if (/매달리기|구르기/.test(n)) return '기타';
  if (/멀리뛰기|서전트|높이뛰기|배면/.test(n)) return '도약';
  if (/농구|배구|핸드볼|골밑|레이업/.test(n)) return '구기';
  if (/달리기|런|왕복|셔틀|지그재그|중량메고/i.test(n)) return '런';
  return '기타';
}
export const EX_CATS = ['도약', '런', '구기', '기타'];
