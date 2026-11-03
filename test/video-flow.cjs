// 영상 업로드 → (MediaPipe 대신 준비된 포즈 전송) → 결과 화면 오버레이·보정까지 확인
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const BASE = process.argv[2] || 'http://localhost:3100';
(async () => {
  const browser = await chromium.launch();
  const errs = [];
  const login = async (email, pw) => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => m.type() === 'error' && !/jsdelivr|mediapipe|googleapis|Failed to fetch dynamically/i.test(m.text()) && errs.push(m.text()));
    // 외부 CDN(MediaPipe)은 이 환경에서 막혀 있으므로 실패로 응답
    await page.route(/jsdelivr|googleapis/, r => r.abort());
    await page.goto(BASE + '/login'); await page.fill('[name=email]', email); await page.fill('[name=password]', pw);
    await Promise.all([page.waitForLoadState('networkidle'), page.click('form[action="/login"] button')]);
    return page;
  };
  // 학생: 업로드
  const s = await login('student@demo.kr', 'demo1234');
  await s.goto(BASE + '/videos/new');
  await s.fill('[name=record]', '281');
  await s.setInputFiles('[name=file]', '/tmp/lj.mp4');
  await Promise.all([s.waitForURL(/\/videos\/\d+$/, { timeout: 20000 }), s.click('#upForm button')]);
  const vid = s.url().split('/').pop();
  await s.waitForSelector('[data-amsg]');
  await s.waitForTimeout(2500);
  console.log('student auto-analysis msg:', await s.textContent('[data-amsg]'));
  await s.screenshot({ path: '/tmp/vf_1_student_cdn_blocked.png', fullPage: false });
  // MediaPipe 결과 대신 미리 만든 포즈를 같은 API로 보냄
  const pose = JSON.parse(fs.readFileSync('/tmp/lj_pose.json', 'utf8'));
  const r = await s.evaluate(async ([id, pose]) => { const res = await fetch(`/api/videos/${id}/pose`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': window.VID.csrf, Accept: 'application/json' }, body: JSON.stringify(pose) }); return res.json(); }, [vid, pose]);
  console.log('analysis:', JSON.stringify(r.res.keyFrames), JSON.stringify(r.res.metrics));
  await s.reload(); await s.waitForTimeout(1500);
  await s.click('[data-jump=takeoff]'); await s.waitForTimeout(800);
  console.log('frame label:', await s.textContent('[data-frame]'));
  await s.screenshot({ path: '/tmp/vf_2_student_result.png', fullPage: true });
  // 원장: 보정
  const o = await login('admin@for10.kr', 'for10admin1');
  await o.goto(`${BASE}/videos/${vid}`); await o.waitForTimeout(1200);
  await o.click('[data-correct] summary');
  await o.click('[data-jump=takeoff]'); await o.waitForTimeout(500);
  await o.click('[data-act=next]'); await o.waitForTimeout(400); await o.click('[data-act=next]'); await o.waitForTimeout(500);
  await o.click('[data-set=takeoff]'); await o.waitForTimeout(1200);
  const newVals = await o.$$eval('[data-new]', tds => tds.map(t => t.dataset.new + '=' + t.textContent));
  console.log('preview after moving takeoff +2 frames:', newVals.join(', '));
  await o.screenshot({ path: '/tmp/vf_3_owner_correct.png', fullPage: false, clip: undefined });
  await o.locator('[data-correct]').screenshot({ path: '/tmp/vf_3b_panel.png' });
  await Promise.all([o.waitForLoadState('load'), o.click('[data-act=save]')]); await o.waitForTimeout(1200);
  const hist = await o.$$eval('.card h3', hs => hs.map(h => h.textContent));
  console.log('chips:', await o.textContent('.chips'));
  console.log('has history:', hist.some(h => h.includes('분석 이력')));
  await o.screenshot({ path: '/tmp/vf_4_owner_after.png', fullPage: true });
  await browser.close();
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'NO JS ERRORS');
})();
