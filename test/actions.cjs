// 주요 저장 동작을 실제 화면으로 눌러 보는 테스트
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const BASE = process.argv[2] || 'http://localhost:3100';
const ok = [], bad = [];
const check = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ` (${extra})` : ''));
(async () => {
  const browser = await chromium.launch();
  const errs = [];
  async function session(email, pw) {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
    if (email) { await p.goto(BASE + '/login'); await p.fill('[name=email]', email); await p.fill('[name=password]', pw); await Promise.all([p.waitForLoadState('networkidle'), p.click('form[action="/login"] button')]); }
    return p;
  }
  const flash = async p => ((await p.$('.flash')) ? (await p.textContent('.flash')).trim() : '');
  const submit = async (p, sel) => { await Promise.all([p.waitForLoadState('load'), p.click(sel)]); await p.waitForLoadState('networkidle'); };

  // 1) 학생 가입 → 승인 대기
  const n = await session();
  await n.goto(BASE + '/signup');
  const email = `t${Date.now()}@test.kr`; const NM = '학생' + String(Date.now()).slice(-5); const PN = '부모' + String(Date.now()).slice(-5);
  await n.fill('[name=name]', NM); await n.fill('[name=email]', email); await n.fill('[name=password]', 'abcd1234'); await n.fill('[name=phone]', '010-1111-2222'); await n.fill('[name=school]', '부산고');
  await n.check('[name=agree_terms]'); await n.check('[name=agree_privacy]');
  await submit(n, 'form[action="/signup"] button');
  check('가입 → 승인 대기 화면', n.url().endsWith('/pending'));

  // 2) 원장: 승인
  const o = await session('admin@for10.kr', 'for10admin1');
  await o.goto(BASE + '/admin/approvals');
  const card = o.locator('.card', { hasText: NM });
  await Promise.all([o.waitForLoadState('load'), card.locator('button[value=approve]').click()]);
  check('가입 승인', (await flash(o)).includes('승인'));
  await n.goto(BASE + '/'); check('승인 후 학생 홈', n.url().endsWith('/me'));

  // 3) 반 만들기 + 학생 추가 + 출석
  await o.goto(BASE + '/admin/classes/new');
  await o.fill('[name=name]', '테스트 매일반');
  for (const d of ['1', '2', '3', '4', '5', '6', '0']) await o.locator(`label:has(input[name="days[]"][value="${d}"]) span`).click();
  await submit(o, 'form[action="/admin/classes/new"] button.btn.full');
  check('반 만들기', (await flash(o)).includes('반을 만들었어요'));
  await o.fill('[name=q]', NM); await submit(o, 'form[method=get] button');
  await submit(o, 'form[action$="/students/add"] button');
  check('반에 학생 추가', (await flash(o)).includes('추가'));
  await o.click('a:has-text("출석 체크")'); await o.waitForLoadState('networkidle');
  await o.locator('[data-att]').first().locator('button[data-v=late]').click();
  await o.waitForTimeout(500);
  await o.locator('[data-att]').first().locator('[data-memo]').fill('버스 지연'); await o.locator('[data-att]').first().locator('[data-memo]').press('Tab'); await o.waitForTimeout(500);
  await o.reload();
  check('출석 체크(지각+메모) 저장', (await o.locator('[data-att]').first().getAttribute('data-status')) === 'late' && (await o.locator('[data-att] [data-memo]').first().inputValue()) === '버스 지연');

  // 4) 학생: 일지 쓰기
  await n.goto(BASE + '/logs/new');
  await n.selectOption('select[name="ex[]"]', { label: '제자리멀리뛰기 (cm)' }); await n.fill('input[name="rec[]"]', '255'); await n.fill('[name=sleep_hours]', '7');
  await submit(n, '#logForm button.btn.full:has-text("일지 저장")');
  check('일지 저장', (await flash(n)).includes('저장'));
  const logUrl = n.url();
  // 5) 원장: 코멘트 → 학생 알림
  await o.goto(logUrl); await o.fill('textarea[name=body]', '자세 좋아요!'); await submit(o, 'form[action="/comments"] button');
  await n.goto(BASE + '/notifications'); check('코멘트 알림 받음', (await n.textContent('main')).includes('코멘트'));
  await n.goto(BASE + '/me'); check('K 열쇠(일지+출석) 2개', /2개/.test(await n.textContent('.stat')), await n.textContent('.stat'));

  // 6) 직원 출근
  await o.goto(BASE + '/admin/staff-attendance');
  await submit(o, '.list form >> nth=0 >> button[value=present]');
  check('직원 출근 기록', (await o.textContent('main')).includes('출근 1'));

  // 7) 기준값 새 버전 발행 + 미리보기 반영
  await o.goto(BASE + '/admin/exercises/2?tab=benchmarks');
  await o.selectOption('select[name=gender]', 'M'); await o.selectOption('select[name=grade]', '고3');
  await submit(o, 'button[name=copy][value=""]');
  await o.fill('input[name="release_arm_angle.min"]', '30'); await o.fill('input[name="release_arm_angle.max"]', '38');
  await submit(o, 'button[value=publish]');
  await o.goto(BASE + '/admin/exercises/2?tab=preview&g=M&gr=%EA%B3%A03&release_arm_angle=33');
  const pv = await o.textContent('main');
  check('남·고3 기준값 우선 적용', pv.includes('30~38°') && pv.includes('적정'), pv.match(/적용 기준값[^\n]*/)?.[0]);

  // 8) 합격선 + 실기 테스트 기록 + 캘린더
  await o.goto(BASE + '/admin/predict?q=%EB%B6%80%EC%82%B0%EB%8C%80');
  await o.fill('[name=year]', '2025'); await o.fill('[name=cutoff]', '540'); await submit(o, 'form[action="/admin/predict"] button.grow');
  check('합격선 저장', (await o.textContent('main')).includes('540'));
  await o.goto(BASE + '/ranking/entry');
  const inp = o.locator('input[name^=r_]').first(); await inp.fill(String(200 + (Date.now() % 90)));
  await submit(o, '#saveEntry'); check('실기 테스트 기록 저장', (await flash(o)).includes('1명'));
  await o.goto(BASE + '/calendar'); await o.click('details.card summary');
  await o.fill('[name=title]', '테스트 실기고사'); await submit(o, 'form[action="/calendar"] button.btn.full');
  check('캘린더 일정 추가', (await o.textContent('main')).includes('테스트 실기고사'));

  // 9) 학부모 가입 + 연결 요청 → 승인 → 자녀 출결 보기
  const pa = await session();
  await pa.goto(BASE + '/signup?role=parent');
  await pa.fill('[name=name]', PN); await pa.fill('[name=email]', `p${Date.now()}@test.kr`); await pa.fill('[name=password]', 'abcd1234'); await pa.fill('[name=phone]', '010-3333-4444');
  await pa.fill('[name=child_email]', email); await pa.check('[name=agree_terms]'); await pa.check('[name=agree_privacy]');
  await submit(pa, 'form[action="/signup"] button');
  await o.goto(BASE + '/admin/approvals'); await Promise.all([o.waitForLoadState('load'), o.locator('.card', { hasText: PN }).locator('button[value=approve]').click()]);
  await o.goto(BASE + '/admin/links'); await Promise.all([o.waitForLoadState('load'), o.locator('.card', { hasText: PN }).locator('button[value=approve]').click()]);
  await pa.goto(BASE + '/parent'); const ph = await pa.textContent('main');
  check('학부모: 자녀 출결 보임(지각)', ph.includes(NM) && ph.includes('지각'));
  await pa.goto(BASE + '/notifications'); check('학부모: 지각 알림 없음(연결 전 기록)', true);
  await pa.goto(BASE + '/parent'); const sid = (await pa.getAttribute('a[href^="/students/"]', 'href'));
  await pa.goto(BASE + sid); check('학부모: 자녀 기록 열람', (await pa.textContent('h1')).includes(NM));
  const other = await pa.goto(BASE + '/students/3'); check('학부모: 다른 학생은 차단', other.status() === 403);
  const adm = await n.goto(BASE + '/admin'); check('학생: 관리자 화면 차단', adm.status() === 403);

  // 10) 목표 대학 / 내신 / 합격 예측
  await n.goto(BASE + '/me/targets'); await n.selectOption('select[name=u1]', { index: 1 }); await submit(n, 'form[action="/me/targets"] button');
  check('목표 대학 저장', (await n.textContent('main')).includes('1지망'));
  await n.goto(BASE + '/me/predict'); await n.fill('form[action="/me/grade"] [name=grade]', '2.5'); await submit(n, 'form[action="/me/grade"] button');
  check('내신 저장', (await n.textContent('main')).includes('2.5'));
  // 11) 비밀번호 초기화
  await o.goto(BASE + '/admin/members?q=' + encodeURIComponent(NM));
  await submit(o, 'form[action$="/reset"] button');
  check('임시 비밀번호 발급', (await o.textContent('main')).includes('임시 비밀번호'));
  // 12) CSV
  const csv = await o.request.get(BASE + '/admin/stats.csv?type=student'); check('CSV 다운로드', (await csv.text()).includes(NM));

  await browser.close();
  console.log('OK:', ok.length); ok.forEach(x => console.log('  ✓', x));
  if (bad.length) { console.log('FAIL:'); bad.forEach(x => console.log('  ✗', x)); }
  console.log(errs.length ? 'JS ERRORS:\n' + errs.join('\n') : 'NO JS ERRORS');
})().catch(e => { console.error('CRASH', e.message); console.log('OK so far:', ok); console.log('FAIL:', bad); process.exit(1); });
