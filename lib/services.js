import { one, all, run, J } from './db.js';
import { today, addDays, weekday, isStaff } from './util.js';

// ---------- 알림 ----------
export const NOTIF_TYPES = {
  signup: ['가입 요청', '새 학생·학부모가 가입하면', 'staff'],
  link: ['학부모 연결', '연결 요청·승인·거절', 'all'],
  comment: ['코치 코멘트', '일지·영상에 코멘트가 달리면', 'member'],
  attendance: ['출결', '자녀의 결석·지각·공결이 기록되면', 'parent'],
  video: ['영상 분석', '학생이 영상을 올리면 / 강사가 확인하면', 'all'],
  event: ['일정', '실기 테스트·주요 일정이 등록되면', 'all'],
};
export function notify(userIds, type, title, body = '', link = '') {
  const ids = [...new Set([].concat(userIds).filter(Boolean))];
  for (const id of ids) {
    const pref = one('SELECT in_app FROM notification_prefs WHERE user_id=? AND type=?', id, type);
    if (pref && !pref.in_app) continue;
    run('INSERT INTO notifications(user_id,type,title,body,link) VALUES(?,?,?,?,?)', id, type, title, body, link);
  }
}
export const staffIds = (branchId = null) => all(`SELECT id FROM users WHERE role IN ('owner','vice','coach') AND status='approved'${branchId ? ' AND (branch_id IS NULL OR branch_id=?)' : ''}`, ...(branchId ? [branchId] : [])).map(r => r.id);
export const parentIdsOf = sid => all(`SELECT parent_id id FROM parent_links WHERE student_id=? AND status='approved'`, sid).map(r => r.id);

// ---------- 접근 권한: 학생 데이터 ----------
export function canViewStudent(u, studentId) {
  if (!u) return false;
  if (isStaff(u)) return true;
  if (u.role === 'student') return u.id === Number(studentId);
  if (u.role === 'parent') return !!one(`SELECT 1 FROM parent_links WHERE parent_id=? AND student_id=? AND status='approved'`, u.id, studentId);
  return false;
}

// ---------- 반 · 수업 일정 ----------
export function classDays(c) { return (c.days || '').split(',').filter(Boolean).map(Number); }
export function ensureSessions(from, to) {
  const classes = all('SELECT * FROM classes WHERE active=1');
  for (const c of classes) {
    const days = classDays(c);
    if (!days.length) continue;
    let d = from < c.start_date ? c.start_date : from;
    const end = c.end_date && c.end_date < to ? c.end_date : to;
    while (d <= end) {
      if (days.includes(weekday(d))) run(`INSERT OR IGNORE INTO class_sessions(class_id,date,kind) VALUES(?,?,'regular')`, c.id, d);
      d = addDays(d, 1);
    }
  }
}
// 요일/기간 변경 시: 오늘 이후 정규 수업 중 출결 기록이 없는 것은 지우고 다시 만든다
export function regenerateFuture(classId) {
  const t = today();
  run(`DELETE FROM class_sessions WHERE class_id=? AND kind='regular' AND date>=? AND id NOT IN (SELECT session_id FROM attendance)`, classId, t);
  ensureSessions(t, addDays(t, 21));
}
export function sessionsOn(date, coachId = null) {
  ensureSessions(date, date);
  return all(`SELECT s.*, c.name class_name, c.start_time, c.end_time, c.branch_id,
      (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id=c.id) n_students,
      (SELECT COUNT(*) FROM attendance a WHERE a.session_id=s.id) n_checked
    FROM class_sessions s JOIN classes c ON c.id=s.class_id
    WHERE s.date=? AND c.active=1 ${coachId ? 'AND c.id IN (SELECT class_id FROM class_coaches WHERE user_id=?)' : ''}
    ORDER BY c.start_time, c.name`, date, ...(coachId ? [coachId] : []));
}

// ---------- 출석률 ----------
// 출석률 = (출석+지각) ÷ (체크된 수업 − 휴강) — 체크 안 된 수업은 제외
export function rate(p, l, total) { return total > 0 ? Math.round(((p + l) / total) * 1000) / 10 : null; }

// ---------- K 열쇠 ----------
export function keysForMonth(ym, branchId = null) {
  const rows = all(`
    WITH d AS (
      SELECT student_id, date, 'log' k FROM logs WHERE substr(date,1,7)=?
      UNION SELECT a.student_id, s.date, 'att' FROM attendance a JOIN class_sessions s ON s.id=a.session_id
        WHERE substr(s.date,1,7)=? AND a.status IN ('present','late') AND s.canceled=0
    )
    SELECT u.id, u.name, u.branch_id, b.name branch,
      COUNT(DISTINCT CASE WHEN d.k='log' THEN d.date END) logs,
      COUNT(DISTINCT CASE WHEN d.k='att' THEN d.date END) att
    FROM d JOIN users u ON u.id=d.student_id LEFT JOIN branches b ON b.id=u.branch_id
    WHERE u.role='student' AND u.status='approved' ${branchId ? 'AND u.branch_id=?' : ''}
    GROUP BY u.id`, ym, ym, ...(branchId ? [branchId] : []));
  for (const r of rows) r.keys = r.logs + r.att;
  rows.sort((a, b) => b.keys - a.keys || a.name.localeCompare(b.name, 'ko'));
  let rank = 0, prev = null;
  rows.forEach((r, i) => { if (r.keys !== prev) { rank = i + 1; prev = r.keys; } r.rank = rank; });
  return rows;
}

// ---------- 판정 (기준값) ----------
// 학생(성별·학년)에 맞는 발행 기준값을 합쳐서 돌려준다: 구체적인 범위가 우선, 빈 지표는 '전체' 기준으로 채움
export function benchmarksFor(exerciseId, gender, grade, { setId = null } = {}) {
  if (setId) { const s = one('SELECT * FROM benchmark_sets WHERE id=?', setId); return s ? { vals: J(s.vals), used: [s] } : { vals: {}, used: [] }; }
  const sets = all(`SELECT * FROM benchmark_sets WHERE exercise_id=? AND status='published' ORDER BY version DESC`, exerciseId);
  const score = s => (s.gender !== 'all' ? 2 : 0) + (s.grade !== 'all' ? 1 : 0);
  const fits = sets.filter(s => (s.gender === 'all' || s.gender === gender) && (s.grade === 'all' || s.grade === grade));
  fits.sort((a, b) => score(b) - score(a) || b.version - a.version);
  const vals = {}; const used = [];
  for (const s of fits) {
    let usedThis = false;
    for (const [k, v] of Object.entries(J(s.vals))) {
      if (vals[k] || v == null || (v.min == null && v.max == null)) continue;
      vals[k] = { ...v, from: s.version }; usedThis = true;
    }
    if (usedThis) used.push(s);
  }
  return { vals, used };
}
export function judge(value, b) {
  if (value == null || !b || (b.min == null && b.max == null)) return null;
  const tol = Number(b.tol) || 0;
  if (b.min != null && value < b.min) return value >= b.min - tol ? { level: 'near', diff: b.min - value } : { level: 'low', diff: b.min - value };
  if (b.max != null && value > b.max) return value <= b.max + tol ? { level: 'near', diff: value - b.max } : { level: 'high', diff: value - b.max };
  return { level: 'ok', diff: 0 };
}
export const LEVEL_LABEL = { low: '낮음', ok: '적정', near: '적정', high: '높음' };
export function rangeText(b, unit) {
  if (!b) return '';
  if (b.min != null && b.max != null) return `${b.min}~${b.max}${unit}`;
  if (b.min != null) return `${b.min}${unit} 이상`;
  return `${b.max}${unit} 이하`;
}
export function feedbackText(tpl, metric, value, b, j) {
  if (!tpl || !j) return '';
  const t = tpl[j.level] || (j.level === 'near' ? tpl.ok : '') || '';
  const r2 = n => Math.round(n * 10) / 10;
  return t.replaceAll('{지표}', metric.name)
    .replaceAll('{측정값}', `${r2(value)}${metric.unit}`)
    .replaceAll('{기준}', rangeText(b, metric.unit))
    .replaceAll('{목표}', b.target != null ? `${b.target}${metric.unit}` : '—')
    .replaceAll('{차이}', `${r2(Math.abs(j.diff))}${metric.unit}`)
    .replaceAll('{단위}', metric.unit);
}
export const DEFAULT_TEMPLATES = {
  low: '{지표} {측정값} — 기준({기준})보다 {차이} 부족합니다. 조금만 더 힘내요!',
  ok: '{지표} {측정값} — 기준 범위({기준}) 안입니다. 좋아요!',
  near: '{지표} {측정값} — 기준({기준})에 거의 가깝습니다 (차이 {차이}, 허용 오차 안).',
  high: '{지표} {측정값} — 기준({기준})보다 {차이} 높습니다.',
};

export function studentClasses(sid) {
  return all('SELECT c.* FROM classes c JOIN class_students cs ON cs.class_id=c.id WHERE cs.user_id=? ORDER BY c.name', sid);
}
export function branches() { return all('SELECT * FROM branches ORDER BY sort, id'); }
