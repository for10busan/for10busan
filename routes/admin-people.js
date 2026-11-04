import crypto from 'node:crypto';
import { get, post, notFound, bad } from '../lib/router.js';
import { one, all, run, getSetting, setSetting } from '../lib/db.js';
import { html, icon, pageTitle, empty, csrfField, pills, chip } from '../lib/html.js';
import { today, addDays, thisMonth, isValidMonth, korMonth, korDateTime, ROLE_LABEL, WEEKDAYS, int } from '../lib/util.js';
import { hashPassword } from '../lib/auth.js';
import { notify, branches, rate, ensureSessions } from '../lib/services.js';
import { longAbsent } from './admin-home.js';

// ---------- 출결 통계 ----------
function statsData(ym, classId) {
  const from = `${ym}-01`, to = `${ym}-31`;
  ensureSessions(from, today() < to ? today() : to);
  const classes = all('SELECT * FROM classes ORDER BY name');
  const byClass = classes.filter(c => !classId || c.id === classId).map(c => {
    const r = one(`SELECT COUNT(DISTINCT s.id) n, SUM(a.status='present') p, SUM(a.status='late') l, SUM(a.status='absent') ab, SUM(a.status='excused') ex, COUNT(a.status) checked,
      SUM(s.canceled) cn FROM class_sessions s LEFT JOIN attendance a ON a.session_id=s.id WHERE s.class_id=? AND s.date BETWEEN ? AND ? AND s.date<=?`, c.id, from, to, today());
    const nStud = one('SELECT COUNT(*) c FROM class_students WHERE class_id=?', c.id).c;
    const sessN = one(`SELECT COUNT(*) c FROM class_sessions WHERE class_id=? AND date BETWEEN ? AND ? AND date<=? AND canceled=0`, c.id, from, to, today()).c;
    const valid = one(`SELECT COUNT(*) c FROM attendance a JOIN class_sessions s ON s.id=a.session_id WHERE s.class_id=? AND s.date BETWEEN ? AND ? AND s.canceled=0`, c.id, from, to).c;
    return { id: c.id, name: c.name, n: sessN, p: r.p || 0, l: r.l || 0, a: r.ab || 0, e: r.ex || 0, un: Math.max(0, sessN * nStud - valid), rate: rate(r.p || 0, r.l || 0, valid) };
  });
  const students = all(`SELECT u.id,u.name,(SELECT GROUP_CONCAT(c.name, ', ') FROM class_students cs JOIN classes c ON c.id=cs.class_id WHERE cs.user_id=u.id) classes FROM users u WHERE role='student' AND status='approved'
    ${classId ? 'AND u.id IN (SELECT user_id FROM class_students WHERE class_id=?)' : ''} ORDER BY name`, ...(classId ? [classId] : [])).map(s => {
    const rows = all(`SELECT a.status FROM attendance a JOIN class_sessions ses ON ses.id=a.session_id WHERE a.student_id=? AND ses.date BETWEEN ? AND ? AND ses.canceled=0 ${classId ? 'AND ses.class_id=?' : ''} ORDER BY ses.date DESC`, s.id, from, to, ...(classId ? [classId] : []));
    let st = 0; for (const r of rows) { if (r.status === 'absent') st++; else break; }
    const p = rows.filter(r => r.status === 'present').length, l = rows.filter(r => r.status === 'late').length, a = rows.filter(r => r.status === 'absent').length;
    return { ...s, p, l, a, streak: st, rate: rate(p, l, rows.length) };
  });
  students.sort((x, y) => (x.rate ?? 101) - (y.rate ?? 101) || x.name.localeCompare(y.name, 'ko'));
  return { classes, byClass, students };
}
get('/admin/stats', 'staff', ctx => {
  const ym = isValidMonth(ctx.query.m) ? ctx.query.m : thisMonth();
  const classId = int(ctx.query.c, null);
  const { classes, byClass, students } = statsData(ym, classId);
  const streak = int(ctx.query.streak, 3), minRate = int(ctx.query.rate, 70);
  const la = longAbsent(30, streak, minRate);
  const cur = thisMonth();
  const [y, m] = ym.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`, next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  ctx.page('출결 통계', html`${pageTitle('출결 통계', '출석률 = (출석+지각) ÷ (체크된 수업 − 휴강). 아직 체크하지 않은 수업은 빼고 계산합니다.')}
  <form class="flex mb8" method="get"><a class="btn sm ghost" href="?m=${prev}${classId ? '&c=' + classId : ''}">${icon('left')}</a><b>${korMonth(ym)}</b>${ym < cur ? html`<a class="btn sm ghost" href="?m=${next}${classId ? '&c=' + classId : ''}">${icon('right')}</a>` : ''}
    <input type="hidden" name="m" value="${ym}"><select name="c" style="height:34px;flex:1"><option value="">전체 반</option>${classes.map(c => html`<option value="${c.id}" ${c.id === classId ? 'selected' : ''}>${c.name}</option>`)}</select><button class="btn sm gray">보기</button></form>
  <div class="row2 mb8"><a class="btn ghost" href="/admin/stats.csv?type=class&m=${ym}${classId ? '&c=' + classId : ''}">${icon('download')}반별 CSV</a><a class="btn ghost" href="/admin/stats.csv?type=student&m=${ym}${classId ? '&c=' + classId : ''}">${icon('download')}학생별 CSV</a></div>
  <div class="card mt12" id="long-absent"><h3>${icon('alert', 'amber')} 장기 결석자 · 최근 30일</h3>
    <form class="flex wrapf" method="get"><input type="hidden" name="m" value="${ym}">
      <label class="small">연속 결석 (회 이상)<input type="number" name="streak" value="${streak}" min="1" style="width:90px;height:38px"></label>
      <label class="small">또는 출석률 (% 미만)<input type="number" name="rate" value="${minRate}" min="1" max="100" style="width:90px;height:38px"></label>
      <button class="btn sm gray" style="align-self:flex-end">기준 적용</button></form>
    <p class="help">휴강은 연속 결석에서 건너뜁니다. 출석률 기준은 체크된 수업이 3회 이상일 때만 적용합니다. 기준은 이 화면에서만 쓰이고 저장되지 않습니다.</p>
    ${la.length ? html`<div class="list mb0">${la.map(s => html`<a href="/students/${s.id}"><div class="row-m"><b>${s.name}</b><span>연속 결석 ${s.streak}회 · 출석률 ${s.rate ?? '-'}%</span></div>${icon('right')}</a>`)}</div>` : empty('기준에 해당하는 학생이 없습니다')}
  </div>
  <div class="card"><h3>반별</h3><div class="scroll-x"><table class="tbl"><tr><th>반</th><th>수업</th><th>출석</th><th>지각</th><th>결석</th><th>공결</th><th>미체크</th><th>출석률</th></tr>
    ${byClass.map(r => html`<tr><td><a href="/classes/${r.id}">${r.name}</a></td><td>${r.n}</td><td>${r.p}</td><td>${r.l}</td><td>${r.a}</td><td>${r.e}</td><td>${r.un}</td><td>${r.rate == null ? '-' : r.rate + '%'}</td></tr>`)}</table></div></div>
  <div class="card"><h3>학생별 <small>출석률 낮은 순</small></h3><div class="scroll-x"><table class="tbl"><tr><th>학생</th><th>출석</th><th>지각</th><th>결석</th><th>연속 결석</th><th>출석률</th></tr>
    ${students.map(r => html`<tr><td><a href="/students/${r.id}">${r.name}</a><div class="small muted" style="max-width:220px">${r.classes || ''}</div></td><td>${r.p}</td><td>${r.l}</td><td>${r.a}</td><td>${r.streak}</td><td>${r.rate == null ? '-' : r.rate + '%'}</td></tr>`)}</table></div></div>`);
});
get('/admin/stats.csv', 'staff', ctx => {
  const ym = isValidMonth(ctx.query.m) ? ctx.query.m : thisMonth();
  const { byClass, students } = statsData(ym, int(ctx.query.c, null));
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  let rows;
  if (ctx.query.type === 'student') rows = [['학생', '반', '출석', '지각', '결석', '연속 결석', '출석률(%)'], ...students.map(r => [r.name, r.classes, r.p, r.l, r.a, r.streak, r.rate ?? ''])];
  else rows = [['반', '수업', '출석', '지각', '결석', '공결', '미체크', '출석률(%)'], ...byClass.map(r => [r.name, r.n, r.p, r.l, r.a, r.e, r.un, r.rate ?? ''])];
  const csv = '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n');
  const fn = encodeURIComponent(`출결_${ctx.query.type === 'student' ? '학생별' : '반별'}_${ym}.csv`);
  ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${fn}` });
  ctx.res.end(csv);
});

// ---------- 가입 승인 ----------
get('/admin/approvals', 'staff', ctx => {
  const rows = all(`SELECT u.*, b.name branch FROM users u LEFT JOIN branches b ON b.id=u.branch_id WHERE status='pending' ORDER BY u.created_at`);
  ctx.page('가입 승인', html`${pageTitle('가입 승인', '학원 수강생과 그 보호자인지 확인한 뒤 승인해 주세요. 오래된 신청부터 표시합니다.')}
  ${rows.length ? rows.map(u => html`<div class="card"><div class="flex between"><b>${u.name} <span class="muted small">· ${ROLE_LABEL[u.role]}</span></b><span class="small muted">${korDateTime(u.created_at)}</span></div>
    <p class="small muted mt8 mb0">${u.username ? "@" + u.username + " · " : ""}${u.email.endsWith("@id.for10") ? "" : u.email + " · "}${u.phone || "번호 없음"}${u.school ? ` · ${u.school} ${u.grade || ''}` : ''}${u.branch ? ` · ${u.branch}` : ''}</p>
    <form method="post" action="/admin/approvals/${u.id}" class="flex mt12">${csrfField(ctx)}<button class="btn sm grow" name="v" value="approve">${icon('check')}승인</button><button class="btn sm ghost" name="v" value="reject">거절</button></form></div>`)
    : empty('승인을 기다리는 가입 신청이 없습니다')}`);
});
post('/admin/approvals/:id', 'staff', ctx => {
  const u = one('SELECT * FROM users WHERE id=?', ctx.params.id) || notFound();
  const st = ctx.body.v === 'approve' ? 'approved' : 'rejected';
  run('UPDATE users SET status=? WHERE id=?', st, u.id);
  if (st === 'approved') notify(u.id, 'signup', '가입이 승인됐어요', '이제 앱을 이용할 수 있어요.', '/');
  ctx.redirect('/admin/approvals', `${u.name}님을 ${st === 'approved' ? '승인' : '거절'}했어요.`);
});

// ---------- 학부모 연결 승인 ----------
get('/admin/links', 'staff', ctx => {
  const rows = all(`SELECT pl.*, p.name pname, p.phone pphone, s.name sname, s.school, s.grade FROM parent_links pl JOIN users p ON p.id=pl.parent_id JOIN users s ON s.id=pl.student_id WHERE pl.status='pending' ORDER BY pl.created_at`);
  const linked = all(`SELECT pl.*, p.name pname, s.name sname FROM parent_links pl JOIN users p ON p.id=pl.parent_id JOIN users s ON s.id=pl.student_id WHERE pl.status='approved' ORDER BY s.name`);
  ctx.page('연결 승인', html`${pageTitle('학부모-학생 연결 승인', '실제 보호자가 맞는지 확인한 뒤 승인해 주세요. 승인하면 학부모가 자녀의 기록을 볼 수 있습니다.')}
  ${rows.length ? rows.map(r => html`<div class="card"><b>${r.pname}</b> <span class="muted">→</span> <b>${r.sname}</b><p class="small muted mt8 mb0">학부모 ${r.pphone || ''} · 학생 ${r.school || ''} ${r.grade || ''}</p>
    <form method="post" action="/admin/links/${r.id}" class="flex mt12">${csrfField(ctx)}<button class="btn sm grow" name="v" value="approve">${icon('check')}승인</button><button class="btn sm ghost" name="v" value="reject">거절</button></form></div>`)
    : empty('승인을 기다리는 연결 요청이 없습니다')}
  ${linked.length ? html`<h2 class="sec">연결된 학부모 <small>${linked.length}</small></h2><div class="list">${linked.map(r => html`<div><div class="row-m"><b>${r.sname}</b><span>학부모 ${r.pname}</span></div>
    <form method="post" action="/admin/links/${r.id}" data-confirm="연결을 해제할까요?">${csrfField(ctx)}<button class="btn xs ghost" name="v" value="remove">해제</button></form></div>`)}</div>` : ''}`);
});
post('/admin/links/:id', 'staff', ctx => {
  const l = one('SELECT * FROM parent_links WHERE id=?', ctx.params.id) || notFound();
  const v = ctx.body.v;
  if (v === 'remove') run('DELETE FROM parent_links WHERE id=?', l.id);
  else run('UPDATE parent_links SET status=? WHERE id=?', v === 'approve' ? 'approved' : 'rejected', l.id);
  const s = one('SELECT name FROM users WHERE id=?', l.student_id);
  if (v !== 'remove') notify(l.parent_id, 'link', v === 'approve' ? `${s.name} 학생과 연결됐어요` : `${s.name} 학생 연결 요청이 거절됐어요`, '', '/parent');
  ctx.redirect('/admin/links', '처리했어요.');
});

// ---------- 회원 관리 ----------
get('/admin/members', 'staff', ctx => {
  const br = branches();
  const b = ctx.query.b ?? 'all'; const r = ctx.query.r || 'all'; const q = (ctx.query.q || '').trim();
  const where = [`status!='rejected' OR 1`]; const p = [];
  let sql = `SELECT u.*, bb.name branch FROM users u LEFT JOIN branches bb ON bb.id=u.branch_id WHERE 1=1`;
  if (b === 'none') sql += ' AND u.branch_id IS NULL'; else if (b !== 'all') { sql += ' AND u.branch_id=?'; p.push(Number(b)); }
  if (r === 'student' || r === 'parent') { sql += ' AND u.role=?'; p.push(r); } else if (r === 'staff') sql += ` AND u.role IN ('owner','vice','coach')`;
  if (q) { sql += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.username LIKE ?)'; p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ` ORDER BY CASE u.role WHEN 'owner' THEN 0 WHEN 'vice' THEN 1 WHEN 'coach' THEN 2 WHEN 'student' THEN 3 ELSE 4 END, u.name`;
  const rows = all(sql, ...p); void where;
  const cntAll = one('SELECT COUNT(*) c FROM users').c;
  const cntB = id => one('SELECT COUNT(*) c FROM users WHERE branch_id=?', id).c;
  const cntNone = one('SELECT COUNT(*) c FROM users WHERE branch_id IS NULL').c;
  const qs = (k, v) => { const o = { b, r, q, [k]: v }; return '?' + new URLSearchParams(Object.entries(o).filter(([, x]) => x && x !== 'all')).toString(); };
  const temp = ctx.query.temp;
  ctx.page('회원 관리', html`${pageTitle('회원 관리', '지점별로 나눠 보고, 회원의 지점·역할·나오는 요일을 바꿀 수 있습니다.')}
  ${temp ? html`<div class="note blue">${icon('key')}<div>임시 비밀번호: <b style="font-size:16px;letter-spacing:1px">${temp}</b><br><span class="small">이 화면을 벗어나면 다시 볼 수 없어요. 본인에게 전달해 주세요. 로그인하면 새 비밀번호로 바꾸게 됩니다.</span></div></div>` : ''}
  <details class="card"><summary>직원 계정 만들기 (원장·부원장·강사)${icon('down')}</summary>
  <form method="post" action="/admin/members/staff">${csrfField(ctx)}
    <label class="field"><span>이름</span><input type="text" name="name" required></label>
    <label class="field"><span>직책</span><select name="role"><option value="coach">강사</option><option value="vice">부원장</option><option value="owner">원장</option></select>
      <small>직책은 표시용입니다. 원장·부원장·강사 모두 같은 권한(지표·기준값 수정, 가입 승인 등)을 가집니다.</small></label>
    <label class="field"><span>지점 (선택)</span><select name="branch_id"><option value="">지점 미지정 (모든 지점)</option>${br.map(x => html`<option value="${x.id}">${x.name}</option>`)}</select></label>
    <label class="field"><span>이메일</span><input type="email" name="email" required></label>
    <label class="field"><span>휴대폰 번호 (선택)</span><input type="tel" name="phone" placeholder="010-1234-5678"></label>
    <button class="btn full">직원 계정 만들기</button><p class="help">임시 비밀번호가 만들어져요. 첫 로그인 때 새 비밀번호로 바꾸게 됩니다.</p></form></details>
  <details class="card"><summary>지점 · 운영 설정${icon('down')}</summary>
    <span class="lbl">지점</span>
    ${br.map(x => html`<form method="post" action="/admin/branches/${x.id}" class="flex mb8">${csrfField(ctx)}<input type="text" name="name" value="${x.name}" required><button class="btn sm gray">이름 저장</button>${br.length > 1 ? html`<button class="btn sm danger" name="del" value="1" formnovalidate>삭제</button>` : ''}</form>`)}
    <form method="post" action="/admin/branches" class="flex">${csrfField(ctx)}<input type="text" name="name" placeholder="새 지점 이름" required><button class="btn sm">${icon('plus')}추가</button></form>
    <hr class="sep"><form method="post" action="/admin/settings" class="flex">${csrfField(ctx)}<label class="grow small">원본 영상 보관 기간 (일)<input type="number" name="video_retention_days" min="7" max="3650" value="${getSetting('video_retention_days', 90)}"></label><button class="btn sm gray" style="align-self:flex-end">저장</button></form>
    <p class="help">보관 기간이 지난 원본 영상은 자동 삭제되고, 관절 좌표와 분석 결과는 남아요. 새로 올리는 영상부터 적용돼요.</p></details>
  ${pills([[`전체 ${cntAll}`, qs('b', 'all'), 'all'], ...br.map(x => [`${x.name} ${cntB(x.id)}`, qs('b', String(x.id)), String(x.id)]), [`미지정 ${cntNone}`, qs('b', 'none'), 'none']], b)}
  ${pills([['모든 역할', qs('r', 'all'), 'all'], ['학생', qs('r', 'student'), 'student'], ['학부모', qs('r', 'parent'), 'parent'], ['직원', qs('r', 'staff'), 'staff']], r, 'dark')}
  <form class="flex mb8"><input type="hidden" name="b" value="${b}"><input type="hidden" name="r" value="${r}"><input type="search" name="q" value="${q}" placeholder="이름 또는 이메일 검색"><button class="btn sm gray" style="height:44px">검색</button></form>
  <p class="small b">${rows.length}명</p>
  <div class="list">${rows.map(u => html`<div style="display:block">
    <div class="flex between"><div class="row-m"><b>${u.name} <span class="muted small" style="display:inline">· ${ROLE_LABEL[u.role]}</span></b><span>${u.username ? "@" + u.username + " · " : ""}${u.email.endsWith("@id.for10") ? "" : u.email}${u.phone ? " · " + u.phone : ""}</span></div>
      ${u.status === 'approved' ? chip(html`${icon('checkc')}승인됨`, 'green') : u.status === 'pending' ? chip('대기', 'amber') : chip('거절', 'red')}</div>
    <form method="post" action="/admin/members/${u.id}" class="flex wrapf mt8" data-autosubmit>${csrfField(ctx)}
      ${['owner', 'vice', 'coach'].includes(u.role) ? html`<select name="role" style="height:34px;width:auto">${['owner', 'vice', 'coach'].map(x => html`<option value="${x}" ${u.role === x ? 'selected' : ''}>${ROLE_LABEL[x]}</option>`)}</select>` : ''}
      <select name="branch_id" style="height:34px;width:auto"><option value="">지점 미지정</option>${br.map(x => html`<option value="${x.id}" ${u.branch_id === x.id ? 'selected' : ''}>${x.name}</option>`)}</select>
      ${u.role === 'student' ? html`<span class="small muted">나오는 요일</span><div class="tg sq">${[1, 2, 3, 4, 5, 6, 0].map(d => html`<label><input type="checkbox" name="days[]" value="${d}" ${(u.attend_days || '').split(',').includes(String(d)) ? 'checked' : ''}><span style="width:32px;padding:5px 0">${WEEKDAYS[d]}</span></label>`)}</div>` : ''}
      <input type="hidden" name="_members" value="1">
    </form>
    <div class="flex mt8 wrapf">
      ${u.role === 'student' ? html`<a class="btn xs ghost" href="/students/${u.id}">학생 화면</a>` : ''}
      <form method="post" action="/admin/members/${u.id}/reset" data-confirm="${u.name}님의 임시 비밀번호를 만들까요?">${csrfField(ctx)}<button class="btn xs ghost">${icon('key')}비밀번호 초기화</button></form>
      ${u.id !== ctx.user.id ? html`<form method="post" action="/admin/members/${u.id}/delete" data-confirm="${u.name}님 계정과 모든 기록(일지·영상·출결)을 삭제할까요? 되돌릴 수 없어요.">${csrfField(ctx)}<button class="btn xs danger">${icon('trash')}삭제</button></form>` : ''}
    </div></div>`)}</div>`);
});
function tempPw() { return 'f10' + crypto.randomBytes(4).toString('hex'); }
post('/admin/members/staff', 'staff', ctx => {
  const b = ctx.body; const email = (b.email || '').trim().toLowerCase();
  if (!b.name || !email) bad('이름과 이메일을 입력해 주세요.');
  if (one('SELECT 1 FROM users WHERE email=?', email)) bad('이미 있는 이메일이에요.');
  const role = ['owner', 'vice', 'coach'].includes(b.role) ? b.role : 'coach';
  const pw = tempPw();
  run(`INSERT INTO users(email,password_hash,name,phone,role,status,branch_id,must_change_pw) VALUES(?,?,?,?,?,'approved',?,1)`, email, hashPassword(pw), b.name.trim(), b.phone || null, role, Number(b.branch_id) || null);
  ctx.redirect(`/admin/members?temp=${pw}`, `${b.name} 계정을 만들었어요.`);
});
post('/admin/members/:id', 'staff', ctx => {
  const u = one('SELECT * FROM users WHERE id=?', ctx.params.id) || notFound();
  const b = ctx.body;
  const role = ['owner', 'vice', 'coach'].includes(u.role) && ['owner', 'vice', 'coach'].includes(b.role) ? b.role : u.role;
  const days = u.role === 'student' ? [].concat(b.days || []).filter(d => /^[0-6]$/.test(d)).join(',') : u.attend_days;
  run('UPDATE users SET role=?, branch_id=?, attend_days=? WHERE id=?', role, Number(b.branch_id) || null, days, u.id);
  if (b._ajax) return ctx.json({ ok: true });
  ctx.back('저장했어요.');
});
post('/admin/members/:id/reset', 'staff', ctx => {
  const u = one('SELECT * FROM users WHERE id=?', ctx.params.id) || notFound();
  const pw = tempPw();
  run('UPDATE users SET password_hash=?, must_change_pw=1 WHERE id=?', hashPassword(pw), u.id);
  run('DELETE FROM sessions WHERE user_id=?', u.id);
  ctx.redirect(`/admin/members?q=${encodeURIComponent(u.name)}&temp=${pw}`, `${u.name}님 비밀번호를 초기화했어요.`);
});
post('/admin/members/:id/delete', 'staff', ctx => {
  const u = one('SELECT * FROM users WHERE id=?', ctx.params.id) || notFound();
  if (u.id === ctx.user.id) bad('본인 계정은 삭제할 수 없어요.');
  run('DELETE FROM users WHERE id=?', u.id);
  ctx.redirect('/admin/members', `${u.name}님 계정을 삭제했어요.`);
});

post('/admin/branches', 'staff', ctx => { const n = (ctx.body.name || '').trim(); if (!n) bad('지점 이름을 입력해 주세요.'); run('INSERT INTO branches(name,sort) VALUES(?,(SELECT COUNT(*) FROM branches))', n); ctx.redirect('/admin/members', '지점을 추가했어요.'); });
post('/admin/branches/:id', 'staff', ctx => {
  if (ctx.body.del) { if (one('SELECT COUNT(*) c FROM branches').c <= 1) bad('지점은 하나 이상 있어야 해요.'); run('DELETE FROM branches WHERE id=?', ctx.params.id); return ctx.redirect('/admin/members', '지점을 삭제했어요. 그 지점 회원은 지점 미지정이 됐어요.'); }
  run('UPDATE branches SET name=? WHERE id=?', (ctx.body.name || '').trim() || bad('이름을 입력해 주세요.'), ctx.params.id); ctx.redirect('/admin/members', '저장했어요.');
});
post('/admin/settings', 'staff', ctx => { const d = Number(ctx.body.video_retention_days); if (!(d >= 7 && d <= 3650)) bad('7~3650일 사이로 입력해 주세요.'); setSetting('video_retention_days', d); ctx.redirect('/admin/members', '저장했어요.'); });
