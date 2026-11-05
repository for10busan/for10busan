import { get, post, bad } from '../lib/router.js';
import { one, run, all } from '../lib/db.js';
import { html, raw, csrfField, homeFor, APP_NAME, icon, pageTitle } from '../lib/html.js';
import { hashPassword, verifyPassword, passwordProblem, createSession, destroySession, sessionCookie, clearCookie } from '../lib/auth.js';
import { notify, staffIds, branches } from '../lib/services.js';
import { GRADES, isValidDate } from '../lib/util.js';

const foot = html`<div class="foot"><a href="/install">휴대폰에 앱으로 설치하기</a><a href="/terms">이용약관</a><a href="/privacy">개인정보처리방침</a></div>`;

get('/', 'public', ctx => ctx.redirect(homeFor(ctx.user)));

get('/login', 'public', ctx => {
  if (ctx.user) return ctx.redirect(homeFor(ctx.user));
  ctx.page('로그인', html`<div class="auth">
  <a class="banner" href="/login"><img src="/img/logo-h.png" alt="FOR10 SPORTS ACADEMY"></a>
  <h1>로그인</h1><p class="sub">${APP_NAME}에서 승인된 계정으로 로그인하세요.</p>
  <form method="post" action="/login" class="formcard">
    <input type="hidden" name="next" value="${ctx.query.next || ''}">
    <label class="field"><span>아이디</span><input type="text" name="email" autocomplete="username" autocapitalize="none" required autofocus><small>예전에 이메일로 가입했다면 이메일을 입력하세요.</small></label>
    <label class="field"><span>비밀번호</span><input type="password" name="password" autocomplete="current-password" required></label>
    <button class="btn full">로그인</button>
  </form>
  <div class="links2"><a href="/forgot">비밀번호를 잊으셨나요?</a><span>처음이신가요? <a href="/signup"><b>회원가입</b></a></span></div>
  ${foot}</div>`, { bare: true });
});

post('/login', 'public', ctx => {
  const { email = '', password = '', next = '' } = ctx.body;
  const id = email.trim();
  const u = one('SELECT * FROM users WHERE username=? COLLATE NOCASE', id) || one('SELECT * FROM users WHERE email=?', id);
  if (!u || !verifyPassword(password, u.password_hash)) return ctx.redirect('/login', { msg: '아이디 또는 비밀번호가 맞지 않아요.', type: 'err' });
  const token = createSession(u.id);
  ctx.res.setHeader('Set-Cookie', sessionCookie(token, ctx.secure));
  const safeNext = /^\/[^/]/.test(next) ? next : null;
  ctx.redirect(u.must_change_pw ? '/settings#pw' : (safeNext || homeFor(u)), u.must_change_pw ? { msg: '임시 비밀번호로 로그인했어요. 새 비밀번호로 바꿔 주세요.', type: 'ok' } : null);
});

post('/logout', 'any', ctx => {
  destroySession(ctx.token);
  ctx.res.setHeader('Set-Cookie', clearCookie());
  ctx.redirect('/login');
});

get('/signup', 'public', ctx => {
  if (ctx.user) return ctx.redirect(homeFor(ctx.user));
  const role = ctx.query.role === 'parent' ? 'parent' : 'student';
  const br = branches();
  ctx.page('회원가입', html`<div class="auth">
  <a class="banner" href="/login"><img src="/img/logo-h.png" alt="FOR10 SPORTS ACADEMY"></a>
  <h1>회원가입</h1><p class="sub">가입 후 학원에서 승인하면 이용할 수 있어요.</p>
  <div class="seg"><a href="/signup" class="${role === 'student' ? 'on' : ''}">학생</a><a href="/signup?role=parent" class="${role === 'parent' ? 'on' : ''}">학부모</a></div>
  <form method="post" action="/signup" class="formcard">
    <input type="hidden" name="role" value="${role}">
    <label class="field"><span>이름</span><input type="text" name="name" required maxlength="20"></label>
    <label class="field"><span>아이디</span><input type="text" name="username" required autocomplete="username" autocapitalize="none" pattern="[A-Za-z0-9_.]{4,20}" maxlength="20"><small>영문·숫자 4~20자. 로그인할 때 써요.</small></label>
    <label class="field"><span>이메일 (선택)</span><input type="email" name="email" autocomplete="email"><small>비밀번호를 잊었을 때 찾는 데 써요.</small></label>
    <label class="field"><span>비밀번호</span><input type="password" name="password" required minlength="8" autocomplete="new-password"><small>8자 이상, 영문과 숫자를 함께 써 주세요.</small></label>
    <label class="field"><span>휴대폰 번호</span><input type="tel" name="phone" placeholder="010-1234-5678" required></label>
    ${br.length > 1 ? html`<label class="field"><span>지점</span><select name="branch_id">${br.map(b => html`<option value="${b.id}">${b.name}</option>`)}</select></label>` : html`<input type="hidden" name="branch_id" value="${br[0]?.id || ''}">`}
    ${role === 'student' ? html`
      <label class="field"><span>학교</span><input type="text" name="school" required placeholder="예: 부산체육고등학교"></label>
      <div class="row2">
        <label class="field"><span>학년</span><select name="grade">${GRADES.map(g => html`<option>${g}</option>`)}</select></label>
        <label class="field"><span>성별</span><select name="gender"><option value="M">남</option><option value="F">여</option></select></label>
      </div>
      <label class="field"><span>생일 (선택)</span><input type="date" name="birthday"><small>캘린더에 이름과 날짜만 보여요 (태어난 해는 보이지 않아요).</small></label>`
    : html`<label class="field"><span>자녀 이름</span><input type="text" name="child_name" placeholder="가입한 자녀의 이름"><small>자녀가 먼저 가입해 있어야 연결 요청이 가요. 나중에 홈에서도 요청할 수 있어요.</small></label>
      <label class="field"><span>자녀 이메일 (선택)</span><input type="email" name="child_email" placeholder="동명이인이 있을 때 정확히 찾아요"></label>`}
    <label class="check"><input type="checkbox" name="agree_terms" required><span><a href="/terms" target="_blank"><u>이용약관</u></a>에 동의합니다 (필수)</span></label>
    <label class="check"><input type="checkbox" name="agree_privacy" required><span><a href="/privacy" target="_blank"><u>개인정보 수집·이용</u></a>에 동의합니다 (필수)</span></label>
    ${role === 'student' ? html`<label class="check"><input type="checkbox" name="agree_minor"><span>만 14세 미만이면 보호자 동의를 받았습니다</span></label>` : ''}
    <button class="btn full">가입 신청</button>
  </form>
  <div class="links2"><span></span><span>이미 계정이 있나요? <a href="/login"><b>로그인</b></a></span></div>
  ${foot}</div>`, { bare: true });
});

post('/signup', 'public', ctx => {
  const b = ctx.body;
  const role = b.role === 'parent' ? 'parent' : 'student';
  const username = (b.username || '').trim().toLowerCase();
  const name = (b.name || '').trim();
  if (!name) bad('이름을 입력해 주세요.');
  if (!/^[a-z0-9_.]{4,20}$/.test(username)) bad('아이디는 영문·숫자 4~20자로 정해 주세요.');
  if (one('SELECT 1 FROM users WHERE username=? COLLATE NOCASE', username)) bad('이미 쓰고 있는 아이디예요.');
  let email = (b.email || '').trim().toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad('이메일 형식을 확인해 주세요.');
  if (!email) email = `${username}@id.for10`;
  const p = passwordProblem(b.password); if (p) bad(p);
  if (!b.agree_terms || !b.agree_privacy) bad('필수 약관에 동의해 주세요.');
  if (one('SELECT 1 FROM users WHERE email=?', email)) bad('이미 가입된 이메일이에요.');
  const branchId = Number(b.branch_id) || null;
  const r = run(`INSERT INTO users(email,password_hash,name,phone,role,status,branch_id,school,grade,gender,birthday) VALUES(?,?,?,?,?,'pending',?,?,?,?,?)`,
    email, hashPassword(b.password), name, (b.phone || '').trim(), role, branchId,
    role === 'student' ? (b.school || '').trim() : null, role === 'student' && GRADES.includes(b.grade) ? b.grade : null,
    role === 'student' && ['M', 'F'].includes(b.gender) ? b.gender : null, role === 'student' && isValidDate(b.birthday) ? b.birthday : null);
  const uid = Number(r.lastInsertRowid);
  run('UPDATE users SET username=? WHERE id=?', username, uid);
  run(`INSERT INTO consents(user_id,kind) VALUES(?,'terms'),(?,'privacy')`, uid, uid);
  if (b.agree_minor) run(`INSERT INTO consents(user_id,kind) VALUES(?,'guardian')`, uid);
  if (role === 'parent' && (b.child_name || b.child_email)) requestLink(uid, name, b.child_name, b.child_email);
  notify(staffIds(branchId), 'signup', `[가입 요청] ${name} (${role === 'student' ? '학생' : '학부모'})`, '가입 승인을 기다리고 있습니다.', '/admin/approvals');
  const token = createSession(uid);
  ctx.res.setHeader('Set-Cookie', sessionCookie(token, ctx.secure));
  ctx.redirect('/pending');
});

export function requestLink(parentId, parentName, childName, childEmail) {
  const rows = childEmail ? all(`SELECT id,name FROM users WHERE role='student' AND email=?`, childEmail.trim())
    : all(`SELECT id,name FROM users WHERE role='student' AND name=?`, (childName || '').trim());
  if (rows.length !== 1) return false;
  run(`INSERT OR IGNORE INTO parent_links(parent_id,student_id) VALUES(?,?)`, parentId, rows[0].id);
  notify(staffIds(), 'link', `[연결 요청] ${parentName} → ${rows[0].name}`, '학부모-학생 연결 승인을 기다리고 있습니다.', '/admin/links');
  return true;
}

get('/pending', 'any', ctx => {
  const u = ctx.user;
  if (u.status === 'approved') return ctx.redirect(homeFor(u));
  ctx.page('승인 대기', html`<div class="auth">
  <a class="banner" href="/login"><img src="/img/logo-h.png" alt="FOR10 SPORTS ACADEMY"></a>
  ${u.status === 'rejected' ? html`<h1>가입이 승인되지 않았어요</h1><p class="sub">학원에 문의해 주세요.</p>`
    : html`<h1>승인을 기다리고 있어요</h1><p class="sub">${u.name}님, 가입 신청이 접수됐어요. 학원에서 수강생·보호자인지 확인한 뒤 승인하면 바로 이용할 수 있어요.</p>`}
  <form method="post" action="/logout">${csrfField(ctx)}<button class="btn ghost full">${icon('logout')}로그아웃</button></form>
  </div>`, { bare: true });
});

get('/forgot', 'public', ctx => ctx.page('비밀번호 찾기', html`<div class="auth">
  ${pageTitle('비밀번호를 잊으셨나요?', '학원에 비밀번호 초기화를 요청해 주세요.', ['로그인', '/login'])}
  <div class="formcard">
    <p class="mt0">원장·강사가 <b>회원 관리</b>에서 임시 비밀번호를 만들어 드려요. 임시 비밀번호로 로그인하면 바로 새 비밀번호로 바꾸게 돼요.</p>
    <form method="post" action="/forgot">
      <label class="field"><span>아이디 또는 가입한 이메일</span><input type="text" name="email" required autocapitalize="none"></label>
      <button class="btn full">초기화 요청 보내기</button>
    </form>
  </div></div>`, { bare: true }));

post('/forgot', 'public', ctx => {
  const id = (ctx.body.email || '').trim();
  const u = one('SELECT id,name FROM users WHERE username=? COLLATE NOCASE', id) || one('SELECT id,name FROM users WHERE email=?', id);
  if (u) notify(staffIds(), 'signup', `[비밀번호 초기화 요청] ${u.name}`, '회원 관리에서 임시 비밀번호를 만들어 주세요.', `/admin/members?q=${encodeURIComponent(u.name)}`);
  ctx.redirect('/login', '요청을 보냈어요. 학원에서 임시 비밀번호를 알려 드릴 거예요.');
});

const legal = (title, text) => ctx => ctx.page(title, html`<div class="auth" style="max-width:640px">${pageTitle(title, APP_NAME, ['돌아가기', '/login'])}<div class="formcard small" style="white-space:pre-wrap">${text}</div></div>`, { bare: !ctx.user });
get('/terms', 'public', legal('이용약관', `제1조 (목적)
이 약관은 ${APP_NAME}(이하 "학원")이 제공하는 출결·운동일지·자세 피드백 앱(이하 "서비스")의 이용 조건을 정합니다.

제2조 (이용 대상)
서비스는 학원 수강생, 그 보호자, 학원 직원만 이용할 수 있으며 학원의 승인 후 사용할 수 있습니다.

제3조 (AI 분석 결과)
영상 자세 분석 결과는 참고용입니다. 2D 영상 특성상 카메라 각도에 따라 오차가 생길 수 있으며 정확한 판단은 강사 확인이 필요합니다.

제4조 (게시물)
이용자가 올린 영상·일지는 학원 지도 목적으로만 사용합니다. 원본 영상은 보관 기간이 지나면 자동 삭제되며 분석 결과는 남습니다.

제5조 (탈퇴)
탈퇴를 원하면 학원에 요청하세요. 학원은 지체 없이 계정과 관련 데이터를 삭제합니다.

※ 이 문서는 기본 예시입니다. 실제 운영 전 학원 상황에 맞게 수정하세요.`));
get('/privacy', 'public', legal('개인정보처리방침', `1. 수집 항목: 이름, 이메일, 휴대폰 번호, 학교·학년·성별, 생일(선택), 출결·운동일지·영상·실기 기록, 내신·모의고사 성적(학생이 입력한 경우)
2. 이용 목적: 출결 관리, 훈련 지도와 피드백, 학부모 안내, 입시 상담
3. 보관 기간: 회원 탈퇴 시까지. 원본 영상은 업로드 후 90일(설정 가능)까지 보관 후 자동 삭제
4. 제3자 제공: 하지 않습니다.
5. 영상 분석: 자세 분석은 이용자의 기기(브라우저) 안에서 처리되며, 관절 좌표와 분석 결과만 서버에 저장됩니다.
6. 만 14세 미만: 법정대리인의 동의가 필요합니다.
7. 문의: 학원 사무실

※ 이 문서는 기본 예시입니다. 실제 운영 전 학원 상황에 맞게 수정하세요.`));

get('/install', 'public', ctx => ctx.page('앱 설치', html`<div class="auth">
  ${pageTitle('휴대폰에 앱으로 설치하기', '설치하면 홈 화면에서 바로 열 수 있어요.', ctx.user ? ['돌아가기', homeFor(ctx.user)] : ['로그인', '/login'])}
  <div class="card"><h3>${icon('phone')} 아이폰 (Safari)</h3><ol class="small mt0"><li>Safari에서 이 주소를 엽니다</li><li>아래쪽 <b>공유</b> 버튼을 누릅니다</li><li><b>홈 화면에 추가</b>를 누릅니다</li></ol></div>
  <div class="card"><h3>${icon('phone')} 안드로이드 (Chrome)</h3><ol class="small mt0"><li>Chrome에서 이 주소를 엽니다</li><li>오른쪽 위 <b>⋮</b> 메뉴를 누릅니다</li><li><b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 누릅니다</li></ol></div>
  <button class="btn full no-print" id="installBtn" hidden>${icon('download')}지금 설치하기</button>
  <div class="card mt12" style="text-align:center"><h3>설치 QR</h3><canvas class="qr" data-qr="${ctx.url.origin}/login"></canvas><p class="small muted">${ctx.url.origin}</p><button class="btn ghost sm no-print" onclick="print()">인쇄하기</button></div>
  <script src="/js/qr.js" defer></script></div>`, { bare: !ctx.user }));
