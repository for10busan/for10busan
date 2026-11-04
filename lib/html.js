// HTML 템플릿: html`` 은 자동 이스케이프, raw() 로 신뢰된 HTML 삽입
import { one } from './db.js';
import { ROLE_LABEL, isStaff } from './util.js';

export const APP_NAME = process.env.APP_NAME || '포텐체대입시 부산교육원';
export const APP_SHORT = process.env.APP_SHORT || 'FOR10 부산';

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(String(s ?? ''));
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Raw(out);
}

// --- 아이콘 (stroke 24) ---
const P = {
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  checks: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
  checkc: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  xc: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  right: '<polyline points="9 18 15 12 9 6"/>',
  left: '<polyline points="15 18 9 12 15 6"/>',
  down: '<polyline points="6 9 12 15 18 9"/>',
  up: '<polyline points="18 15 12 9 6 15"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  usercheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>',
  userminus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="22" y1="11" x2="16" y2="11"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  school: '<path d="M14 22v-4a2 2 0 1 0-4 0v4"/><path d="m18 10 4 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8l4-2"/><path d="M18 5v17M6 5v17"/><path d="m4 6 8-4 8 4"/><circle cx="12" cy="9" r="2"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  video: '<path d="m22 8-6 4 6 4V8z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  refresh: '<path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>',
  ruler: '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  cake: '<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1M2 21h20M7 8v3M12 8v3M17 8v3M7 4h.01M12 4h.01M17 4h.01"/>',
  film: '<rect x="2" y="2" width="20" height="20" rx="2.18"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
};
export function icon(name, cls = '') {
  return raw(`<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`);
}

// --- 네비게이션 ---
const STAFF_NAV = [
  ['', [['홈', '/admin']]],
  ['입시 컨설팅', [['K:컨설팅', '/admin/consulting'], ['학생별 지원 관리', '/admin/consulting/students'], ['대학검색', '/admin/student-predict'], ['커트라인', '/admin/predict'], ['수능·모의고사 등급컷', '/admin/exams'], ['대학 · 배점표', '/admin/universities']]],
  ['수업 · 출결', [['오늘 수업', '/coach'], ['캘린더', '/calendar'], ['반', '/admin/classes'], ['출결 통계', '/admin/stats'], ['직원 출근', '/admin/staff-attendance']]],
  ['학생 · 실기', [['학생', '/students'], ['실기 기록 입력', '/ranking/entry'], ['순위', '/ranking'], ['종목 · 기준값', '/admin/exercises'], ['이용 현황', '/admin/activity']]],
  ['회원 · 승인', [['가입 승인', '/admin/approvals'], ['학부모 연결 승인', '/admin/links'], ['회원', '/admin/members']]],
];
const STUDENT_NAV = [
  ['', [['홈', '/me']]],
  ['내 훈련', [['일지', '/me/logs'], ['영상', '/me/videos'], ['기록', '/me/records']]],
  ['입시', [['목표 대학', '/me/targets'], ['합격 예측', '/me/predict'], ['모의고사', '/me/exams']]],
  ['학원', [['순위', '/ranking'], ['캘린더', '/calendar']]],
];
const PARENT_NAV = [['', [['홈', '/parent'], ['순위', '/ranking'], ['캘린더', '/calendar']]]];
export function homeFor(u) {
  if (!u) return '/login';
  if (u.status !== 'approved') return '/pending';
  if (isStaff(u)) return '/admin';
  if (u.role === 'student') return '/me';
  return '/parent';
}

function navFor(u) { return isStaff(u) ? STAFF_NAV : u.role === 'student' ? STUDENT_NAV : PARENT_NAV; }

export function layout(ctx, { title, body, active, bare = false }) {
  const u = ctx.user;
  const path = ctx.url.pathname;
  let header = '';
  if (u && u.status === 'approved' && !bare) {
    const unread = one('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read_at IS NULL', u.id).c;
    const nav = navFor(u);
    const flat = nav.flatMap(([, items]) => items);
    // 가장 길게 일치하는 메뉴를 활성으로
    let act = active || '';
    if (!act) { let best = 0; for (const [, h] of flat) { if ((path === h || path.startsWith(h + '/')) && h.length > best) { best = h.length; act = h; } } }
    header = html`
<input type="checkbox" id="menu-t" class="menu-t" hidden>
<header class="top">
  <div class="top-in">
    <div class="top-l">
      <label for="menu-t" class="ibtn menu-btn" aria-label="메뉴 열기" role="button" tabindex="0"><span class="burger"><i></i><i></i><i></i></span></label>
      <a class="brand" href="${homeFor(u)}" aria-label="${APP_NAME} 홈"><img src="/img/logo-h-white.png" alt="FOR10 SPORTS ACADEMY" height="24"></a>
    </div>
    <div class="top-r">
      <span class="who">${u.name} · ${ROLE_LABEL[u.role]}</span>
      <a class="ibtn" href="/notifications" aria-label="알림 ${unread}개 안 읽음">${icon('bell')}${unread ? html`<span class="badge">${unread > 99 ? '99+' : unread}</span>` : ''}</a>
      <a class="ibtn" href="/settings" aria-label="설정">${icon('gear')}</a>
    </div>
  </div>
</header>
<label for="menu-t" class="drawer-bg" aria-hidden="true"></label>
<nav class="drawer" aria-label="주 메뉴">
  <div class="drawer-hd"><div><b>${u.name}</b><span>${ROLE_LABEL[u.role]} · ${APP_SHORT}</span></div><label for="menu-t" class="ibtn" aria-label="메뉴 닫기">✕</label></div>
  ${nav.map(([cat, items]) => html`<div class="drawer-sec">${cat ? html`<h4>${cat}</h4>` : ''}${items.map(([l, h]) => html`<a href="${h}" class="${h === act ? 'on' : ''}">${l}</a>`)}</div>`)}
  <form method="post" action="/logout" class="drawer-ft">${csrfField(ctx)}<button class="btn ghost full">${icon('logout')}로그아웃</button></form>
</nav>`;
  }
  const flash = ctx.flash ? html`<div class="flash ${ctx.flash.type || ''}" role="status">${ctx.flash.msg}</div>` : '';
  return '<!doctype html>' + html`
<html lang="ko"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title ? title + ' | ' : ''}${APP_SHORT}</title>
<meta name="description" content="${APP_NAME} 학생·학부모·강사를 위한 출결·운동일지·자세 피드백 앱">
<meta name="theme-color" content="#0a0a0a">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${APP_SHORT}">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/img/favicon.png">
<link rel="apple-touch-icon" href="/img/icon-180.png">
<link rel="stylesheet" href="/css/app.css?v=${ASSET_V}">
<script src="/js/app.js?v=${ASSET_V}" defer></script>
</head><body class="${u && u.status === 'approved' && !bare ? 'has-top' : ''}">
${header}
<main class="wrap">${flash}${body}</main>
</body></html>`;
}
export const ASSET_V = Date.now().toString(36);

export function csrfField(ctx) { return html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`; }

// --- 공통 컴포넌트 ---
export function pageTitle(t, sub, back) {
  return html`${back ? html`<a class="back" href="${back[1]}">${icon('left')}${back[0]}</a>` : ''}
<div class="ptitle"><h1>${t}</h1>${sub ? html`<p>${sub}</p>` : ''}</div>`;
}
export function empty(t, sub) { return html`<div class="empty"><b>${t}</b>${sub ? html`<span>${sub}</span>` : ''}</div>`; }
export function pills(items, current, cls = '') {
  return html`<div class="pills ${cls}">${items.map(([label, href, key]) => html`<a class="pill ${(key ?? href) === current ? 'on' : ''}" href="${href}">${label}</a>`)}</div>`;
}
export function stat(label, value, sub, href, cls = '') {
  const inner = html`<span class="st-l">${label}</span><b class="st-v ${cls}">${value}</b>${sub ? html`<span class="st-s">${sub}</span>` : ''}`;
  return href ? html`<a class="stat" href="${href}">${inner}</a>` : html`<div class="stat">${inner}</div>`;
}
export function monthNav(base, ym, curYm, extra = '') {
  const [y, m] = ym.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const sep = base.includes('?') ? '&' : '?';
  return html`<div class="mnav">
  <a class="btn sm ghost" href="${base}${sep}m=${prev}${extra}">${icon('left')}이전 달</a>
  <b>${y}년 ${m}월${ym === curYm ? html` <em>이번 달</em>` : ''}</b>
  ${ym < curYm ? html`<a class="btn sm ghost" href="${base}${sep}m=${next}${extra}">다음 달${icon('right')}</a>` : html`<span class="btn sm ghost dis">다음 달${icon('right')}</span>`}
</div>`;
}
export function chip(text, cls = '') { return html`<span class="chip ${cls}">${text}</span>`; }
export function avatarInitial(name) { return (name || '?').slice(0, 1); }
