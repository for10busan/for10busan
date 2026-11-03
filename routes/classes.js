import { get, post, notFound, bad } from '../lib/router.js';
import { one, all, run, tx } from '../lib/db.js';
import { html, icon, pageTitle, empty, csrfField, pills, chip } from '../lib/html.js';
import { today, addDays, korDay, WEEKDAYS, isValidDate, ROLE_LABEL, ATT_LABEL } from '../lib/util.js';
import { ensureSessions, regenerateFuture, classDays, branches, notify, parentIdsOf } from '../lib/services.js';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const daysLabel = c => classDays(c).sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)).map(d => WEEKDAYS[d]).join('·');

get('/admin/classes', 'staff', ctx => {
  const rows = all(`SELECT c.*, b.name branch, (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id=c.id) n FROM classes c LEFT JOIN branches b ON b.id=c.branch_id ORDER BY c.active DESC, b.sort, c.name`);
  ctx.page('반 관리', html`${pageTitle('반 관리', '반을 만들고 담당 강사를 지정하세요. 학생 배정은 강사도 할 수 있습니다.')}
  <a class="btn full mb8" href="/admin/classes/new">${icon('plus')}새 반 만들기</a>
  ${rows.length ? html`<div class="list mt12">${rows.map(c => html`<a href="/classes/${c.id}"><div class="row-m"><b>${c.name}${c.active ? '' : html` ${chip('운영 중지')}`}</b><span>${daysLabel(c) || '요일 미지정'}${c.start_time ? ` · ${c.start_time}` : ''}${c.branch ? ` · ${c.branch}` : ''}</span></div>
    <div class="row-r">${icon('users')}${c.n}명${icon('right')}</div></a>`)}</div>` : empty('아직 반이 없어요', '새 반을 만들어 주세요.')}`);
});

function classForm(ctx, c = {}, action) {
  const days = classDays(c);
  const coaches = all(`SELECT id,name,role FROM users WHERE role IN ('owner','vice','coach') AND status='approved' ORDER BY name`);
  const mine = c.id ? all('SELECT user_id FROM class_coaches WHERE class_id=?', c.id).map(r => r.user_id) : [ctx.user.id];
  const br = branches();
  return html`<form method="post" action="${action}" class="formcard">${csrfField(ctx)}
    <label class="field"><span>반 이름</span><input type="text" name="name" value="${c.name || ''}" required placeholder="예: 화목토 저녁반"></label>
    ${br.length ? html`<label class="field"><span>지점</span><select name="branch_id">${br.map(b => html`<option value="${b.id}" ${b.id === c.branch_id ? 'selected' : ''}>${b.name}</option>`)}</select></label>` : ''}
    <div class="field"><span class="lbl">수업 요일</span><div class="tg sq">${DAY_ORDER.map(d => html`<label><input type="checkbox" name="days[]" value="${d}" ${days.includes(d) ? 'checked' : ''}><span>${WEEKDAYS[d]}</span></label>`)}</div></div>
    <div class="row2"><label class="field"><span>시작 시간 (선택)</span><input type="time" name="start_time" value="${c.start_time || ''}"></label>
      <label class="field"><span>끝나는 시간 (선택)</span><input type="time" name="end_time" value="${c.end_time || ''}"></label></div>
    <div class="row2"><label class="field"><span>시작일</span><input type="date" name="start_date" value="${c.start_date || today()}" required></label>
      <label class="field"><span>종료일 (선택)</span><input type="date" name="end_date" value="${c.end_date || ''}"></label></div>
    <div class="field"><span class="lbl">담당 강사</span><div class="tg dark">${coaches.map(s => html`<label><input type="checkbox" name="coaches[]" value="${s.id}" ${mine.includes(s.id) ? 'checked' : ''}><span>${s.name} (${ROLE_LABEL[s.role]})</span></label>`)}</div></div>
    <label class="field"><span>메모 (선택)</span><textarea name="memo" rows="2">${c.memo || ''}</textarea></label>
    <label class="check"><input type="checkbox" name="active" ${c.active === 0 ? '' : 'checked'}><span>운영 중 <span class="muted small">(끄면 앞으로의 수업 일정이 만들어지지 않습니다)</span></span></label>
    ${c.id ? html`<p class="help">요일·시간·기간을 바꾸면 오늘 이후의 정규 수업 일정이 다시 만들어집니다. 이미 출결을 기록한 수업과 보강은 그대로 남습니다.</p>` : ''}
    <button class="btn full mt8">${c.id ? '저장' : '반 만들기'}</button>
  </form>`;
}
function readClass(b) {
  const name = (b.name || '').trim(); if (!name) bad('반 이름을 입력해 주세요.');
  if (!isValidDate(b.start_date)) bad('시작일을 확인해 주세요.');
  const days = [].concat(b.days || []).map(Number).filter(d => d >= 0 && d <= 6);
  return { name, branch_id: Number(b.branch_id) || null, days: [...new Set(days)].join(','), start_time: b.start_time || null, end_time: b.end_time || null,
    start_date: b.start_date, end_date: isValidDate(b.end_date) ? b.end_date : null, memo: b.memo || null, active: b.active ? 1 : 0, coaches: [].concat(b.coaches || []).map(Number) };
}
get('/admin/classes/new', 'staff', ctx => ctx.page('새 반', html`${pageTitle('새 반 만들기', '', ['반 관리', '/admin/classes'])}${classForm(ctx, {}, '/admin/classes/new')}`));
post('/admin/classes/new', 'staff', ctx => {
  const c = readClass(ctx.body);
  const id = tx(() => {
    const r = run('INSERT INTO classes(name,branch_id,days,start_time,end_time,start_date,end_date,memo,active) VALUES(?,?,?,?,?,?,?,?,?)', c.name, c.branch_id, c.days, c.start_time, c.end_time, c.start_date, c.end_date, c.memo, c.active);
    const id = Number(r.lastInsertRowid);
    for (const u of c.coaches) run('INSERT OR IGNORE INTO class_coaches VALUES(?,?)', id, u);
    return id;
  });
  ensureSessions(today(), addDays(today(), 21));
  ctx.redirect(`/classes/${id}`, '반을 만들었어요. 학생을 추가해 주세요.');
});

get('/classes/:id', 'staff', ctx => {
  const c = one('SELECT * FROM classes WHERE id=?', ctx.params.id) || notFound();
  const t = today();
  ensureSessions(addDays(t, -7), addDays(t, 21));
  const sess = all(`SELECT s.*, (SELECT COUNT(*) FROM attendance a WHERE a.session_id=s.id) nc FROM class_sessions s WHERE s.class_id=? AND s.date>=? ORDER BY s.date LIMIT 6`, c.id, addDays(t, -7));
  const studs = all(`SELECT u.* FROM class_students cs JOIN users u ON u.id=cs.user_id WHERE cs.class_id=? ORDER BY u.name`, c.id);
  const q = (ctx.query.q || '').trim();
  const cand = q ? all(`SELECT * FROM users WHERE role='student' AND status='approved' AND (name LIKE ? OR school LIKE ?) AND id NOT IN (SELECT user_id FROM class_students WHERE class_id=?) ORDER BY name LIMIT 20`, `%${q}%`, `%${q}%`, c.id) : [];
  ctx.page('반 상세', html`${pageTitle(c.name, daysLabel(c) + (c.start_time ? ` · ${c.start_time}${c.end_time ? '~' + c.end_time : ''}` : ''), ['반 관리', '/admin/classes'])}
  <div class="card"><h3>수업 일정</h3>
    ${sess.length ? html`<div class="list">${sess.map(s => html`<div><div class="row-m"><b>${korDay(s.date)}${s.kind === 'makeup' ? ' · 보강' : ''}</b><span>${s.date === t ? '오늘' : s.date < t ? '지난 수업' : '예정'}${s.canceled ? ' · 휴강' : s.nc ? ` · 체크 ${s.nc}명` : ''}</span></div>
      <div class="row-r">${!s.canceled && s.date <= t ? html`<a class="btn sm ghost" href="/sessions/${s.id}">${icon('doc')}출석 체크</a>` : ''}
      <form method="post" action="/sessions/${s.id}/cancel">${csrfField(ctx)}<input type="hidden" name="v" value="${s.canceled ? 0 : 1}"><button class="btn sm gray">${s.canceled ? '휴강 취소' : '휴강'}</button></form></div></div>`)}</div>`
    : empty('예정된 수업이 없어요', '아래 반 정보에서 수업 요일을 정해 주세요.')}
    <details class="mt8"><summary class="btn gray full">${icon('cal')}보강 수업 추가</summary>
      <form method="post" action="/classes/${c.id}/makeup" class="flex mt8">${csrfField(ctx)}<input type="date" name="date" required value="${t}"><button class="btn sm">추가</button></form></details>
  </div>
  <div class="card"><h3>학생 <small>${studs.length}명</small></h3>
    ${studs.length ? html`<div class="list">${studs.map(s => html`<div><div class="row-m"><a href="/students/${s.id}"><b>${s.name}</b></a><span>${s.school || ''} · ${s.grade || ''}</span></div>
      <form method="post" action="/classes/${c.id}/students/remove">${csrfField(ctx)}<input type="hidden" name="uid" value="${s.id}"><button class="btn sm ghost">${icon('userminus')}제외</button></form></div>`)}</div>` : empty('아직 학생이 없어요')}
    <span class="lbl mt12">학생 추가</span>
    <form method="get" class="flex"><input type="search" name="q" value="${q}" placeholder="이름 또는 학교로 검색"><button class="btn sm dark">${icon('search')}</button></form>
    ${q ? (cand.length ? html`<div class="list mt8">${cand.map(s => html`<div><div class="row-m"><b>${s.name}</b><span>${s.school || ''} · ${s.grade || ''}</span></div>
      <form method="post" action="/classes/${c.id}/students/add">${csrfField(ctx)}<input type="hidden" name="uid" value="${s.id}"><button class="btn sm">${icon('plus')}추가</button></form></div>`)}</div>` : html`<p class="small muted">검색 결과가 없어요.</p>`) : ''}
  </div>
  <h2 class="sec">반 정보 수정</h2>
  ${classForm(ctx, c, `/classes/${c.id}`)}
  <form method="post" action="/classes/${c.id}/delete" class="mt12" data-confirm="이 반을 삭제할까요? 출결 기록도 함께 삭제됩니다.">${csrfField(ctx)}<button class="btn danger full">${icon('trash')}반 삭제</button></form>`);
});
post('/classes/:id', 'staff', ctx => {
  const id = Number(ctx.params.id); const old = one('SELECT * FROM classes WHERE id=?', id) || notFound();
  const c = readClass(ctx.body);
  tx(() => {
    run('UPDATE classes SET name=?,branch_id=?,days=?,start_time=?,end_time=?,start_date=?,end_date=?,memo=?,active=? WHERE id=?', c.name, c.branch_id, c.days, c.start_time, c.end_time, c.start_date, c.end_date, c.memo, c.active, id);
    run('DELETE FROM class_coaches WHERE class_id=?', id);
    for (const u of c.coaches) run('INSERT OR IGNORE INTO class_coaches VALUES(?,?)', id, u);
  });
  if (old.days !== c.days || old.start_date !== c.start_date || old.end_date !== c.end_date || old.active !== c.active) regenerateFuture(id);
  ctx.redirect(`/classes/${id}`, '저장했어요.');
});
post('/classes/:id/delete', 'staff', ctx => { run('DELETE FROM classes WHERE id=?', ctx.params.id); ctx.redirect('/admin/classes', '반을 삭제했어요.'); });
post('/classes/:id/students/add', 'staff', ctx => { run('INSERT OR IGNORE INTO class_students VALUES(?,?)', ctx.params.id, ctx.body.uid); ctx.redirect(`/classes/${ctx.params.id}`, '학생을 추가했어요.'); });
post('/classes/:id/students/remove', 'staff', ctx => { run('DELETE FROM class_students WHERE class_id=? AND user_id=?', ctx.params.id, ctx.body.uid); ctx.redirect(`/classes/${ctx.params.id}`, '반에서 제외했어요.'); });
post('/classes/:id/makeup', 'staff', ctx => {
  if (!isValidDate(ctx.body.date)) bad('날짜를 확인해 주세요.');
  run(`INSERT OR IGNORE INTO class_sessions(class_id,date,kind) VALUES(?,?,'makeup')`, ctx.params.id, ctx.body.date);
  ctx.redirect(`/classes/${ctx.params.id}`, '보강 수업을 추가했어요.');
});
post('/sessions/:id/cancel', 'staff', ctx => {
  const s = one('SELECT * FROM class_sessions WHERE id=?', ctx.params.id) || notFound();
  run('UPDATE class_sessions SET canceled=? WHERE id=?', ctx.body.v === '1' ? 1 : 0, s.id);
  ctx.back(ctx.body.v === '1' ? '휴강으로 바꿨어요.' : '휴강을 취소했어요.');
});

// ---------- 출석 체크 ----------
get('/sessions/:id', 'staff', ctx => {
  const s = one('SELECT s.*, c.name class_name FROM class_sessions s JOIN classes c ON c.id=s.class_id WHERE s.id=?', ctx.params.id) || notFound();
  const studs = all(`SELECT u.id,u.name,u.school,u.grade,a.status,a.memo FROM class_students cs JOIN users u ON u.id=cs.user_id
    LEFT JOIN attendance a ON a.session_id=? AND a.student_id=u.id WHERE cs.class_id=? AND u.status='approved' ORDER BY u.name`, s.id, s.class_id);
  // 반에서 빠졌지만 기록이 남은 학생도 표시
  const extra = all(`SELECT u.id,u.name,u.school,u.grade,a.status,a.memo FROM attendance a JOIN users u ON u.id=a.student_id WHERE a.session_id=? AND u.id NOT IN (SELECT user_id FROM class_students WHERE class_id=?)`, s.id, s.class_id);
  const list = [...studs, ...extra];
  const cnt = st => list.filter(x => x.status === st).length;
  const un = list.filter(x => !x.status).length;
  ctx.page('출석 체크', html`${pageTitle(`${s.class_name} 출석 체크`, korDay(s.date) + (s.kind === 'makeup' ? ' · 보강' : ''), ['오늘 수업', '/coach'])}
  ${s.canceled ? html`<div class="note">${icon('info')}휴강으로 표시된 수업이에요. 출석률 계산에서 빠집니다.</div>` : ''}
  <div class="chips mb8" id="attSum" style="margin-bottom:14px">
    <span class="chip green">${icon('checkc')}출석 <b data-c="present">${cnt('present')}</b></span><span class="chip amber">${icon('clock')}지각 <b data-c="late">${cnt('late')}</b></span>
    <span class="chip red">${icon('xc')}결석 <b data-c="absent">${cnt('absent')}</b></span><span class="chip blue">${icon('doc')}공결 <b data-c="excused">${cnt('excused')}</b></span>
    <span class="chip">미체크 <b data-c="none">${un}</b></span></div>
  ${list.length ? list.map(x => html`<div class="att-card" data-att="${x.id}" data-status="${x.status || ''}">
    <div class="nm">${x.name}<small>${x.school || ''} ${x.grade || ''}</small></div>
    <div class="att-btns">${[['present', 'checkc'], ['late', 'clock'], ['absent', 'xc'], ['excused', 'doc']].map(([st, ic]) => html`<button type="button" class="${st} ${x.status === st ? 'on' : ''}" data-v="${st}">${icon(ic)}${ATT_LABEL[st]}</button>`)}</div>
    <div class="att-memo" ${x.status && x.status !== 'present' ? '' : 'hidden'}><input type="text" placeholder="사유 메모 (선택) · 학부모 알림에 함께 표시됩니다" value="${x.memo || ''}" data-memo></div>
  </div>`) : empty('이 반에 학생이 없어요', '반 상세에서 학생을 추가해 주세요.')}
  <div class="sticky-bottom"><form method="post" action="/sessions/${s.id}/all-present">${csrfField(ctx)}<button class="btn full" ${un ? '' : 'disabled'}>${icon('checks')}미체크 ${un}명 전체 출석</button></form></div>
  <script>window.ATT={url:'/sessions/${s.id}/mark',csrf:'${ctx.csrf}'}</script>`);
});
function markAttendance(sessionId, studentId, status, memo, by) {
  const prev = one('SELECT status FROM attendance WHERE session_id=? AND student_id=?', sessionId, studentId);
  if (!status) { run('DELETE FROM attendance WHERE session_id=? AND student_id=?', sessionId, studentId); return; }
  run(`INSERT INTO attendance(session_id,student_id,status,memo,checked_by,updated_at) VALUES(?,?,?,?,?,datetime('now'))
    ON CONFLICT(session_id,student_id) DO UPDATE SET status=excluded.status, memo=excluded.memo, checked_by=excluded.checked_by, updated_at=excluded.updated_at`, sessionId, studentId, status, memo || null, by);
  if (status !== 'present' && prev?.status !== status) {
    const s = one('SELECT s.date, c.name FROM class_sessions s JOIN classes c ON c.id=s.class_id WHERE s.id=?', sessionId);
    const stu = one('SELECT name FROM users WHERE id=?', studentId);
    notify(parentIdsOf(studentId), 'attendance', `[${ATT_LABEL[status]}] ${stu.name} · ${korDay(s.date)}`, `${s.name}${memo ? ' · ' + memo : ''}`, `/students/${studentId}`);
  }
}
post('/sessions/:id/mark', 'staff', ctx => {
  const s = one('SELECT * FROM class_sessions WHERE id=?', ctx.params.id) || notFound();
  const { student_id, status, memo } = ctx.body;
  if (status && !ATT_LABEL[status]) bad('잘못된 출결 상태');
  markAttendance(s.id, Number(student_id), status || null, memo, ctx.user.id);
  ctx.json({ ok: true });
});
post('/sessions/:id/all-present', 'staff', ctx => {
  const s = one('SELECT * FROM class_sessions WHERE id=?', ctx.params.id) || notFound();
  const un = all(`SELECT user_id FROM class_students WHERE class_id=? AND user_id NOT IN (SELECT student_id FROM attendance WHERE session_id=?)`, s.class_id, s.id);
  tx(() => { for (const r of un) markAttendance(s.id, r.user_id, 'present', null, ctx.user.id); });
  ctx.redirect(`/sessions/${s.id}`, `${un.length}명을 출석으로 체크했어요.`);
});

// ---------- 직원 출근 ----------
get('/admin/staff-attendance', 'staff', ctx => {
  const d = isValidDate(ctx.query.d) ? ctx.query.d : today();
  const filter = ctx.query.s === 'absent' ? 'absent' : 'all';
  const staff = all(`SELECT u.id,u.name,u.role,sa.status,sa.reason FROM users u LEFT JOIN staff_attendance sa ON sa.user_id=u.id AND sa.date=?
    WHERE u.role IN ('owner','vice','coach') AND u.status='approved' ORDER BY CASE u.role WHEN 'owner' THEN 0 WHEN 'vice' THEN 1 ELSE 2 END, u.name`, d);
  const p = staff.filter(s => s.status === 'present').length, a = staff.filter(s => s.status === 'absent').length;
  const shown = filter === 'absent' ? staff.filter(s => s.status === 'absent') : staff;
  const t = today();
  ctx.page('직원 출근', html`${pageTitle('직원 출근', '원장·부원장·강사가 매일 출근 또는 결석을 남기고, 결석이면 사유를 적어요. 학생 출결과는 따로 관리돼요.', ['홈', '/admin'])}
  <div class="mnav"><a class="btn sm ghost" href="?d=${addDays(d, -1)}">${icon('left')}이전 날</a><b>${korDay(d)}${d === t ? html` <em>오늘</em>` : ''}</b>
    ${d < t ? html`<a class="btn sm ghost" href="?d=${addDays(d, 1)}">다음 날${icon('right')}</a>` : html`<span class="btn sm ghost dis">다음 날${icon('right')}</span>`}</div>
  <p class="small"><b>출근 ${p}</b> · 결석 ${a} · 미체크 ${staff.length - p - a} / 전체 ${staff.length}명</p>
  ${pills([['전체', `?d=${d}`, 'all'], [`결석 ${a}`, `?d=${d}&s=absent`, 'absent']], filter)}
  ${shown.length ? html`<div class="list">${shown.map(s => {
    const me = s.id === ctx.user.id;
    return html`<div style="display:block"><div class="flex between"><div class="row-m"><b>${s.name}${me ? html` <span class="muted small">(나)</span>` : ''}</b><span>${ROLE_LABEL[s.role]}</span></div>
      ${s.status === 'present' ? chip(html`${icon('check')}출근`, 'green') : s.status === 'absent' ? chip('결석', 'red') : chip('미체크')}</div>
      ${s.reason ? html`<p class="small muted mt8 mb0">사유: ${s.reason}</p>` : ''}
      <form method="post" action="/admin/staff-attendance" class="flex mt8 wrapf">${csrfField(ctx)}<input type="hidden" name="uid" value="${s.id}"><input type="hidden" name="d" value="${d}">
        <button class="btn sm ${s.status === 'present' ? '' : 'ghost'}" name="status" value="present">${icon('checkc')}출근</button>
        <input type="text" name="reason" placeholder="결석 사유" style="height:34px;flex:1;min-width:120px" value="${s.reason || ''}">
        <button class="btn sm ${s.status === 'absent' ? '' : 'ghost'}" name="status" value="absent">${icon('xc')}결석</button>
        ${s.status ? html`<button class="btn sm gray" name="status" value="">지우기</button>` : ''}</form></div>`;
  })}</div>` : empty('결석한 직원이 없어요')}`);
});
post('/admin/staff-attendance', 'staff', ctx => {
  const { uid, d, status, reason } = ctx.body;
  if (!isValidDate(d)) bad('날짜 오류');
  if (!status) run('DELETE FROM staff_attendance WHERE date=? AND user_id=?', d, uid);
  else {
    if (status === 'absent' && !(reason || '').trim()) bad('결석 사유를 적어 주세요.');
    run(`INSERT INTO staff_attendance(date,user_id,status,reason) VALUES(?,?,?,?) ON CONFLICT(date,user_id) DO UPDATE SET status=excluded.status, reason=excluded.reason, updated_at=datetime('now')`, d, uid, status, status === 'absent' ? reason.trim() : null);
  }
  ctx.redirect(`/admin/staff-attendance?d=${d}`, '저장했어요.');
});
