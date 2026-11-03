import { get, post, bad } from '../lib/router.js';
import { one, all, run } from '../lib/db.js';
import { html, icon, pageTitle, empty, csrfField } from '../lib/html.js';
import { korDateTime, isStaff, ROLE_LABEL } from '../lib/util.js';
import { hashPassword, verifyPassword, passwordProblem } from '../lib/auth.js';
import { NOTIF_TYPES } from '../lib/services.js';

get('/notifications', 'user', ctx => {
  const rows = all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50', ctx.user.id);
  const unread = rows.filter(r => !r.read_at).length;
  ctx.page('알림', html`${pageTitle('알림', '최근 50개까지 보여 줍니다.')}
  ${unread ? html`<form method="post" action="/notifications/read" class="mb8">${csrfField(ctx)}<button class="btn ghost full">${icon('checks')}모두 읽음 (${unread})</button></form>` : ''}
  ${rows.length ? html`<div class="list">${rows.map(n => html`<a href="/notifications/${n.id}" style="${n.read_at ? '' : 'background:#f3f7ff'}"><div class="row-m">
    <b>${n.read_at ? '' : html`<span style="color:var(--blue)">● </span>`}${n.title}</b>${n.body ? html`<span>${n.body}</span>` : ''}<span>${korDateTime(n.created_at)}</span></div>${icon('right')}</a>`)}</div>`
    : empty('알림이 없어요')}`);
});
get('/notifications/:id', 'user', ctx => {
  const n = one('SELECT * FROM notifications WHERE id=? AND user_id=?', ctx.params.id, ctx.user.id);
  if (n) run(`UPDATE notifications SET read_at=datetime('now') WHERE id=? AND read_at IS NULL`, n.id);
  ctx.redirect(n?.link || '/notifications');
});
post('/notifications/read', 'user', ctx => { run(`UPDATE notifications SET read_at=datetime('now') WHERE user_id=? AND read_at IS NULL`, ctx.user.id); ctx.redirect('/notifications', '모두 읽음으로 표시했어요.'); });

get('/settings', 'any', ctx => {
  const u = ctx.user;
  const types = Object.entries(NOTIF_TYPES).filter(([, [, , who]]) => who === 'all' || (who === 'staff' && isStaff(u)) || (who === 'parent' && u.role === 'parent') || (who === 'member' && !isStaff(u)));
  const prefs = Object.fromEntries(all('SELECT type,in_app FROM notification_prefs WHERE user_id=?', u.id).map(r => [r.type, r.in_app]));
  const consents = all('SELECT * FROM consents WHERE user_id=? ORDER BY id', u.id);
  const CK = { terms: '이용약관', privacy: '개인정보 수집·이용', guardian: '보호자 동의 (만 14세 미만)' };
  ctx.page('설정', html`${pageTitle('설정', `${u.name} · ${ROLE_LABEL[u.role]}`)}
  <div class="card"><h3>내 정보</h3><form method="post" action="/settings/profile">${csrfField(ctx)}
    <label class="field"><span>아이디</span><input type="email" value="${u.email}" disabled><small>아이디는 바꿀 수 없습니다.</small></label>
    <label class="field"><span>이름</span><input type="text" name="name" value="${u.name}" required></label>
    <label class="field"><span>휴대폰 번호</span><input type="tel" name="phone" value="${u.phone || ''}"></label>
    ${u.role === 'student' ? html`<div class="row2"><label class="field"><span>학교</span><input type="text" name="school" value="${u.school || ''}"></label>
      <label class="field"><span>학년</span><select name="grade">${['고1', '고2', '고3', 'N수'].map(g => html`<option ${u.grade === g ? 'selected' : ''}>${g}</option>`)}</select></label></div>
      <div class="row2"><label class="field"><span>성별</span><select name="gender"><option value="M" ${u.gender === 'M' ? 'selected' : ''}>남</option><option value="F" ${u.gender === 'F' ? 'selected' : ''}>여</option></select></label>
      <label class="field"><span>생일</span><input type="date" name="birthday" value="${u.birthday || ''}"></label></div>` : ''}
    <button class="btn full">저장</button></form></div>
  ${types.length ? html`<div class="card"><h3>알림 받기</h3><form method="post" action="/settings/notif" data-autosubmit>${csrfField(ctx)}
    <table class="tbl"><tr><th>알림</th><th>앱 안</th></tr>${types.map(([k, [l, d]]) => html`<tr><td><b>${l}</b><div class="small muted">${d}</div></td><td><label class="check" style="justify-content:flex-end;margin:0"><input type="checkbox" name="t[]" value="${k}" ${prefs[k] === 0 ? '' : 'checked'}></label></td></tr>`)}</table>
    <p class="help">앱 안 알림을 끄면 그 알림은 만들어지지 않아요.</p><noscript><button class="btn sm">저장</button></noscript></form></div>` : ''}
  <div class="card"><h3>앱 설치</h3><p class="small mt0">브라우저 메뉴(⋮)에서 "앱 설치" 또는 "홈 화면에 추가"를 누르면 앱처럼 쓸 수 있어요.</p>
    <a class="btn ghost full" href="/install">${icon('phone')}설치 QR 보기 · 인쇄 (친구·학부모에게 알려 주기)</a></div>
  <div class="card"><h3>동의 내역</h3>${consents.length ? html`<div class="list mb0">${consents.map(c => html`<div><div class="row-m"><b>${CK[c.kind] || c.kind}</b><span>${korDateTime(c.agreed_at)}</span></div>${icon('check', 'green')}</div>`)}</div>` : html`<p class="small muted m0">동의 기록이 없습니다.</p>`}</div>
  <div class="card" id="pw"><h3>비밀번호 변경</h3><form method="post" action="/settings/password">${csrfField(ctx)}
    ${u.must_change_pw ? '' : html`<label class="field"><span>현재 비밀번호</span><input type="password" name="current" required autocomplete="current-password"></label>`}
    <label class="field"><span>새 비밀번호</span><input type="password" name="pw" required minlength="8" autocomplete="new-password"><small>8자 이상, 영문과 숫자를 함께 써 주세요.</small></label>
    <label class="field"><span>새 비밀번호 확인</span><input type="password" name="pw2" required autocomplete="new-password"></label>
    <button class="btn full">비밀번호 변경</button></form></div>`);
});
post('/settings/profile', 'any', ctx => {
  const b = ctx.body; const u = ctx.user;
  if (!(b.name || '').trim()) bad('이름을 입력해 주세요.');
  run('UPDATE users SET name=?, phone=? WHERE id=?', b.name.trim(), (b.phone || '').trim() || null, u.id);
  if (u.role === 'student') run('UPDATE users SET school=?, grade=?, gender=?, birthday=? WHERE id=?', b.school || null, b.grade || null, ['M', 'F'].includes(b.gender) ? b.gender : null, /^\d{4}-\d{2}-\d{2}$/.test(b.birthday || '') ? b.birthday : null, u.id);
  ctx.redirect('/settings', '저장했어요.');
});
post('/settings/notif', 'user', ctx => {
  const on = [].concat(ctx.body.t || []);
  for (const k of Object.keys(NOTIF_TYPES)) run('INSERT INTO notification_prefs(user_id,type,in_app) VALUES(?,?,?) ON CONFLICT(user_id,type) DO UPDATE SET in_app=excluded.in_app', ctx.user.id, k, on.includes(k) ? 1 : 0);
  if (ctx.body._ajax) return ctx.json({ ok: true });
  ctx.redirect('/settings', '저장했어요.');
});
post('/settings/password', 'any', ctx => {
  const u = ctx.user; const b = ctx.body;
  if (!u.must_change_pw && !verifyPassword(b.current || '', u.password_hash)) bad('현재 비밀번호가 맞지 않아요.');
  const p = passwordProblem(b.pw); if (p) bad(p);
  if (b.pw !== b.pw2) bad('새 비밀번호가 서로 달라요.');
  run('UPDATE users SET password_hash=?, must_change_pw=0 WHERE id=?', hashPassword(b.pw), u.id);
  run('DELETE FROM sessions WHERE user_id=? AND token!=?', u.id, ctx.token);
  ctx.redirect('/settings', '비밀번호를 바꿨어요.');
});
