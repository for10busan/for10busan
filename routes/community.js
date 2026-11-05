// 순위 · 실기 기록 입력 · 캘린더
import { get, post, notFound, bad } from '../lib/router.js';
import { one, all, run, tx } from '../lib/db.js';
import { html, icon, pageTitle, empty, csrfField, pills, chip, monthNav } from '../lib/html.js';
import { thisMonth, isValidMonth, korMonth, korDay, monthDays, weekday, today, isStaff, maskName, num, fmtNum, isValidDate, WEEKDAYS } from '../lib/util.js';
import { keysForMonth, branches, notify } from '../lib/services.js';
import { exCategory, EX_CATS, TEST_HIDE } from '../lib/admissions.js';
const testExercises = () => all('SELECT * FROM exercises WHERE active=1 ORDER BY sort,id').filter(e => !TEST_HIDE.includes(e.name));

// 종목 고르기: 도약 · 런 · 구기 · 기타 탭 → 그 안의 종목
function exPicker(exs, cur, href) {
  const by = Object.fromEntries(EX_CATS.map(c => [c, exs.filter(x => exCategory(x.name) === c)]));
  const curCat = exCategory(cur?.name);
  return html`<div class="expick card">
    <div class="expick-tabs" role="tablist">${EX_CATS.filter(c => by[c].length).map(c => html`<button type="button" role="tab" class="${c === curCat ? 'on' : ''}" data-cat="${c}" aria-selected="${c === curCat}">${c} 종목<small>${by[c].length}</small></button>`)}</div>
    ${EX_CATS.filter(c => by[c].length).map(c => html`<div class="expick-g" data-g="${c}" ${c === curCat ? '' : 'hidden'}>${by[c].map(x => html`<a class="pill ${x.id === cur?.id ? 'on' : ''}" href="${href(x)}">${x.name}</a>`)}</div>`)}
    ${cur ? html`<p class="expick-now">선택한 종목 <b>${cur.name}</b>${cur.unit ? html` <span class="muted">(${cur.unit})</span>` : ''}</p>` : ''}
    <script>(()=>{const r=document.currentScript.parentElement;r.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{r.querySelectorAll('[data-cat]').forEach(x=>{x.classList.toggle('on',x===b);x.setAttribute('aria-selected',x===b)});r.querySelectorAll('[data-g]').forEach(g=>g.hidden=g.dataset.g!==b.dataset.cat)})})()</script>
  </div>`;
}

const MEDAL = ['🥇', '🥈', '🥉'];
function nameFor(ctx, r) { return isStaff(ctx.user) || r.id === ctx.user.id ? r.name : maskName(r.name); }
function branchPills(ctx, base, cur, extra = '') {
  const br = branches(); if (br.length < 2) return '';
  return pills([['전체', `${base}${extra}`, 'all'], ...br.map(b => [b.name, `${base}${extra}${extra ? '&' : base.includes('?') ? '&' : '?'}b=${b.id}`, String(b.id)])], cur);
}

get('/ranking', 'user', ctx => {
  const view = ctx.query.v === 'test' ? 'test' : 'keys';
  const ym = isValidMonth(ctx.query.m) ? ctx.query.m : thisMonth();
  const b = ctx.query.b ? Number(ctx.query.b) : null;
  const seg = html`<div class="pills"><a class="pill ${view === 'keys' ? 'on' : ''}" href="/ranking">K 열쇠</a><a class="pill ${view === 'test' ? 'on' : ''}" href="/ranking?v=test">월별 실기 테스트</a></div>`;
  const bq = b ? `&b=${b}` : '';
  if (view === 'keys') {
    const rows = keysForMonth(ym, b);
    ctx.page('순위', html`${pageTitle('순위', '운동일지를 쓰면 1개, 출석하면 1개! 같은 날 둘 다 하면 K 열쇠 2개. 한 달 동안 모은 열쇠로 순위를 매겨요.')}${seg}
    ${monthNav('/ranking', ym, thisMonth(), bq)}
    ${branchPills(ctx, `/ranking?m=${ym}`, b ? String(b) : 'all')}
    ${rows.length ? html`<div class="list">${rows.map(r => html`<div style="${r.id === ctx.user.id ? 'background:#fff7f7' : ''}"><span class="medal">${r.rank <= 3 ? MEDAL[r.rank - 1] : r.rank}</span>
      <div class="row-m"><b>${nameFor(ctx, r)}${r.branch ? html`<span class="muted small" style="display:inline"> · ${r.branch}</span>` : ''}</b><span>일지 ${r.logs} · 출석 ${r.att}</span></div>
      <span class="kcount"><img src="/img/mark-white.png" alt="">${r.keys}</span></div>`)}</div>`
      : empty('아직 열쇠를 모은 학생이 없어요', '일지를 쓰거나 출석하면 순위가 생겨요.')}
    <div class="card"><h3>열쇠는 이렇게 받아요</h3><ul class="small mt0" style="padding-left:18px"><li>운동일지를 쓴 날 1개</li><li>출석(지각 포함)한 날 1개</li></ul>
      <p class="small muted mb0">같은 날 일지도 쓰고 출석도 하면 2개를 모두 받아요. 같은 종류는 하루에 한 번만 세서 하루에 최대 2개까지 모을 수 있어요. 순위는 매월 1일에 새로 시작해요. 이름은 가운데 글자를 가려서 보여요.</p></div>`);
    return;
  }
  const exs = testExercises();
  const e = exs.find(x => x.id === Number(ctx.query.e)) || exs[0];
  if (!e) return ctx.page('순위', html`${pageTitle('순위')}${seg}${empty('종목이 없어요')}`);
  const rows = all(`SELECT u.id,u.name,bb.name branch, mt.record FROM monthly_tests mt JOIN users u ON u.id=mt.student_id LEFT JOIN branches bb ON bb.id=u.branch_id
    WHERE mt.month=? AND mt.exercise_id=? ${b ? 'AND u.branch_id=?' : ''} ORDER BY mt.record ${e.higher_better ? 'DESC' : 'ASC'}`, ym, e.id, ...(b ? [b] : []));
  let rank = 0, prev = null; rows.forEach((r, i) => { if (r.record !== prev) { rank = i + 1; prev = r.record; } r.rank = rank; });
  ctx.page('순위', html`${pageTitle('순위', '매달 학원에서 치르는 실기 테스트 기록으로 종목별 순위를 매겨요.')}${seg}
  ${monthNav('/ranking?v=test', ym, thisMonth(), `&e=${e.id}${bq}`)}
  ${branchPills(ctx, `/ranking?v=test&m=${ym}&e=${e.id}`, b ? String(b) : 'all')}
  ${exPicker(exs, e, x => `/ranking?v=test&m=${ym}&e=${x.id}${bq}`)}
  ${isStaff(ctx.user) ? html`<a class="btn ghost full mb8" href="/ranking/entry?e=${e.id}&m=${ym}">${icon('doc')}${korMonth(ym)} ${e.name} 기록 입력</a>` : ''}
  ${rows.length ? html`<div class="list">${rows.map(r => html`<div style="${r.id === ctx.user.id ? 'background:#fff7f7' : ''}"><span class="medal">${r.rank <= 3 ? MEDAL[r.rank - 1] : r.rank}</span>
    <div class="row-m"><b>${nameFor(ctx, r)}</b>${r.branch ? html`<span>${r.branch}</span>` : ''}</div><b>${fmtNum(r.record)}${e.unit}</b></div>`)}</div>`
    : empty(`${korMonth(ym)} ${e.name} 기록이 아직 없어요`, isStaff(ctx.user) ? '위 버튼으로 기록을 입력해 주세요.' : '')}
  <p class="small muted">${e.higher_better ? '기록이 클수록' : '기록이 작을수록'} 순위가 높아요.</p>`);
});

get('/ranking/entry', 'staff', ctx => {
  const ym = isValidMonth(ctx.query.m) ? ctx.query.m : thisMonth();
  const exs = testExercises();
  const e = exs.find(x => x.id === Number(ctx.query.e)) || exs[0] || notFound('종목이 없어요');
  const q = (ctx.query.q || '').trim();
  const studs = all(`SELECT u.id,u.name,bb.name branch, mt.record FROM users u LEFT JOIN branches bb ON bb.id=u.branch_id LEFT JOIN monthly_tests mt ON mt.student_id=u.id AND mt.month=? AND mt.exercise_id=?
    WHERE u.role='student' AND u.status='approved' ${q ? 'AND u.name LIKE ?' : ''} ORDER BY bb.sort, u.name`, ym, e.id, ...(q ? [`%${q}%`] : []));
  const groups = {}; for (const s of studs) (groups[s.branch || '지점 미지정'] ||= []).push(s);
  ctx.page('실기 기록 입력', html`${pageTitle('실기 테스트 기록 입력', '학생마다 이번 달 기록을 적고 저장하세요. 칸을 비우고 저장하면 그 학생의 기록이 지워져요.', ['순위', `/ranking?v=test&m=${ym}&e=${e.id}`])}
  ${monthNav(`/ranking/entry?e=${e.id}`, ym, thisMonth())}
  ${exPicker(exs, e, x => `/ranking/entry?e=${x.id}&m=${ym}`)}
  <form class="mb8"><input type="hidden" name="e" value="${e.id}"><input type="hidden" name="m" value="${ym}"><input type="search" name="q" value="${q}" placeholder="학생 이름 검색"></form>
  <form method="post" action="/ranking/entry" id="entry">${csrfField(ctx)}<input type="hidden" name="e" value="${e.id}"><input type="hidden" name="m" value="${ym}">
  ${Object.entries(groups).map(([g, ss]) => html`<p class="small b">${g} · ${ss.length}명</p><div class="list">${ss.map(s => html`<div><div class="row-m"><b>${s.name}</b></div>
    <input type="number" step="any" name="r_${s.id}" value="${s.record ?? ''}" data-orig="${s.record ?? ''}" placeholder="—" style="width:110px;height:38px;text-align:right"><span class="small muted" style="width:24px">${e.unit}</span></div>`)}</div>`)}
  ${studs.length ? '' : empty('학생이 없어요')}
  <div class="sticky-bottom"><div><button class="btn full" id="saveEntry" disabled>${icon('save')}<span>변경한 기록이 없어요</span></button></div></div></form>
  <script>(()=>{const f=document.getElementById('entry'),b=document.getElementById('saveEntry');const upd=()=>{const n=[...f.querySelectorAll('[data-orig]')].filter(i=>i.value!==i.dataset.orig).length;b.disabled=!n;b.lastChild.textContent=n?n+'명 저장':'변경한 기록이 없어요'};f.addEventListener('input',upd)})()</script>`, { active: '/ranking/entry' });
});
post('/ranking/entry', 'staff', ctx => {
  const b = ctx.body; const ym = isValidMonth(b.m) ? b.m : bad('월 오류'); const eid = Number(b.e);
  let n = 0;
  tx(() => {
    for (const [k, v] of Object.entries(b)) {
      const m = /^r_(\d+)$/.exec(k); if (!m) continue;
      const val = num(v); const cur = one('SELECT record FROM monthly_tests WHERE month=? AND exercise_id=? AND student_id=?', ym, eid, m[1]);
      if (val == null) { if (cur) { run('DELETE FROM monthly_tests WHERE month=? AND exercise_id=? AND student_id=?', ym, eid, m[1]); n++; } }
      else if (!cur || cur.record !== val) { run('INSERT INTO monthly_tests(month,exercise_id,student_id,record) VALUES(?,?,?,?) ON CONFLICT(month,exercise_id,student_id) DO UPDATE SET record=excluded.record', ym, eid, m[1], val); n++; }
    }
  });
  ctx.redirect(`/ranking/entry?e=${eid}&m=${ym}`, `${n}명 기록을 저장했어요.`);
});

// ---------- 캘린더 ----------
get('/calendar', 'user', ctx => {
  const ym = isValidMonth(ctx.query.m) ? ctx.query.m : thisMonth();
  const br = branches(); const b = ctx.query.b ? Number(ctx.query.b) : null;
  const staff = isStaff(ctx.user);
  const evs = all(`SELECT e.*, bb.name branch FROM events e LEFT JOIN branches bb ON bb.id=e.branch_id WHERE e.start_date<=? AND e.end_date>=? ${b ? 'AND (e.branch_id IS NULL OR e.branch_id=?)' : ''} ORDER BY e.start_date, e.id`, `${ym}-31`, `${ym}-01`, ...(b ? [b] : []));
  const bds = all(`SELECT u.name, u.birthday, bb.name branch FROM users u LEFT JOIN branches bb ON bb.id=u.branch_id WHERE u.role='student' AND u.status='approved' AND u.birthday IS NOT NULL AND substr(u.birthday,6,2)=? ${b ? 'AND u.branch_id=?' : ''}`, ym.slice(5), ...(b ? [b] : []));
  const days = monthDays(ym), first = weekday(`${ym}-01`), t = today();
  const byDay = {};
  for (let d = 1; d <= days; d++) {
    const ds = `${ym}-${String(d).padStart(2, '0')}`;
    byDay[ds] = { ev: evs.filter(e => e.start_date <= ds && e.end_date >= ds), bd: bds.filter(x => x.birthday.slice(5) === ds.slice(5)) };
  }
  const cells = []; for (let i = 0; i < first; i++) cells.push(html`<span></span>`);
  for (let d = 1; d <= days; d++) {
    const ds = `${ym}-${String(d).padStart(2, '0')}`; const x = byDay[ds]; const wd = (first + d - 1) % 7;
    cells.push(html`<a class="d ${ds === t ? 'today' : ''}" href="#d-${ds}"><span class="n ${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''}">${d}</span>${x.ev.slice(0, 2).map(e => html`<span class="ev ${e.kind === 'test' ? '' : 'k'}">${e.title}</span>`)}${x.ev.length > 2 ? html`<span class="more">+${x.ev.length - 2}</span>` : ''}${x.bd.length ? html`<span class="bd">🎂${x.bd.length}</span>` : ''}</a>`);
  }
  const listDays = Object.entries(byDay).filter(([ds, x]) => x.bd.length || x.ev.some(e => e.start_date === ds || (ds === `${ym}-01` && e.start_date < ds)));
  const edit = staff && ctx.query.edit ? one('SELECT * FROM events WHERE id=?', ctx.query.edit) : null;
  const bq = b ? `&b=${b}` : '';
  ctx.page('캘린더', html`${pageTitle('캘린더', '실기 테스트·주요 일정과 친구들 생일을 한눈에 봐요.')}
  ${monthNav('/calendar', ym, '9999-12', bq)}
  ${br.length > 1 ? pills([['전체', `/calendar?m=${ym}`, 'all'], ...br.map(x => [x.name, `/calendar?m=${ym}&b=${x.id}`, String(x.id)])], b ? String(b) : 'all') : ''}
  ${staff ? html`<details class="card" ${edit ? 'open' : ''}><summary class="btn full" style="display:flex">${icon('plus')}${edit ? '일정 고치기' : '실기 테스트·주요 일정 추가'}</summary>
    <form method="post" action="/calendar${edit ? '/' + edit.id : ''}" class="mt12">${csrfField(ctx)}
      <div class="seg"><label><input type="radio" name="kind" value="test" ${(edit?.kind || 'test') === 'test' ? 'checked' : ''}><span>${icon('doc')} 실기 테스트</span></label><label><input type="radio" name="kind" value="event" ${edit?.kind === 'event' ? 'checked' : ''}><span>${icon('cal')} 주요 일정</span></label></div>
      <label class="field"><span>제목</span><input type="text" name="title" value="${edit?.title || ''}" required placeholder="예: 11월 실기 테스트 (제멀·메디신)"></label>
      <div class="row2"><label class="field"><span>날짜</span><input type="date" name="start_date" value="${edit?.start_date || t}" required></label><label class="field"><span>끝나는 날 (하루면 같게)</span><input type="date" name="end_date" value="${edit?.end_date || t}"></label></div>
      ${br.length ? html`<label class="field"><span>지점</span><select name="branch_id"><option value="">전체 지점</option>${br.map(x => html`<option value="${x.id}" ${edit?.branch_id === x.id ? 'selected' : ''}>${x.name}</option>`)}</select></label>` : ''}
      <label class="field"><span>메모 (선택)</span><textarea name="memo" rows="2" placeholder="예: 오후 2시 본관 체육관, 운동화 준비">${edit?.memo || ''}</textarea></label>
      <label class="check"><input type="checkbox" name="notify" ${edit ? '' : 'checked'}><span>학생·학부모에게 알림 보내기</span></label>
      <button class="btn full">${icon(edit ? 'save' : 'plus')}${edit ? '저장' : '일정 추가'}</button></form></details>` : ''}
  <div class="card"><div class="cal big">${WEEKDAYS.map(w => html`<span class="wd">${w}</span>`)}${cells}</div></div>
  ${listDays.length ? listDays.map(([ds, x]) => html`<h2 class="sec" id="d-${ds}">${korDay(ds)}</h2>
    ${x.ev.filter(e => e.start_date === ds || (ds === `${ym}-01` && e.start_date < ds)).map(e => html`<div class="card"><div class="flex between">${chip(e.kind === 'test' ? '실기 테스트' : '주요 일정', e.kind === 'test' ? 'red' : 'dark')}
      ${staff ? html`<div class="flex"><a class="btn xs ghost" href="/calendar?m=${ym}&edit=${e.id}">고치기</a><form method="post" action="/calendar/${e.id}/delete" data-confirm="이 일정을 지울까요?">${csrfField(ctx)}<button class="btn xs gray">지우기</button></form></div>` : ''}</div>
      <b style="display:block;margin-top:8px">${e.title}</b><p class="small muted mb0">${korDay(e.start_date)}${e.end_date !== e.start_date ? ' ~ ' + korDay(e.end_date) : ''} · ${e.branch || '전체 지점'}</p>${e.memo ? html`<p class="small mb0" style="white-space:pre-wrap">${e.memo}</p>` : ''}</div>`)}
    ${x.bd.map(p => html`<div class="card flex">${icon('cake', 'red')}<b>생일</b><span>${isStaff(ctx.user) ? p.name : maskName(p.name)}${p.branch ? ` · ${p.branch}` : ''}</span></div>`)}`) : empty('이 달에 일정이 없어요')}
  <p class="small muted">생일은 이름과 날짜만 보여요 (태어난 해는 보이지 않아요).</p>`);
});
function readEvent(b) {
  if (!(b.title || '').trim() || !isValidDate(b.start_date)) bad('제목과 날짜를 확인해 주세요.');
  const end = isValidDate(b.end_date) && b.end_date >= b.start_date ? b.end_date : b.start_date;
  return [b.kind === 'event' ? 'event' : 'test', b.title.trim(), b.start_date, end, Number(b.branch_id) || null, b.memo || null];
}
post('/calendar', 'staff', ctx => {
  const v = readEvent(ctx.body);
  run('INSERT INTO events(kind,title,start_date,end_date,branch_id,memo,created_by) VALUES(?,?,?,?,?,?,?)', ...v, ctx.user.id);
  if (ctx.body.notify) {
    const ids = all(`SELECT id FROM users WHERE role IN ('student','parent') AND status='approved' ${v[4] ? 'AND (branch_id IS NULL OR branch_id=?)' : ''}`, ...(v[4] ? [v[4]] : [])).map(r => r.id);
    notify(ids, 'event', `[${v[0] === 'test' ? '실기 테스트' : '일정'}] ${v[1]}`, korDay(v[2]) + (v[3] !== v[2] ? ' ~ ' + korDay(v[3]) : ''), `/calendar?m=${v[2].slice(0, 7)}`);
  }
  ctx.redirect(`/calendar?m=${v[2].slice(0, 7)}`, '일정을 추가했어요.');
});
post('/calendar/:id', 'staff', ctx => { const v = readEvent(ctx.body); run('UPDATE events SET kind=?,title=?,start_date=?,end_date=?,branch_id=?,memo=? WHERE id=?', ...v, ctx.params.id); ctx.redirect(`/calendar?m=${v[2].slice(0, 7)}`, '저장했어요.'); });
post('/calendar/:id/delete', 'staff', ctx => { const e = one('SELECT * FROM events WHERE id=?', ctx.params.id) || notFound(); run('DELETE FROM events WHERE id=?', e.id); ctx.redirect(`/calendar?m=${e.start_date.slice(0, 7)}`, '지웠어요.'); });
