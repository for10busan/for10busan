// 날짜(한국 시간)·포맷 유틸
export const TZ = 'Asia/Seoul';
const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const WEEKDAYS = WD;

export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function thisMonth() { return today().slice(0, 7); }
export function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
export function fmtDate(d) { return d.toISOString().slice(0, 10); }
export function addDays(s, n) { const d = parseDate(s); d.setUTCDate(d.getUTCDate() + n); return fmtDate(d); }
export function weekday(s) { return parseDate(s).getUTCDay(); }
export function addMonths(ym, n) { let [y, m] = ym.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; }
export function monthDays(ym) { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
export function isValidDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(parseDate(s)); }
export function isValidMonth(s) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(s || ''); }

// "11월 2일 (월)"
export function korDay(s) { if (!s) return ''; const d = parseDate(s); return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WD[d.getUTCDay()]})`; }
export function korMonth(ym) { const [y, m] = ym.split('-'); return `${y}년 ${Number(m)}월`; }
// SQLite UTC 'YYYY-MM-DD HH:MM:SS' -> "2026년 11월 1일 일 오후 2:07"
export function korDateTime(utc) {
  if (!utc) return '';
  const d = new Date(utc.includes('T') ? utc : utc.replace(' ', 'T') + 'Z');
  const p = Object.fromEntries(new Intl.DateTimeFormat('ko-KR', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}년 ${p.month}월 ${p.day}일 ${p.weekday} ${p.dayPeriod} ${p.hour}:${p.minute}`;
}
export function utcToKstDate(utc) {
  const d = new Date(utc.includes('T') ? utc : utc.replace(' ', 'T') + 'Z');
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function num(v) { if (v === '' || v == null) return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; }
export function int(v, d = null) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }
export function fmtNum(n, digits = 2) { if (n == null || !Number.isFinite(Number(n))) return '—'; return String(Math.round(Number(n) * 10 ** digits) / 10 ** digits); }
export function maskName(name = '') { if (name.length <= 1) return name; if (name.length === 2) return name[0] + '*'; return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1]; }
export const ROLE_LABEL = { owner: '원장', vice: '부원장', coach: '강사', student: '학생', parent: '학부모' };
export const isStaff = u => u && ['owner', 'vice', 'coach'].includes(u.role);
export const GRADES = ['고1', '고2', '고3', 'N수'];
export const ATT_LABEL = { present: '출석', late: '지각', absent: '결석', excused: '공결' };
