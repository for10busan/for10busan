// 영상 분석 결과 화면: 관절 오버레이, 프레임 이동, 강사 보정, 자동 분석 실행
import { BONES, angle3 } from './analyze.js';

const root = document.getElementById('viewer');
const id = root.dataset.id;
const csrf = (window.VID || {}).csrf;
const video = root.querySelector('video');
const canvas = root.querySelector('canvas');
const ctx = canvas && canvas.getContext('2d');
const J = s => { try { return JSON.parse(s || 'null'); } catch { return null; } };
const savedKf = J(root.dataset.kf) || {};
const moments = J(root.dataset.moments) || [];
const mdefs = J(root.dataset.mdefs) || [];
const savedM = J(root.dataset.metrics) || {};
let pose = null, showJoints = true, cur = 0;
let pendingKf = null, overrides = {}, measuring = null;

const api = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': csrf, Accept: 'application/json' }, body: JSON.stringify(body || {}) })
  .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || '요청 실패'); return j; });

function nearestFrame(t) {
  if (!pose) return 0;
  let best = 0, bd = Infinity;
  pose.frames.forEach((f, i) => { const ft = f ? f.t : i / pose.fps; const d = Math.abs(ft - t); if (d < bd) { bd = d; best = i; } });
  return best;
}
const frameTime = i => { const f = pose.frames[i]; return f ? f.t : i / pose.fps; };
// 영상이 화면에 맞춰 줄어든(letterbox) 영역 계산
function videoRect() {
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
  const s = Math.min(cw / vw, ch / vh);
  return { x: (cw - vw * s) / 2, y: (ch - vh * s) / 2, w: vw * s, h: vh * s };
}
function draw() {
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const lbl = root.querySelector('[data-frame]');
  if (pose && pose.frames.length) {
    cur = nearestFrame(video.currentTime);
    if (lbl) lbl.textContent = `${cur + 1} / ${pose.frames.length} (${frameTime(cur).toFixed(2)}초)`;
    const c2 = root.querySelector('[data-cur]'); if (c2) c2.textContent = cur + 1;
    const f = pose.frames[cur];
    if (showJoints && f) {
      const r = videoRect();
      const P = i => [r.x + f.p[i * 3] * r.w, r.y + f.p[i * 3 + 1] * r.h, f.p[i * 3 + 2]];
      ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (const [a, b] of BONES) { const A = P(a), B = P(b); if (A[2] < 0.3 || B[2] < 0.3) continue; ctx.strokeStyle = a % 2 ? 'rgba(34,197,94,.95)' : 'rgba(34,197,94,.45)'; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); }
      for (let i = 1; i < 17; i++) { const A = P(i); if (A[2] < 0.3) continue; ctx.fillStyle = i % 2 ? '#facc15' : 'rgba(250,204,21,.5)'; ctx.beginPath(); ctx.arc(A[0], A[1], 4, 0, 7); ctx.fill(); }
    }
    // 핵심 순간 표시
    const kf = pendingKf || savedKf;
    const hit = moments.find(([k]) => kf[k] === cur);
    if (hit) { ctx.fillStyle = 'rgba(200,16,24,.9)'; ctx.font = 'bold 13px sans-serif'; const w = ctx.measureText(hit[1]).width + 14; ctx.fillRect(8, 8, w, 22); ctx.fillStyle = '#fff'; ctx.fillText(hit[1], 15, 24); }
  }
  if (measuring && measuring.pts.length) {
    ctx.strokeStyle = '#38bdf8'; ctx.fillStyle = '#38bdf8'; ctx.lineWidth = 2.5;
    ctx.beginPath(); measuring.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
    measuring.pts.forEach(p => { ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, 7); ctx.fill(); });
    if (measuring.pts.length === 3) { const a = angle3(...measuring.pts); ctx.font = 'bold 16px sans-serif'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3; const [x, y] = measuring.pts[1]; ctx.strokeText(a.toFixed(1) + '°', x + 10, y - 10); ctx.fillText(a.toFixed(1) + '°', x + 10, y - 10); }
  }
}
function loop() { draw(); if (video && 'requestVideoFrameCallback' in video) video.requestVideoFrameCallback(loop); else requestAnimationFrame(loop); }
const goto = i => { if (!pose) return; i = Math.max(0, Math.min(pose.frames.length - 1, i)); video.pause(); video.currentTime = frameTime(i) + 0.001; setTimeout(draw, 60); };

async function loadPose() {
  const r = await fetch(`/api/videos/${id}/pose`, { headers: { Accept: 'application/json' } });
  pose = await r.json();
  draw();
}

// ---------- 자동 분석 (업로드 직후) ----------
async function autoAnalyze() {
  const box = root.querySelector('[data-analyzing]'); if (!box) return;
  box.hidden = false;
  const bar = box.querySelector('i'), msg = box.querySelector('[data-amsg]');
  const prog = (p, m) => { bar.style.width = Math.round(p * 100) + '%'; if (m) msg.textContent = m; };
  try {
    await api(`/api/videos/${id}/status`, { status: 'analyzing' });
    const { extractPose } = await import('./runner.js');
    const res = await extractPose(video.currentSrc || video.src, prog);
    if (!res.found) throw new Error('사람을 찾지 못했어요. 온몸이 보이게 옆에서 찍어 주세요.');
    msg.textContent = '결과 저장 중…';
    await api(`/api/videos/${id}/pose`, res);
    location.reload();
  } catch (e) {
    console.error(e);
    const net = /dynamically imported|Failed to fetch|NetworkError|import/i.test(e.message);
    msg.textContent = net ? '분석 실패: AI 모델을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.' : '분석 실패: ' + e.message;
    bar.style.background = '#c81018';
    if (!net) await api(`/api/videos/${id}/pose`, { error: e.message }).catch(() => {});
    const retry = document.createElement('button'); retry.className = 'btn sm ghost mt8'; retry.textContent = '다시 시도'; retry.onclick = () => location.reload(); box.append(retry);
  }
}

// ---------- 강사 보정 ----------
async function refreshPreview() {
  const saveBtn = root.querySelector('[data-act=save]');
  const changed = pendingKf || Object.keys(overrides).length;
  if (saveBtn) saveBtn.disabled = !changed;
  let m = {};
  if (pendingKf) { try { m = (await api(`/api/videos/${id}/preview`, { keyFrames: pendingKf })).metrics || {}; } catch (e) { alertMsg(e.message); } }
  for (const td of root.querySelectorAll('[data-new]')) {
    const k = td.dataset.new; const def = mdefs.find(d => d.key === k);
    const v = overrides[k] ?? (pendingKf ? m[k] : null);
    td.textContent = v == null ? '—' : `${(+v).toFixed(1)}${def ? def.unit : ''}`;
    const changed = v != null && (savedM[k] == null || Math.abs(v - savedM[k]) >= 0.05);
    td.style.color = changed ? '#c81018' : ''; td.style.fontWeight = changed ? '700' : '';
  }
}
function alertMsg(t) { const el = root.querySelector('[data-measure-msg]'); if (el) el.textContent = t; }

root.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b || !root.contains(b)) return;
  if (b.dataset.jump) { const kf = pendingKf || savedKf; if (kf[b.dataset.jump] != null) goto(kf[b.dataset.jump]); return; }
  if (b.dataset.set) { pendingKf = { ...(pendingKf || savedKf), [b.dataset.set]: cur }; refreshPreview(); draw(); return; }
  const act = b.dataset.act;
  if (act === 'joints') { showJoints = !showJoints; b.querySelector('span').textContent = showJoints ? '관절 숨기기' : '관절 보기'; draw(); }
  if (act === 'prev') goto(cur - 1);
  if (act === 'next') goto(cur + 1);
  if (act === 'revert') { pendingKf = null; overrides = {}; measuring = null; root.querySelector('.player')?.classList.remove('measuring'); alertMsg(''); refreshPreview(); draw(); }
  if (act === 'measure') {
    video.pause(); measuring = { pts: [] }; root.querySelector('.player').classList.add('measuring');
    alertMsg('영상 위에서 점 3개를 차례로 누르세요 (가운데 점이 꼭짓점)');
  }
  if (act === 'redo') { if (!confirm('자동 분석을 지금 방식으로 다시 실행할까요? (현재 결과는 이력으로 남아요)')) return; b.disabled = true; await api(`/api/videos/${id}/correct`, { reset: true }).then(() => location.reload()).catch(err => { alertMsg(err.message); b.disabled = false; }); }
  if (act === 'save') { b.disabled = true; await api(`/api/videos/${id}/correct`, { keyFrames: pendingKf || savedKf, overrides }).then(() => location.reload()).catch(err => { alertMsg(err.message); b.disabled = false; }); }
});
canvas && canvas.addEventListener('click', e => {
  if (!measuring) return;
  const r = canvas.getBoundingClientRect();
  measuring.pts.push([e.clientX - r.left, e.clientY - r.top]);
  if (measuring.pts.length === 3) {
    const a = angle3(...measuring.pts);
    const wrap = root.querySelector('[data-measure-msg]');
    wrap.innerHTML = '';
    const s = document.createElement('select'); s.style.cssText = 'height:34px;width:auto';
    s.innerHTML = `<option value="">${a.toFixed(1)}° — 어느 지표에 넣을까요?</option>` + mdefs.map(d => `<option value="${d.key}">${d.name}</option>`).join('');
    s.onchange = () => { if (s.value) { overrides[s.value] = Math.round(a * 10) / 10; refreshPreview(); } measuring = null; root.querySelector('.player').classList.remove('measuring'); wrap.textContent = s.value ? `${a.toFixed(1)}° 입력됨` : ''; draw(); };
    wrap.append(s);
  }
  draw();
});

if (video) {
  video.addEventListener('loadedmetadata', draw);
  video.addEventListener('seeked', draw);
  window.addEventListener('resize', draw);
  loop();
  if (root.dataset.auto === '1') video.addEventListener('loadeddata', autoAnalyze, { once: true });
  else loadPose();
}
