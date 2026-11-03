import fs from 'node:fs';
import path from 'node:path';
import { get, post, put, notFound, forbidden, bad } from '../lib/router.js';
import { one, all, run, tx, J, DATA_DIR, getSetting } from '../lib/db.js';
import { html, raw, icon, pageTitle, empty, csrfField, chip, esc } from '../lib/html.js';
import { korDay, korDateTime, isStaff, num, fmtNum, utcToKstDate } from '../lib/util.js';
import { canViewStudent, notify, staffIds, parentIdsOf, benchmarksFor, judge, feedbackText, rangeText, LEVEL_LABEL, DEFAULT_TEMPLATES } from '../lib/services.js';
import { analyze, ALGOS } from '../public/js/pose/analyze.js';
import { serveFile } from '../lib/static.js';
import { commentsBlock } from './students.js';

const UP = path.join(DATA_DIR, 'uploads');
const MAX_VIDEO = Number(process.env.MAX_VIDEO_MB || 300) * 1024 * 1024;
const STATUS = { uploaded: ['업로드됨', ''], analyzing: ['분석 중', 'amber'], done: ['분석 완료', 'green'], failed: ['실패', 'red'] };
export const retentionDays = () => Number(getSetting('video_retention_days', 90));

// ---------- 학생 상세 '영상' 탭 ----------
export function videosTab(ctx, s) {
  const vids = all(`SELECT v.*, e.name ex, e.unit, (SELECT metrics FROM video_analyses a WHERE a.video_id=v.id AND a.is_current=1) m FROM videos v JOIN exercises e ON e.id=v.exercise_id WHERE v.student_id=? ORDER BY v.id DESC`, s.id);
  const self = ctx.user.id === s.id;
  return html`${self ? html`<a class="btn full mb8" href="/videos/new">${icon('video')}자세 분석 영상 올리기</a>` : ''}
  ${vids.length ? vids.map(v => {
    const lv = levels(v); return html`<a class="card" style="display:flex;align-items:center;gap:10px" href="/videos/${v.id}"><div class="grow"><b>${v.ex}</b><div class="small muted">${korDateTime(v.created_at)}</div>
      <div class="chips mt8">${chip(STATUS[v.status][0], STATUS[v.status][1])}${v.record != null ? chip(`기록 ${fmtNum(v.record)}${v.unit}`) : ''}${lv.total ? chip(`적정 ${lv.ok}/${lv.total}`) : ''}${v.reviewed_at ? chip('강사 확인', 'blue') : ''}${v.corrected ? chip('강사 보정') : ''}</div></div>${icon('right')}</a>`;
  }) : empty('아직 올린 영상이 없어요', self ? '촬영 가이드를 보고 옆에서 찍어 주세요.' : '')}`;
}
function levels(v) {
  const m = J(v.m); const st = one('SELECT gender, grade FROM users WHERE id=?', v.student_id);
  const { vals } = benchmarksFor(v.exercise_id, st?.gender, st?.grade);
  let ok = 0, total = 0;
  for (const [k, val] of Object.entries(m)) { const j = judge(val, vals[k]); if (j) { total++; if (j.level === 'ok' || j.level === 'near') ok++; } }
  return { ok, total };
}

// ---------- 업로드 ----------
get('/videos/new', 'student', ctx => {
  const exs = all(`SELECT * FROM exercises WHERE active=1 AND kind='video' ORDER BY sort,id`);
  const sel = Number(ctx.query.e) || exs[0]?.id;
  const ex = exs.find(e => e.id === sel);
  const g = J(ex?.guide); const photos = J(ex?.guide_photos, []);
  ctx.page('영상 올리기', html`${pageTitle('자세 분석 영상 올리기', 'AI가 관절을 찾아 각도를 재고, 선생님이 확인해 줘요.', ['내 영상', '/me/videos'])}
  ${exs.length ? html`
  <form method="get" class="mb8"><label class="field"><span>종목</span><select name="e" onchange="this.form.submit()">${exs.map(e => html`<option value="${e.id}" ${e.id === sel ? 'selected' : ''}>${e.name}</option>`)}</select></label></form>
  <div class="card"><h3>${icon('film')} 촬영 가이드</h3>
    <dl class="kv"><dt>카메라 위치</dt><dd>${g.position || '옆(측면)에서 90°로'}</dd><dt>거리</dt><dd>${g.distance || '3~4m (온몸이 화면에 들어오게)'}</dd><dt>높이</dt><dd>${g.height || '허리 높이, 삼각대로 고정'}</dd></dl>
    ${(g.cautions || []).length ? html`<ul class="small mt12 mb0" style="padding-left:18px">${g.cautions.map(c => html`<li>${c}</li>`)}</ul>` : ''}
    ${photos.length ? html`<div class="flex mt12" style="overflow-x:auto">${photos.map(p => html`<img src="/media/guide/${p}" alt="예시 사진" style="height:120px;border-radius:10px">`)}</div>` : ''}</div>
  <form id="upForm" class="formcard" data-ex="${sel}" data-unit="${ex?.unit || ''}">
    <label class="field"><span>내 기록 (${ex?.unit}) <span class="muted">— 선택</span></span><input type="number" step="any" name="record" placeholder="예: ${ex?.unit === 'cm' ? '250' : ex?.unit === 'm' ? '10.5' : '9.8'}"></label>
    <label class="field"><span>영상 파일</span><input type="file" name="file" accept="video/*" required></label>
    <p class="help">20초 이내 영상을 권장해요. 원본 영상은 ${retentionDays()}일 뒤 자동 삭제되고 분석 결과는 남아요.</p>
    <div class="progress mb8" hidden><i></i></div><p class="small muted" id="upMsg"></p>
    <button class="btn full">${icon('upload')}올리고 분석하기</button></form>
  <script>window.UP={csrf:'${ctx.csrf}'}</script><script src="/js/upload.js?v=2" defer></script>`
    : html`${empty('영상 분석 종목이 아직 없어요', '학원에서 종목을 준비하면 올릴 수 있어요.')}`}`, { active: '/me/videos' });
});
post('/api/videos', 'student', ctx => {
  const ex = one(`SELECT * FROM exercises WHERE id=? AND kind='video' AND active=1`, ctx.body.exercise_id) || bad('종목을 확인해 주세요.');
  const mime = String(ctx.body.mime || 'video/mp4').slice(0, 40);
  const exp = new Date(Date.now() + retentionDays() * 864e5).toISOString().slice(0, 19).replace('T', ' ');
  const r = run(`INSERT INTO videos(student_id,exercise_id,record,mime,expires_at) VALUES(?,?,?,?,?)`, ctx.user.id, ex.id, num(ctx.body.record), mime, exp);
  ctx.json({ id: Number(r.lastInsertRowid) });
});
put('/api/videos/:id/file', 'student', async ctx => {
  const v = one('SELECT * FROM videos WHERE id=? AND student_id=?', ctx.params.id, ctx.user.id) || notFound();
  if (v.file) bad('이미 올린 영상이에요.');
  const ext = (/(mp4|quicktime|webm|x-m4v|3gpp)/.exec(ctx.req.headers['content-type'] || '') || ['mp4'])[0].replace('quicktime', 'mov').replace('x-m4v', 'm4v').replace('3gpp', '3gp');
  const name = `v${v.id}_${Date.now().toString(36)}.${ext}`;
  const dest = path.join(UP, name);
  await new Promise((resolve, reject) => {
    let n = 0; const ws = fs.createWriteStream(dest);
    ctx.req.on('data', c => { n += c.length; if (n > MAX_VIDEO) { ctx.req.destroy(); ws.destroy(); fs.rm(dest, () => {}); reject(Object.assign(new Error(`영상은 ${MAX_VIDEO / 1048576}MB까지 올릴 수 있어요.`), { status: 413 })); } });
    ctx.req.pipe(ws); ws.on('finish', resolve); ws.on('error', reject);
  });
  run(`UPDATE videos SET file=?, mime=?, status='analyzing' WHERE id=?`, name, ctx.req.headers['content-type'] || v.mime, v.id);
  const ex = one('SELECT name FROM exercises WHERE id=?', v.exercise_id);
  notify(staffIds(ctx.user.branch_id), 'video', `[영상] ${ctx.user.name} · ${ex.name}`, '자세 분석 영상을 올렸어요.', `/videos/${v.id}`);
  ctx.json({ ok: true });
});
get('/media/v/:id', 'user', ctx => {
  const v = one('SELECT * FROM videos WHERE id=?', ctx.params.id) || notFound();
  if (!canViewStudent(ctx.user, v.student_id) || !v.file) notFound();
  serveFile(ctx.req, ctx.res, path.join(UP, v.file), { cache: 'private, max-age=86400', type: v.mime }) || notFound();
});

// ---------- 포즈 저장 · 자동 분석 ----------
function canEditVideo(u, v) { return isStaff(u) || u.id === v.student_id; }
export function runAnalysis(videoId, { kind = 'auto', authorId = null, keyFrames = null, overrides = null } = {}) {
  const v = one('SELECT v.*, e.analysis_code FROM videos v JOIN exercises e ON e.id=v.exercise_id WHERE v.id=?', videoId);
  const pose = one('SELECT * FROM video_pose WHERE video_id=?', videoId);
  if (!v || !pose || !ALGOS[v.analysis_code]) return null;
  const res = analyze(v.analysis_code, { fps: pose.fps, width: pose.width, height: pose.height, frames: J(pose.frames, []) }, keyFrames);
  if (overrides) for (const [k, val] of Object.entries(overrides)) if (val != null && Number.isFinite(Number(val))) res.metrics[k] = Math.round(Number(val) * 10) / 10;
  tx(() => {
    run('UPDATE video_analyses SET is_current=0 WHERE video_id=?', videoId);
    run(`INSERT INTO video_analyses(video_id,kind,author_id,key_frames,metrics,algo,is_current) VALUES(?,?,?,?,?,?,1)`, videoId, kind, authorId, JSON.stringify(res.keyFrames), JSON.stringify(res.metrics), res.algo);
    run(`UPDATE videos SET status=?, error=?, confidence=?, corrected=? WHERE id=?`, res.error && !Object.keys(res.metrics).length ? 'failed' : 'done', res.error || null, res.confidence, kind === 'manual' ? 1 : 0, videoId);
  });
  return res;
}
post('/api/videos/:id/pose', 'user', ctx => {
  const v = one('SELECT * FROM videos WHERE id=?', ctx.params.id) || notFound();
  if (!canEditVideo(ctx.user, v)) forbidden();
  const b = ctx.body;
  if (b.error) { run(`UPDATE videos SET status='failed', error=? WHERE id=?`, String(b.error).slice(0, 200), v.id); return ctx.json({ ok: false }); }
  if (!Array.isArray(b.frames) || !b.frames.length) bad('포즈 데이터가 없어요.');
  run(`INSERT INTO video_pose(video_id,fps,width,height,frames) VALUES(?,?,?,?,?) ON CONFLICT(video_id) DO UPDATE SET fps=excluded.fps,width=excluded.width,height=excluded.height,frames=excluded.frames`,
    v.id, Number(b.fps) || 30, Number(b.width) || 1, Number(b.height) || 1, JSON.stringify(b.frames));
  const res = runAnalysis(v.id);
  ctx.json({ ok: true, res });
});
post('/api/videos/:id/status', 'user', ctx => {
  const v = one('SELECT * FROM videos WHERE id=?', ctx.params.id) || notFound();
  if (!canEditVideo(ctx.user, v)) forbidden();
  if (ctx.body.status === 'analyzing' && v.status !== 'done') run(`UPDATE videos SET status='analyzing', error=NULL WHERE id=?`, v.id);
  ctx.json({ ok: true });
});
// 보정 미리보기: 순간을 바꾸면 지표가 어떻게 바뀌는지
post('/api/videos/:id/preview', 'staff', ctx => {
  const v = one('SELECT v.*, e.analysis_code FROM videos v JOIN exercises e ON e.id=v.exercise_id WHERE v.id=?', ctx.params.id) || notFound();
  const pose = one('SELECT * FROM video_pose WHERE video_id=?', v.id) || bad('포즈 데이터가 없어요.');
  const res = analyze(v.analysis_code, { fps: pose.fps, width: pose.width, height: pose.height, frames: J(pose.frames, []) }, ctx.body.keyFrames || null);
  ctx.json(res);
});
post('/api/videos/:id/correct', 'staff', ctx => {
  const v = one('SELECT * FROM videos WHERE id=?', ctx.params.id) || notFound();
  const res = runAnalysis(v.id, { kind: ctx.body.reset ? 'auto' : 'manual', authorId: ctx.user.id, keyFrames: ctx.body.reset ? null : ctx.body.keyFrames, overrides: ctx.body.reset ? null : ctx.body.overrides });
  if (!res) bad('분석할 수 없는 영상이에요.');
  run(`UPDATE videos SET reviewed_by=?, reviewed_at=COALESCE(reviewed_at, datetime('now')) WHERE id=?`, ctx.user.id, v.id);
  ctx.json({ ok: true });
});
post('/videos/:id/history/:aid', 'staff', ctx => {
  const a = one('SELECT * FROM video_analyses WHERE id=? AND video_id=?', ctx.params.aid, ctx.params.id) || notFound();
  tx(() => { run('UPDATE video_analyses SET is_current=0 WHERE video_id=?', a.video_id); run('UPDATE video_analyses SET is_current=1 WHERE id=?', a.id); run('UPDATE videos SET corrected=? WHERE id=?', a.kind === 'manual' ? 1 : 0, a.video_id); });
  ctx.redirect(`/videos/${a.video_id}`, '이 결과로 되돌렸어요.');
});
post('/videos/:id/review', 'staff', ctx => {
  const v = one('SELECT v.*, e.name ex FROM videos v JOIN exercises e ON e.id=v.exercise_id WHERE v.id=?', ctx.params.id) || notFound();
  if (v.reviewed_at && ctx.body.v === '0') run('UPDATE videos SET reviewed_by=NULL, reviewed_at=NULL WHERE id=?', v.id);
  else { run(`UPDATE videos SET reviewed_by=?, reviewed_at=datetime('now') WHERE id=?`, ctx.user.id, v.id); notify([v.student_id, ...parentIdsOf(v.student_id)], 'video', `${ctx.user.name} 선생님이 ${v.ex} 영상을 확인했어요`, '', `/videos/${v.id}`); }
  ctx.redirect(`/videos/${v.id}`, '저장했어요.');
});
post('/videos/:id/mark', 'staff', ctx => {
  const { checkpoint_id, value } = ctx.body;
  const cur = one('SELECT * FROM checkpoint_marks WHERE video_id=? AND checkpoint_id=?', ctx.params.id, checkpoint_id);
  if (cur && cur.value === value) run('DELETE FROM checkpoint_marks WHERE video_id=? AND checkpoint_id=?', ctx.params.id, checkpoint_id);
  else if (['good', 'bad'].includes(value)) run(`INSERT INTO checkpoint_marks(video_id,checkpoint_id,value,author_id) VALUES(?,?,?,?) ON CONFLICT(video_id,checkpoint_id) DO UPDATE SET value=excluded.value, author_id=excluded.author_id`, ctx.params.id, checkpoint_id, value, ctx.user.id);
  run(`UPDATE videos SET reviewed_by=?, reviewed_at=COALESCE(reviewed_at, datetime('now')) WHERE id=?`, ctx.user.id, ctx.params.id);
  if (ctx.body._ajax) return ctx.json({ ok: true });
  ctx.redirect(`/videos/${ctx.params.id}#points`);
});
post('/videos/:id/delete', 'user', ctx => {
  const v = one('SELECT * FROM videos WHERE id=?', ctx.params.id) || notFound();
  if (!canEditVideo(ctx.user, v)) forbidden();
  if (v.file) fs.rm(path.join(UP, v.file), () => {});
  run('DELETE FROM videos WHERE id=?', v.id);
  ctx.redirect(isStaff(ctx.user) ? `/students/${v.student_id}?tab=videos` : '/me/videos', '영상을 지웠어요.');
});
get('/api/videos/:id/pose', 'user', ctx => {
  const v = one('SELECT * FROM videos WHERE id=?', ctx.params.id) || notFound();
  if (!canViewStudent(ctx.user, v.student_id)) forbidden();
  const p = one('SELECT * FROM video_pose WHERE video_id=?', v.id);
  ctx.json(p ? { fps: p.fps, width: p.width, height: p.height, frames: J(p.frames, []) } : null);
});

// ---------- 영상 분석 결과 화면 ----------
export function metricJudgements(v, student, metrics, opts = {}) {
  const mdefs = all('SELECT * FROM metrics WHERE exercise_id=? AND enabled=1 ORDER BY sort,id', v.exercise_id);
  const { vals, used } = benchmarksFor(v.exercise_id, student.gender, student.grade, opts);
  const tpls = Object.fromEntries(all('SELECT * FROM feedback_templates WHERE exercise_id=?', v.exercise_id).map(t => [t.metric_key, t]));
  const rows = [];
  for (const m of mdefs) {
    const val = m.source === 'record' ? v.record : metrics[m.key];
    if (val == null) continue;
    const b = vals[m.key]; const j = judge(val, b);
    rows.push({ m, val, b, j, fb: j ? feedbackText(tpls[m.key] || DEFAULT_TEMPLATES, m, val, b, j) : '' });
  }
  return { rows, used, sample: used.some(s => s.is_sample) };
}
get('/videos/:id', 'user', ctx => {
  const v = one(`SELECT v.*, e.name ex, e.unit, e.analysis_code, e.id eid, u.name sname, u.gender, u.grade, r.name reviewer FROM videos v JOIN exercises e ON e.id=v.exercise_id JOIN users u ON u.id=v.student_id LEFT JOIN users r ON r.id=v.reviewed_by WHERE v.id=?`, ctx.params.id) || notFound();
  if (!canViewStudent(ctx.user, v.student_id)) forbidden();
  const staff = isStaff(ctx.user); const self = ctx.user.id === v.student_id;
  const cur = one('SELECT * FROM video_analyses WHERE video_id=? AND is_current=1', v.id);
  const metrics = J(cur?.metrics); const kf = J(cur?.key_frames);
  const hist = all('SELECT a.*, u.name FROM video_analyses a LEFT JOIN users u ON u.id=a.author_id WHERE video_id=? ORDER BY a.id DESC', v.id);
  const prev = one('SELECT id, created_at FROM videos WHERE student_id=? AND exercise_id=? AND id<? ORDER BY id DESC LIMIT 1', v.student_id, v.exercise_id, v.id);
  const next = one('SELECT id, created_at FROM videos WHERE student_id=? AND exercise_id=? AND id>? ORDER BY id LIMIT 1', v.student_id, v.exercise_id, v.id);
  const A = ALGOS[v.analysis_code];
  const { rows, sample } = metricJudgements(v, v, metrics);
  const mdefs = all('SELECT * FROM metrics WHERE exercise_id=? AND enabled=1 ORDER BY sort,id', v.exercise_id);
  const compare = all(`SELECT v2.id, v2.created_at, v2.record, a.metrics FROM videos v2 JOIN video_analyses a ON a.video_id=v2.id AND a.is_current=1 WHERE v2.student_id=? AND v2.exercise_id=? AND v2.id<? ORDER BY v2.id DESC LIMIT 3`, v.student_id, v.exercise_id, v.id);
  const cps = all('SELECT * FROM checkpoints WHERE exercise_id=? ORDER BY sort,id', v.exercise_id);
  const marks = Object.fromEntries(all('SELECT cm.*, u.name FROM checkpoint_marks cm LEFT JOIN users u ON u.id=cm.author_id WHERE video_id=?', v.id).map(m => [m.checkpoint_id, m]));
  const { vals: bvals } = { vals: {} };
  const cpState = cps.map(c => {
    const mk = marks[c.id]; let ai = null;
    if (c.metric_key) { const val = c.metric_key === 'record' ? v.record : metrics[c.metric_key]; if (val != null && (c.good_min != null || c.good_max != null)) ai = (c.good_min == null || val >= c.good_min) && (c.good_max == null || val <= c.good_max) ? 'good' : 'bad'; }
    return { c, mk, ai, value: mk ? mk.value : ai };
  });
  const good = cpState.filter(x => x.value === 'good').length, badN = cpState.filter(x => x.value === 'bad').length;
  const expired = !v.file;
  const back = self ? ['목록', '/me/videos'] : ['목록', `/students/${v.student_id}?tab=videos`];
  const needAnalysis = (v.status === 'analyzing' || v.status === 'uploaded') && v.file && (self || staff) && A;
  void bvals;
  ctx.page('영상 분석 결과', html`${pageTitle(`${v.ex} 자세 분석`, `${v.sname} · ${korDateTime(v.created_at)}`, back)}
  <div class="row2 mb8">${prev ? html`<a class="btn ghost sm" href="/videos/${prev.id}" style="justify-content:flex-start">${icon('left')}<span class="small">이전 영상 · ${korDay(utcToKstDate(prev.created_at))}</span></a>` : html`<span class="btn ghost sm dis">이전 영상 없음</span>`}
    ${next ? html`<a class="btn ghost sm" href="/videos/${next.id}" style="justify-content:flex-end"><span class="small">다음 영상 · ${korDay(utcToKstDate(next.created_at))}</span>${icon('right')}</a>` : html`<span class="btn ghost sm dis">다음 영상 없음</span>`}</div>
  <div class="chips mb8">${v.record != null ? chip(`기록 ${fmtNum(v.record)}${v.unit}`) : ''}${chip(STATUS[v.status][0], STATUS[v.status][1])}${v.corrected ? chip('강사 보정') : ''}${v.reviewed_at ? chip(`강사 확인 · ${v.reviewer || ''}`, 'blue') : ''}${v.confidence != null ? chip(`신뢰도 ${fmtNum(v.confidence, 1)}`) : ''}</div>
  <div class="card" id="viewer" data-id="${v.id}" data-code="${v.analysis_code || ''}" data-staff="${staff ? 1 : 0}" data-auto="${needAnalysis ? 1 : 0}"
     data-kf="${JSON.stringify(kf)}" data-moments="${JSON.stringify(A ? A.moments : [])}" data-metrics="${JSON.stringify(metrics)}"
     data-mdefs="${JSON.stringify(mdefs.filter(m => m.source === 'video').map(m => ({ key: m.key, name: m.name, unit: m.unit })))}">
    ${expired ? html`<div class="empty"><b>원본 영상 보관 기간이 지나 삭제됐어요</b><span>분석 결과는 아래에 남아 있어요.</span></div>` : html`
    <div class="player"><video src="/media/v/${v.id}" playsinline controls muted preload="auto"></video><canvas></canvas></div>
    <div class="vbar"><button class="btn sm ghost" data-act="joints">${icon('eyeoff')}<span>관절 숨기기</span></button>
      ${(A ? A.moments : []).map(([k, l]) => html`<button class="btn sm gray" data-jump="${k}" ${kf[k] == null ? 'disabled' : ''}>${l}</button>`)}</div>
    <div class="fstep"><button class="btn xs ghost" data-act="prev">${icon('left')}</button><span data-frame>1 / 1 (0.00초)</span><button class="btn xs ghost" data-act="next">${icon('right')}</button></div>
    <div data-analyzing hidden class="mt12"><div class="progress"><i></i></div><p class="small muted mt8" data-amsg>분석 준비 중…</p></div>`}
    ${staff && A && !expired ? html`<details class="mt12" data-correct><summary class="btn ghost full">${icon('ruler')}강사 보정</summary>
      <div class="mt12">
        <button class="btn sm gray" data-act="redo">${icon('refresh')}지금 방식으로 다시 찾기</button>
        <p class="small muted mb8 mt12">이 프레임(<b data-cur>1</b>)을 핵심 순간으로 지정</p>
        <div class="flex wrapf">${A.moments.map(([k, l]) => html`<button class="btn sm gray" data-set="${k}">${l} ← 여기</button>`)}</div>
        <div class="flex wrapf mt8"><button class="btn sm gray" data-act="measure">${icon('ruler')}각도 직접 재기</button><span class="small muted" data-measure-msg></span></div>
        <table class="tbl mt12"><tr><th>지표</th><th>저장된 값</th><th>바꾸면</th></tr>
          ${mdefs.filter(m => m.source === 'video').map(m => html`<tr><td>${m.name}</td><td>${metrics[m.key] != null ? `${fmtNum(metrics[m.key], 1)}${m.unit}` : '—'}</td><td data-new="${m.key}">—</td></tr>`)}</table>
        <div class="flex mt12"><button class="btn sm ghost" data-act="revert">${icon('undo')}되돌리기</button><button class="btn sm grow" data-act="save" disabled>${icon('save')}보정 저장</button></div>
        <p class="help">저장하면 새 결과로 바뀌고, 이전 결과는 이력으로 남습니다.</p></div></details>` : ''}
  </div>
  <div class="note gray">${icon('info')}<span>AI 분석은 참고용이며 정확한 판단은 강사 확인이 필요합니다. 2D 영상이라 카메라 각도에 따라 오차가 생길 수 있어요.</span></div>
  ${v.status === 'failed' ? html`<div class="note">${icon('alert')}<span>분석하지 못했어요${v.error ? ` (${v.error})` : ''}. 옆에서 온몸이 보이게 다시 찍어 주세요.</span></div>` : ''}
  <div class="card"><h3>측정 지표${sample ? html` <small class="amber">예시 기준값</small>` : ''}</h3>
  ${rows.length ? rows.map(r => html`<div class="metric-row"><span>${r.m.name}<span class="small muted"> ${r.b ? `· 기준 ${rangeText(r.b, r.m.unit)}` : ''}</span></span><b>${fmtNum(r.val, 1)}${r.m.unit}</b>
      ${r.j ? chip(LEVEL_LABEL[r.j.level], r.j.level === 'ok' || r.j.level === 'near' ? 'green' : r.j.level === 'low' ? 'amber' : 'red') : chip('기준 없음')}
      ${r.fb ? html`<div class="fb">${r.fb}</div>` : ''}</div>`)
    : html`<p class="small muted m0">${v.status === 'done' ? '측정한 지표가 없습니다. 관절이 잘 보이지 않았을 수 있어요.' : '분석이 끝나면 여기에 지표가 보여요.'}</p>`}</div>
  ${compare.length ? html`<div class="card"><h3>이전 영상과 비교</h3><div class="scroll-x"><table class="tbl"><tr><th>지표</th><th>이번</th>${compare.map(c => html`<th><a href="/videos/${c.id}">${korDay(utcToKstDate(c.created_at))}</a></th>`)}</tr>
    ${mdefs.map(m => { const cv = m.source === 'record' ? v.record : metrics[m.key]; const ps = compare.map(c => (m.source === 'record' ? c.record : J(c.metrics)[m.key])); if (cv == null && ps.every(x => x == null)) return ''; return html`<tr><td>${m.name}</td><td><b>${cv == null ? '—' : fmtNum(cv, 1) + m.unit}</b></td>${ps.map(x => html`<td>${x == null ? '—' : fmtNum(x, 1) + m.unit}</td>`)}</tr>`; })}</table></div></div>` : ''}
  <div class="card" id="points"><h3>중요 포인트 ${cps.length ? html`<small>좋음 ${good} · 나쁨 ${badN}</small>` : ''}</h3>
  ${cps.length ? cpState.map(({ c, mk, ai, value }) => html`<div class="pt"><div class="flex between"><b>${c.name}</b>${value ? chip(value === 'good' ? '좋음' : '나쁨', value === 'good' ? 'green' : 'red') : chip('미표시')}</div>
      ${c.description ? html`<p class="small muted mt8 mb0">${c.description}</p>` : ''}
      <p class="small muted mt8 mb0">${mk ? `강사 표시 · ${mk.name || ''}` : ai ? 'AI 자동 표시' : ''}</p>
      ${staff ? html`<form method="post" action="/videos/${v.id}/mark" class="gb">${csrfField(ctx)}<input type="hidden" name="checkpoint_id" value="${c.id}">
        <button name="value" value="good" class="good ${mk?.value === 'good' ? 'on' : ''}">좋음</button><button name="value" value="bad" class="bad ${mk?.value === 'bad' ? 'on' : ''}">나쁨</button></form>` : ''}</div>`)
    : html`<p class="small muted m0">이 종목은 아직 중요 포인트가 없어요.${staff ? html` <a href="/admin/exercises/${v.eid}?tab=checkpoints"><u>포인트 만들기</u></a>` : ''}</p>`}
  ${staff && cps.length ? html`<p class="help">누르면 바로 저장되고 학생·학부모 화면에 보여요. 직접 누른 표시가 AI보다 우선이고, 같은 버튼을 다시 누르면 직접 표시가 지워져 AI 판정으로 돌아가요. <a href="/admin/exercises/${v.eid}?tab=checkpoints"><u>포인트 고치기</u></a></p>` : ''}</div>
  ${commentsBlock(ctx, 'video', v.id, v.student_id)}
  ${staff ? html`<form method="post" action="/videos/${v.id}/review" class="mb8">${csrfField(ctx)}<input type="hidden" name="v" value="${v.reviewed_at ? 0 : 1}"><button class="btn ${v.reviewed_at ? 'ghost' : 'dark'} full">${icon('checkc')}${v.reviewed_at ? '강사 확인 취소' : '강사 확인 완료'}</button></form>` : ''}
  ${hist.length ? html`<div class="card"><h3>분석 이력</h3><div class="list mb0">${hist.map(a => html`<div><div class="row-m"><b>${a.kind === 'manual' ? `강사 보정 (${a.name || ''})` : '자동 분석'}${a.is_current ? html` <span class="red small">현재</span>` : ''}</b><span>${korDateTime(a.created_at)}</span></div>
    ${staff && !a.is_current ? html`<form method="post" action="/videos/${v.id}/history/${a.id}">${csrfField(ctx)}<button class="btn xs ghost">이 결과로</button></form>` : ''}</div>`)}</div></div>` : ''}
  <p class="small muted">${v.file ? `원본 영상 보관: ${korDay(utcToKstDate(v.expires_at))}까지 (이후 자동 삭제, 분석 결과는 남음)` : '원본 영상 삭제됨'}${cur?.algo ? ` · 분석 방식 ${cur.algo}` : ''}</p>
  ${self || staff ? html`<form method="post" action="/videos/${v.id}/delete" data-confirm="이 영상과 분석 결과를 지울까요?">${csrfField(ctx)}<button class="btn danger full">${icon('trash')}영상 지우기</button></form>` : ''}
  <script>window.VID={csrf:'${ctx.csrf}'};window.MP_CFG=${raw(JSON.stringify({ base: process.env.MEDIAPIPE_BASE || undefined, model: process.env.MEDIAPIPE_MODEL || undefined }))}</script><script type="module" src="/js/pose/viewer.js?v=3"></script>`, { active: self ? '/me/videos' : undefined });
});

// 보관 기간이 지난 원본 영상 삭제
export function cleanupVideos() {
  const rows = all(`SELECT id, file FROM videos WHERE file IS NOT NULL AND expires_at < datetime('now')`);
  for (const r of rows) { fs.rm(path.join(UP, r.file), () => {}); run('UPDATE videos SET file=NULL WHERE id=?', r.id); }
  return rows.length;
}
setInterval(cleanupVideos, 6 * 3600e3).unref();
setTimeout(cleanupVideos, 5000).unref();
