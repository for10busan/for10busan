import { get, post, notFound, forbidden, bad } from '../lib/router.js';
import { one, all, run, tx } from '../lib/db.js';
import { html, raw, icon, pageTitle, empty, csrfField, pills, chip } from '../lib/html.js';
import { today, thisMonth, isValidMonth, isValidDate, monthDays, weekday, korDay, korMonth, korDateTime, utcToKstDate, isStaff, num, fmtNum, WEEKDAYS } from '../lib/util.js';
import { canViewStudent, notify, staffIds, parentIdsOf, studentClasses } from '../lib/services.js';
import { videosTab } from './videos.js';
import { targetsTab, examsTab, predictTab } from './admissions.js';

export const CONDITION = ['', '매우 나쁨', '나쁨', '보통', '좋음', '매우 좋음'];
const TABS = [['일지', 'logs'], ['기록', 'records'], ['영상', 'videos'], ['목표 대학', 'targets'], ['모의고사', 'exams'], ['합격 예측', 'predict']];
const ME_PATH = { logs: '/me/logs', records: '/me/records', videos: '/me/videos', targets: '/me/targets', exams: '/me/exams', predict: '/me/predict' };

get('/students', 'staff', ctx => {
  const t = today(); const q = (ctx.query.q || '').trim();
  const rows = all(`SELECT u.*, (SELECT MAX(date) FROM logs l WHERE l.student_id=u.id) last_log,
     (SELECT GROUP_CONCAT(c.name, ', ') FROM class_students cs JOIN classes c ON c.id=cs.class_id WHERE cs.user_id=u.id) classes
     FROM users u WHERE role='student' AND status='approved' ${q ? 'AND (u.name LIKE ? OR u.school LIKE ?)' : ''} ORDER BY u.name`, ...(q ? [`%${q}%`, `%${q}%`] : []));
  const noToday = rows.filter(r => r.last_log !== t).length;
  ctx.page('학생', html`${pageTitle('전체 학생', `오늘 일지 미작성 ${noToday}명 / ${rows.length}명`)}
  <form class="flex mb8"><input type="search" name="q" value="${q}" placeholder="이름 또는 학교로 검색"><button class="btn sm dark" style="height:44px">${icon('search')}</button></form>
  ${rows.length ? html`<div class="list">${rows.map(s => html`<a href="/students/${s.id}"><div class="row-m"><b>${s.name}</b><span>${[s.school, s.grade, s.classes].filter(Boolean).join(' · ')}</span></div>
    <div class="row-r">${s.last_log === t ? chip(html`${icon('check')}오늘 일지`, 'green') : s.last_log ? html`${icon('clock')}마지막 ${korDay(s.last_log)}` : html`${icon('clock')}일지 없음`}${icon('right')}</div></a>`)}</div>`
    : empty('학생이 없어요', '가입 승인된 학생이 여기에 보여요.')}`);
});

export function studentHeader(ctx, s, tab) {
  const self = ctx.user.id === s.id;
  const base = self ? null : `/students/${s.id}`;
  const items = TABS.map(([l, k]) => [l, self ? ME_PATH[k] : `${base}?tab=${k}`, k]);
  const back = isStaff(ctx.user) ? ['학생 목록', '/students'] : ctx.user.role === 'parent' ? ['홈', '/parent'] : null;
  return html`${pageTitle(self ? '내 기록' : s.name, [s.school, s.grade].filter(Boolean).join(' · ') || ' ', back)}${pills(items, tab, 'scroll')}`;
}

async function renderStudent(ctx, sid, tab) {
  const s = one(`SELECT * FROM users WHERE id=? AND role='student'`, sid) || notFound();
  if (!canViewStudent(ctx.user, s.id)) forbidden();
  if (!TABS.some(([, k]) => k === tab)) tab = 'logs';
  let body;
  if (tab === 'logs') body = logsTab(ctx, s);
  else if (tab === 'records') body = recordsTab(ctx, s);
  else if (tab === 'videos') body = videosTab(ctx, s);
  else if (tab === 'targets') body = targetsTab(ctx, s);
  else if (tab === 'exams') body = examsTab(ctx, s);
  else body = predictTab(ctx, s);
  const self = ctx.user.id === s.id;
  ctx.page(self ? '내 기록' : `${s.name} 학생`, html`${studentHeader(ctx, s, tab)}${body}`, { active: self ? ME_PATH[tab] : undefined });
}
get('/students/:id', 'user', ctx => renderStudent(ctx, Number(ctx.params.id), ctx.query.tab || 'logs'));
for (const [k, p] of Object.entries(ME_PATH)) get(p, 'student', ctx => renderStudent(ctx, ctx.user.id, k));

// ---------- 일지 탭 (월 캘린더) ----------
function logsTab(ctx, s) {
  const ym = isValidMonth(ctx.query.ym) ? ctx.query.ym : thisMonth();
  const logs = all(`SELECT l.*, (SELECT GROUP_CONCAT(e.name, ' · ') FROM log_items li JOIN exercises e ON e.id=li.exercise_id WHERE li.log_id=l.id) ex,
    (SELECT COUNT(*) FROM comments c WHERE c.target_type='log' AND c.target_id=l.id) nc FROM logs l WHERE student_id=? AND substr(date,1,7)=? ORDER BY date DESC`, s.id, ym);
  const by = Object.fromEntries(logs.map(l => [l.date, l]));
  const days = monthDays(ym); const first = weekday(`${ym}-01`); const t = today();
  const self = ctx.user.id === s.id;
  const base = self ? '/me/logs?' : `/students/${s.id}?tab=logs&`;
  const prev = shiftYm(ym, -1), next = shiftYm(ym, 1);
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(html`<span></span>`);
  for (let d = 1; d <= days; d++) {
    const ds = `${ym}-${String(d).padStart(2, '0')}`; const l = by[ds]; const wd = (first + d - 1) % 7;
    const cls = `d ${l ? 'has' : ''} ${ds === t ? 'today' : ''} ${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''}`;
    cells.push(l ? html`<a class="${cls}" href="#day-${ds}" aria-label="${d}일 일지 1개">${d}<i class="dot"></i></a>` : html`<span class="${cls}" aria-label="${d}일 일지 없음">${d}</span>`);
  }
  return html`
  ${self ? html`<a class="btn full mb8" href="/logs/new">${icon('pen')}${by[t] ? '오늘 일지 고치기' : '오늘 운동일지 쓰기'}</a>` : ''}
  <div class="card">
    <div class="mnav"><a class="ibtn" style="color:inherit" href="${base}ym=${prev}" aria-label="이전 달">${icon('left')}</a><b>${korMonth(ym)} · ${logs.length}개</b>
      ${ym < thisMonth() ? html`<a class="ibtn" style="color:inherit" href="${base}ym=${next}" aria-label="다음 달">${icon('right')}</a>` : html`<span class="ibtn" style="opacity:.3">${icon('right')}</span>`}</div>
    <div class="cal">${WEEKDAYS.map(w => html`<span class="wd">${w}</span>`)}${cells}</div>
  </div>
  ${logs.length ? html`<div class="list">${logs.map(l => html`<a href="/logs/${l.id}" id="day-${l.date}"><div class="row-m"><b>${korDay(l.date)}</b><span>${l.ex || '훈련 기록 없음'}</span></div>
    <div class="row-r">${l.nc ? chip(`코멘트 ${l.nc}`, 'blue') : ''}${l.condition ? html`<span>컨디션 ${CONDITION[l.condition]}</span>` : ''}${icon('right')}</div></a>`)}</div>` : empty('이 달에 쓴 일지가 없습니다')}`;
}
function shiftYm(ym, n) { let [y, m] = ym.split('-').map(Number); m += n; if (m > 12) { m = 1; y++; } if (m < 1) { m = 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; }

// ---------- 기록 탭 ----------
export function recordSeries(sid) {
  const rows = all(`
    SELECT e.id eid, e.name, e.unit, e.higher_better hb, l.date, li.record v, '일지' src FROM log_items li JOIN logs l ON l.id=li.log_id JOIN exercises e ON e.id=li.exercise_id WHERE l.student_id=? AND li.record IS NOT NULL
    UNION ALL SELECT e.id, e.name, e.unit, e.higher_better, mt.month||'-15', mt.record, '월별 테스트' FROM monthly_tests mt JOIN exercises e ON e.id=mt.exercise_id WHERE mt.student_id=?
    UNION ALL SELECT e.id, e.name, e.unit, e.higher_better, date(v.created_at,'+9 hours'), v.record, '영상' FROM videos v JOIN exercises e ON e.id=v.exercise_id WHERE v.student_id=? AND v.record IS NOT NULL
    ORDER BY 5`, sid, sid, sid);
  const by = {};
  for (const r of rows) (by[r.eid] ||= { id: r.eid, name: r.name, unit: r.unit, hb: r.hb, pts: [] }).pts.push(r);
  return Object.values(by);
}
export function sparkline(pts, hb) {
  if (!pts.length) return '';
  const W = 320, H = 120, P = 18;
  const vs = pts.map(p => p.v); let mn = Math.min(...vs), mx = Math.max(...vs); if (mn === mx) { mn -= 1; mx += 1; }
  const x = i => pts.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (pts.length - 1);
  const y = v => H - P - ((v - mn) / (mx - mn)) * (H - 2 * P);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const best = hb ? Math.max(...vs) : Math.min(...vs);
  return raw(`<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="기록 추이">
    <line x1="${P}" x2="${W - P}" y1="${H - P}" y2="${H - P}" stroke="#e6e8ec"/>
    <path d="${d}" fill="none" stroke="#c81018" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${p.v === best ? 5 : 3.5}" fill="${p.v === best ? '#c81018' : '#fff'}" stroke="#c81018" stroke-width="2"><title>${p.date} ${p.v}</title></circle>`).join('')}
    <text x="${P}" y="12" font-size="10" fill="#7a808a">${fmtNum(mx)}</text><text x="${P}" y="${H - 4}" font-size="10" fill="#7a808a">${fmtNum(mn)}</text></svg>`);
}
function recordsTab(ctx, s) {
  const series = recordSeries(s.id);
  if (!series.length) return empty('아직 종목 기록이 없습니다', '일지에 종목 기록이 쌓이면 여기에 표시됩니다.');
  return series.map(sr => {
    const vs = sr.pts.map(p => p.v); const best = sr.hb ? Math.max(...vs) : Math.min(...vs); const last = sr.pts[sr.pts.length - 1];
    return html`<div class="card"><div class="flex between"><h3 class="mb0">${sr.name}</h3><span class="small muted">${sr.hb ? '높을수록 좋음' : '낮을수록 좋음'}</span></div>
      <div class="big3"><div><small>최고</small><b>${fmtNum(best)}${sr.unit}</b></div><div><small>최근</small><b>${fmtNum(last.v)}${sr.unit}</b></div><div><small>기록 수</small><b>${sr.pts.length}</b></div></div>
      ${sparkline(sr.pts.slice(-20), sr.hb)}
      <details><summary class="small muted" style="cursor:pointer">전체 기록 보기</summary><table class="tbl mt8"><tr><th>날짜</th><th>출처</th><th>기록</th></tr>${[...sr.pts].reverse().map(p => html`<tr><td>${korDay(p.date)}</td><td>${p.src}</td><td>${fmtNum(p.v)}${sr.unit}</td></tr>`)}</table></details></div>`;
  });
}

// ---------- 일지 쓰기 ----------
function logForm(ctx, log, items) {
  const exs = all(`SELECT id,name,unit FROM exercises WHERE active=1 ORDER BY sort,id`);
  const rows = items.length ? items : [{}];
  const exOpts = sel => html`<option value="">종목 선택</option>${exs.map(e => html`<option value="${e.id}" data-unit="${e.unit}" ${e.id === sel ? 'selected' : ''}>${e.name} (${e.unit})</option>`)}<option value="0" ${sel === 0 ? 'selected' : ''}>기타 훈련 (기록 없음)</option>`;
  return html`<form method="post" action="/logs/new" class="formcard" id="logForm">${csrfField(ctx)}
    <label class="field"><span>날짜</span><input type="date" name="date" value="${log.date || today()}" max="${today()}" required></label>
    <div class="field"><span class="lbl">컨디션</span><div class="tg">${[5, 4, 3, 2, 1].map(c => html`<label><input type="radio" name="condition" value="${c}" ${Number(log.condition || 4) === c ? 'checked' : ''}><span>${c} · ${CONDITION[c]}</span></label>`)}</div></div>
    <div class="row2"><label class="field"><span>수면 (시간)</span><input type="number" name="sleep_hours" step="0.5" min="0" max="24" value="${log.sleep_hours ?? ''}" placeholder="예: 7"></label>
      <label class="field"><span>통증</span><input type="text" name="pain" value="${log.pain ?? ''}" placeholder="없음 / 예: 왼쪽 무릎"></label></div>
    <span class="lbl">훈련 기록</span>
    <div id="items">${rows.map(it => html`<div class="pt li"><div class="flex"><select name="ex[]" class="grow">${exOpts(it.exercise_id === null ? 0 : it.exercise_id)}</select><button type="button" class="btn xs gray" data-del>${icon('x')}</button></div>
      <div class="row2 mt8"><input type="number" step="any" name="rec[]" value="${it.record ?? ''}" placeholder="기록 (선택)"><input type="text" name="imemo[]" value="${it.memo ?? ''}" placeholder="메모 · 예: 팔치기, 무릎 들기"></div></div>`)}</div>
    <button type="button" class="btn gray full sm mb8" id="addItem">${icon('plus')}종목 추가</button>
    <label class="field mt8"><span>오늘 한 줄 (선택)</span><textarea name="memo" rows="3" placeholder="잘 된 점, 어려웠던 점">${log.memo ?? ''}</textarea></label>
    <button class="btn full">${icon('save')}일지 저장</button>
  </form>`;
}
get('/logs/new', 'student', ctx => {
  const d = isValidDate(ctx.query.date) ? ctx.query.date : today();
  const log = one('SELECT * FROM logs WHERE student_id=? AND date=?', ctx.user.id, d) || { date: d };
  const items = log.id ? all('SELECT * FROM log_items WHERE log_id=?', log.id) : [];
  ctx.page('운동일지', html`${pageTitle(log.id ? `${korDay(d)} 일지 고치기` : '운동일지 쓰기', '일지를 쓰면 K 열쇠 1개! 오늘 출석까지 하면 2개예요.', ['내 기록', '/me/logs'])}
    ${logForm(ctx, log, items)}`, { active: '/me/logs' });
});
post('/logs/new', 'student', ctx => {
  const b = ctx.body; const sid = ctx.user.id;
  if (!isValidDate(b.date) || b.date > today()) bad('날짜를 확인해 주세요.');
  const ex = [].concat(b.ex || []), rec = [].concat(b.rec || []), im = [].concat(b.imemo || []);
  const id = tx(() => {
    let log = one('SELECT id FROM logs WHERE student_id=? AND date=?', sid, b.date);
    const cond = Math.min(5, Math.max(1, Number(b.condition) || 3));
    if (log) run('UPDATE logs SET condition=?, sleep_hours=?, pain=?, memo=? WHERE id=?', cond, num(b.sleep_hours), (b.pain || '').trim() || '없음', b.memo || null, log.id);
    else log = { id: Number(run('INSERT INTO logs(student_id,date,condition,sleep_hours,pain,memo) VALUES(?,?,?,?,?,?)', sid, b.date, cond, num(b.sleep_hours), (b.pain || '').trim() || '없음', b.memo || null).lastInsertRowid) };
    run('DELETE FROM log_items WHERE log_id=?', log.id);
    ex.forEach((e, i) => {
      if (e === '' && !(im[i] || '').trim()) return;
      const eid = Number(e) || null;
      run('INSERT INTO log_items(log_id,exercise_id,record,memo) VALUES(?,?,?,?)', log.id, eid, eid ? num(rec[i]) : null, (im[i] || '').trim() || null);
    });
    return log.id;
  });
  ctx.redirect(`/logs/${id}`, '일지를 저장했어요.');
});

// ---------- 일지 상세 ----------
export function commentsBlock(ctx, type, id, ownerId) {
  const cs = all(`SELECT c.*, u.name, u.role FROM comments c LEFT JOIN users u ON u.id=c.author_id WHERE target_type=? AND target_id=? ORDER BY c.id`, type, id);
  return html`<div class="card"><h3>코치 코멘트</h3>
    ${cs.length ? cs.map(c => html`<div class="pt"><div class="flex between small"><b>${c.name || '알 수 없음'}</b><span class="muted">${korDateTime(c.created_at)}</span></div><p class="mt8 mb0" style="white-space:pre-wrap">${c.body}</p>
      ${c.author_id === ctx.user.id ? html`<form method="post" action="/comments/${c.id}/delete" class="right" data-confirm="코멘트를 지울까요?">${csrfField(ctx)}<button class="btn xs gray mt8">지우기</button></form>` : ''}</div>`) : html`<p class="small muted mt0">아직 코치 코멘트가 없습니다.</p>`}
    ${isStaff(ctx.user) ? html`<form method="post" action="/comments" class="mt12">${csrfField(ctx)}<input type="hidden" name="type" value="${type}"><input type="hidden" name="id" value="${id}">
      <label class="field mb8"><span>코멘트 남기기</span><textarea name="body" rows="3" required placeholder="잘한 점, 고칠 점을 구체적으로 남겨 주세요. 학생에게 알림이 갑니다."></textarea></label>
      <button class="btn full">${icon('save')}코멘트 등록</button></form>` : ''}</div>`;
}
post('/comments', 'staff', ctx => {
  const { type, id, body } = ctx.body;
  if (!['log', 'video'].includes(type) || !(body || '').trim()) bad('코멘트를 입력해 주세요.');
  const t = type === 'log' ? one('SELECT student_id FROM logs WHERE id=?', id) : one('SELECT student_id FROM videos WHERE id=?', id);
  if (!t) notFound();
  run('INSERT INTO comments(target_type,target_id,author_id,body) VALUES(?,?,?,?)', type, id, ctx.user.id, body.trim());
  if (type === 'video') run(`UPDATE videos SET reviewed_by=?, reviewed_at=COALESCE(reviewed_at, datetime('now')) WHERE id=?`, ctx.user.id, id);
  if (type === 'log' && isStaff(ctx.user)) run(`UPDATE logs SET reviewed_by=?, reviewed_at=COALESCE(reviewed_at, datetime('now')) WHERE id=?`, ctx.user.id, id);
  const link = `/${type === 'log' ? 'logs' : 'videos'}/${id}`;
  notify([t.student_id, ...parentIdsOf(t.student_id)], 'comment', `${ctx.user.name} 선생님이 코멘트를 남겼어요`, body.trim().slice(0, 60), link);
  ctx.redirect(link, '코멘트를 등록했어요.');
});
post('/comments/:id/delete', 'staff', ctx => {
  const c = one('SELECT * FROM comments WHERE id=?', ctx.params.id) || notFound();
  if (c.author_id !== ctx.user.id) forbidden();
  run('DELETE FROM comments WHERE id=?', c.id);
  ctx.back('지웠어요.');
});
post('/logs/:id/review', 'staff', ctx => {
  const l = one('SELECT * FROM logs WHERE id=?', ctx.params.id) || notFound();
  if (ctx.body.v === '0') run('UPDATE logs SET reviewed_by=NULL, reviewed_at=NULL WHERE id=?', l.id);
  else run(`UPDATE logs SET reviewed_by=?, reviewed_at=datetime('now') WHERE id=?`, ctx.user.id, l.id);
  ctx.back(ctx.body.v === '0' ? '확인을 취소했어요.' : '일지를 확인했어요.');
});
get('/logs/:id', 'user', ctx => {
  const l = one('SELECT l.*, u.name FROM logs l JOIN users u ON u.id=l.student_id WHERE l.id=?', ctx.params.id) || notFound();
  if (!canViewStudent(ctx.user, l.student_id)) forbidden();
  const items = all('SELECT li.*, e.name, e.unit FROM log_items li LEFT JOIN exercises e ON e.id=li.exercise_id WHERE log_id=? ORDER BY li.id', l.id);
  const self = ctx.user.id === l.student_id;
  ctx.page('일지', html`${pageTitle(`${korDay(l.date)} 일지`, `${l.name} · 작성 ${korDateTime(l.created_at)}`, [self ? '내 기록' : '목록', self ? '/me/logs' : `/students/${l.student_id}?tab=logs&ym=${l.date.slice(0, 7)}`])}
  <div class="card"><h3>몸 상태</h3><dl class="kv"><dt>컨디션</dt><dd>${l.condition ? `${l.condition} · ${CONDITION[l.condition]}` : '—'}</dd><dt>수면</dt><dd>${l.sleep_hours != null ? `${fmtNum(l.sleep_hours, 1)}시간` : '—'}</dd><dt>통증</dt><dd>${l.pain || '없음'}</dd></dl></div>
  <div class="card"><h3>훈련 기록</h3>${items.length ? html`<div class="list mb0">${items.map(i => html`<div><div class="row-m"><b>${i.name || '기타 훈련'}</b><span class="wrap2">${i.memo || ''}</span></div>${i.record != null ? html`<b>${fmtNum(i.record)}${i.unit}</b>` : ''}</div>`)}</div>` : html`<p class="small muted m0">기록한 종목이 없어요.</p>`}
    ${l.memo ? html`<p class="mt12 mb0" style="white-space:pre-wrap">${l.memo}</p>` : ''}</div>
  ${isStaff(ctx.user) ? html`<form method="post" action="/logs/${l.id}/review" class="mb8">${csrfField(ctx)}<input type="hidden" name="v" value="${l.reviewed_at ? 0 : 1}">
    <button class="btn full ${l.reviewed_at ? 'gray' : ''}">${icon('check')}${l.reviewed_at ? '확인 취소' : '일지 확인'}</button></form>` : l.reviewed_at ? html`<div class="note blue">${icon('check')}<span>선생님이 이 일지를 확인했어요.</span></div>` : ''}
  ${commentsBlock(ctx, 'log', l.id, l.student_id)}
  ${self ? html`<a class="btn ghost full" href="/logs/new?date=${l.date}">${icon('pen')}이 일지 고치기</a>` : ''}`, { active: self ? '/me/logs' : undefined });
});

// ---------- 학생 홈 ----------
get('/me', 'student', ctx => {
  const u = ctx.user; const t = today();
  const classes = studentClasses(u.id);
  const ses = all(`SELECT s.*, c.name, c.start_time, a.status FROM class_sessions s JOIN classes c ON c.id=s.class_id JOIN class_students cs ON cs.class_id=c.id AND cs.user_id=?
    LEFT JOIN attendance a ON a.session_id=s.id AND a.student_id=? WHERE s.date=? ORDER BY c.start_time`, u.id, u.id, t);
  const logT = one('SELECT id FROM logs WHERE student_id=? AND date=?', u.id, t);
  const ym = thisMonth();
  const k = one(`SELECT (SELECT COUNT(DISTINCT date) FROM logs WHERE student_id=? AND substr(date,1,7)=?) l,
     (SELECT COUNT(DISTINCT s.date) FROM attendance a JOIN class_sessions s ON s.id=a.session_id WHERE a.student_id=? AND substr(s.date,1,7)=? AND a.status IN ('present','late') AND s.canceled=0) a`, u.id, ym, u.id, ym);
  const vids = all(`SELECT v.*, e.name ex FROM videos v JOIN exercises e ON e.id=v.exercise_id WHERE student_id=? ORDER BY v.id DESC LIMIT 3`, u.id);
  const coms = all(`SELECT c.*, au.name author FROM comments c JOIN users au ON au.id=c.author_id WHERE (c.target_type='log' AND c.target_id IN (SELECT id FROM logs WHERE student_id=?)) OR (c.target_type='video' AND c.target_id IN (SELECT id FROM videos WHERE student_id=?)) ORDER BY c.id DESC LIMIT 3`, u.id, u.id);
  const ev = all(`SELECT * FROM events WHERE end_date>=? AND (branch_id IS NULL OR branch_id=?) ORDER BY start_date LIMIT 3`, t, u.branch_id || 0);
  ctx.page('홈', html`
  <div class="hero"><small>No Limit with FOR10</small><b>${u.name}, 오늘도 한 걸음!</b></div>
  <div class="grid c3 mt12">
    <a class="stat" href="/ranking"><span class="st-l">${icon('key')} 이번 달 K 열쇠</span><b class="st-v">${k.l + k.a}개</b><span class="st-s">일지 ${k.l} · 출석 ${k.a}</span></a>
    <a class="stat" href="/logs/new"><span class="st-l">${icon('pen')} 오늘 일지</span><b class="st-v ${logT ? '' : 'red'}">${logT ? '완료' : '미작성'}</b><span class="st-s">${logT ? '눌러서 고치기' : '눌러서 쓰기'}</span></a>
    <a class="stat" href="/videos/new"><span class="st-l">${icon('video')} 자세 분석</span><b class="st-v">촬영</b><span class="st-s">영상 올리기</span></a>
  </div>
  <h2 class="sec">오늘 수업 · ${korDay(t)}</h2>
  ${ses.length ? html`<div class="list">${ses.map(s => html`<div><div class="row-m"><b>${s.name}</b><span>${s.start_time || ''}${s.canceled ? ' · 휴강' : ''}</span></div>
    ${s.status ? chip({ present: '출석', late: '지각', absent: '결석', excused: '공결' }[s.status], { present: 'green', late: 'amber', absent: 'red', excused: 'blue' }[s.status]) : chip('출석 전')}</div>`)}</div>`
    : empty('오늘은 수업이 없어요', classes.length ? `내 반: ${classes.map(c => c.name).join(', ')}` : '학원에서 반을 배정하면 일정이 보여요.')}
  ${coms.length ? html`<h2 class="sec">최근 코치 코멘트</h2><div class="list">${coms.map(c => html`<a href="/${c.target_type === 'log' ? 'logs' : 'videos'}/${c.target_id}"><div class="row-m"><b>${c.author} 선생님</b><span>${c.body}</span></div>${icon('right')}</a>`)}</div>` : ''}
  ${vids.length ? html`<h2 class="sec">최근 영상</h2><div class="list">${vids.map(v => html`<a href="/videos/${v.id}"><div class="row-m"><b>${v.ex}</b><span>${korDateTime(v.created_at)}</span></div>${icon('right')}</a>`)}</div>` : ''}
  ${ev.length ? html`<h2 class="sec">다가오는 일정</h2><div class="list">${ev.map(e => html`<a href="/calendar?m=${e.start_date.slice(0, 7)}"><div class="row-m"><b>${e.title}</b><span>${korDay(e.start_date)}${e.end_date !== e.start_date ? ' ~ ' + korDay(e.end_date) : ''}</span></div>${chip(e.kind === 'test' ? '실기 테스트' : '주요 일정', e.kind === 'test' ? 'red' : 'dark')}</a>`)}</div>` : ''}`);
});

// ---------- 학부모 홈 ----------
get('/parent', 'parent', ctx => {
  const kids = all(`SELECT pl.status, u.* FROM parent_links pl JOIN users u ON u.id=pl.student_id WHERE pl.parent_id=? ORDER BY u.name`, ctx.user.id);
  const t = today();
  ctx.page('홈', html`<div class="hero"><small>FOR10 Busan Parents</small><b>${ctx.user.name}님, 안녕하세요</b></div>
  <h2 class="sec">자녀</h2>
  ${kids.length ? kids.map(k => {
    if (k.status !== 'approved') return html`<div class="card"><b>${k.name}</b> ${chip(k.status === 'pending' ? '승인 대기' : '거절됨', k.status === 'pending' ? 'amber' : 'red')}<p class="small muted mb0">학원에서 보호자 확인 후 승인하면 기록을 볼 수 있어요.</p></div>`;
    const att = all(`SELECT a.status, s.date, c.name FROM attendance a JOIN class_sessions s ON s.id=a.session_id JOIN classes c ON c.id=s.class_id WHERE a.student_id=? ORDER BY s.date DESC LIMIT 5`, k.id);
    const lastLog = one('SELECT date FROM logs WHERE student_id=? ORDER BY date DESC LIMIT 1', k.id);
    return html`<div class="card"><div class="flex between"><h3 class="mb0">${k.name} <small>${k.school || ''} ${k.grade || ''}</small></h3><a class="btn sm ghost" href="/students/${k.id}">기록 보기${icon('right')}</a></div>
      <p class="small muted">마지막 일지: ${lastLog ? korDay(lastLog.date) : '없음'}${lastLog?.date === t ? ' (오늘)' : ''}</p>
      ${att.length ? html`<div class="list mb0">${att.map(a => html`<div><div class="row-m"><b>${korDay(a.date)}</b><span>${a.name}</span></div>${chip({ present: '출석', late: '지각', absent: '결석', excused: '공결' }[a.status], { present: 'green', late: 'amber', absent: 'red', excused: 'blue' }[a.status])}</div>`)}</div>` : html`<p class="small muted mb0">아직 출결 기록이 없어요.</p>`}</div>`;
  }) : empty('연결된 자녀가 없어요', '아래에서 자녀 연결을 요청해 주세요.')}
  <div class="card"><h3>자녀 연결 요청</h3><form method="post" action="/parent/link">${csrfField(ctx)}
    <label class="field"><span>자녀 이름</span><input type="text" name="child_name" required></label>
    <label class="field"><span>자녀 이메일 (선택)</span><input type="email" name="child_email"><small>동명이인이 있으면 이메일로 정확히 찾아요.</small></label>
    <button class="btn full">연결 요청</button></form></div>`);
});
post('/parent/link', 'parent', async ctx => {
  const { requestLink } = await import('./auth.js');
  const ok = requestLink(ctx.user.id, ctx.user.name, ctx.body.child_name, ctx.body.child_email);
  ctx.redirect('/parent', ok ? '연결 요청을 보냈어요. 학원에서 확인 후 승인해요.' : { msg: '자녀를 찾지 못했어요. 이름(또는 이메일)을 확인하거나, 자녀가 먼저 가입했는지 확인해 주세요.', type: 'err' });
});
