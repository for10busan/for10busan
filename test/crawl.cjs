// 역할별로 로그인해서 모든 화면을 열어 보고 오류를 찾는다. 사용: node test/crawl.cjs http://localhost:3100 [shotsDir]
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const BASE = process.argv[2] || 'http://localhost:3100';
const SHOTS = process.argv[3];
const fs = require('fs'); if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const ROLES = [
  ['owner', 'admin@for10.kr', 'for10admin1'],
  ['coach', 'coach@demo.kr', 'demo1234'],
  ['student', 'student@demo.kr', 'demo1234'],
  ['parent', 'parent@demo.kr', 'demo1234'],
];
(async () => {
  const browser = await chromium.launch();
  const problems = [];
  for (const [role, email, pw] of ROLES) {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error' && !/favicon|mediapipe|jsdelivr|storage.googleapis/i.test(m.text())) problems.push(`[${role}] console: ${m.text()} @ ${page.url()}`); });
    page.on('pageerror', e => problems.push(`[${role}] pageerror: ${e.message} @ ${page.url()}`));
    await page.goto(BASE + '/login');
    await page.fill('input[name=email]', email); await page.fill('input[name=password]', pw);
    await Promise.all([page.waitForLoadState('networkidle'), page.click('form[action="/login"] button')]);
    if (page.url().includes('/settings')) { // 임시 비밀번호 → 변경
      await page.fill('#pw input[name=pw]', 'for10admin1'); await page.fill('#pw input[name=pw2]', 'for10admin1');
      await Promise.all([page.waitForNavigation(), page.click('#pw button')]);
    }
    const seen = new Set(); const queue = [new URL(page.url()).pathname];
    while (queue.length && seen.size < 140) {
      const p = queue.shift(); if (seen.has(p)) continue; seen.add(p);
      const res = await page.goto(BASE + p, { waitUntil: 'domcontentloaded' }).catch(e => ({ status: () => 'ERR ' + e.message }));
      const st = res.status();
      if (st >= 400 || typeof st === 'string') { problems.push(`[${role}] ${st} ${p}`); continue; }
      if (SHOTS && seen.size <= 60) await page.screenshot({ path: `${SHOTS}/${role}_${p.replace(/[/?=&]+/g, '_').slice(0, 60) || 'root'}.png`, fullPage: true });
      const links = await page.$$eval('a[href]', as => as.map(a => a.getAttribute('href')));
      for (const h of links) {
        if (!h || !h.startsWith('/') || h.startsWith('//') || h.includes('#') || /\.(csv|png|jpg)|\/media\/|logout|\/notifications\/\d/.test(h)) continue;
        // 같은 패턴 페이지는 몇 개만
        const key = h.replace(/\d+/g, 'N').replace(/(m|ym|d)=[^&]+/g, '$1=X');
        const cnt = [...seen].filter(s => s.replace(/\d+/g, 'N').replace(/(m|ym|d)=[^&]+/g, '$1=X') === key).length;
        if (cnt < 2 && !seen.has(h)) queue.push(h);
      }
    }
    console.log(`${role}: ${seen.size} pages`);
    await ctx.close();
  }
  await browser.close();
  console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'NO PROBLEMS');
})();
