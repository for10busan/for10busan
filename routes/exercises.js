import fs from 'node:fs';
import path from 'node:path';
import { get, post, put, notFound, bad } from '../lib/router.js';
import { one, all, run, tx, J, DATA_DIR } from '../lib/db.js';
import { html, icon, pageTitle, empty, csrfField, pills, chip } from '../lib/html.js';
import { num, fmtNum, korDateTime, GRADES } from '../lib/util.js';
import { benchmarksFor, judge, feedbackText, rangeText, LEVEL_LABEL, DEFAULT_TEMPLATES } from '../lib/services.js';
import { ALGOS } from '../public/js/pose/analyze.js';
import { serveFile } from '../lib/static.js';

const UNITS = ['cm', 'm', '초', '회', 'kg'];
const TABS = [['기본 정보', 'info'], ['촬영 가이드', 'guide'], ['지표', 'metrics'], ['기준값', 'benchmarks'], ['피드백 문구', 'templates'], ['중요 포인트', 'checkpoints'], ['판정 미리보기', 'preview']];
const G_LABEL = { all: '성별 전체', M: '남', F: '여' }; const GR_LABEL = g => (g === 'all' ? '학년 전체' : g);
const desc = e => (e.kind === 'video' ? `영상 자세 분석 · 지표 ${one('SELECT COUNT(*) c FROM metrics WHERE exercise_id=? AND enabled=1', e.id).c}개 · ` : '기록 입력형 · ') + `${e.unit} · ${e.higher_better ? '높을수록 좋음' : '낮을수록 좋음'}`;

function basicFields(e = {}) {
  return html`
  <label class="field"><span>종목 이름</span><input type="text" name="name" value="${e.name || ''}" required></label>
  <div class="field"><span class="lbl">기록 단위</span><div class="tg">${UNITS.map(u => html`<label><input type="radio" name="unit" value="${u}" ${(e.unit || 'cm') === u ? 'checked' : ''}><span>${u}</span></label>`)}</div></div>
  <div class="field"><span class="lbl">좋은 기록</span><div class="tg"><label><input type="radio" name="hb" value="1" ${e.higher_better !== 0 ? 'checked' : ''}><span>높을수록 좋음 (멀리뛰기 등)</span></label><label><input type="radio" name="hb" value="0" ${e.higher_better === 0 ? 'checked' : ''}><span>낮을수록 좋음 (달리기 등)</span></label></div></div>
  <div class="field"><span class="lbl">유형</span><div class="tg"><label><input type="radio" name="kind" value="record" ${e.kind !== 'video' ? 'checked' : ''}><span>기록 입력형</span></label><label><input type="radio" name="kind" value="video" ${e.kind === 'video' ? 'checked' : ''}><span>영상 자세 분석</span></label></div></div>
  ${e.id ? html`<label class="field"><span>분석 코드</span><select name="analysis_code"><option value="">고르기</option>${Object.entries(ALGOS).map(([k, a]) => html`<option value="${k}" ${e.analysis_code === k ? 'selected' : ''}>${a.name}</option>`)}</select>
    <small>새 종목의 자세 분석은 개발이 필요합니다. 목록에 없으면 '기록 입력형'으로 두세요.</small></label>` : ''}
  <label class="field"><span>설명</span><textarea name="description" rows="2">${e.description || ''}</textarea></label>
  <label class="check"><input type="checkbox" name="active" ${e.active === 0 ? '' : 'checked'}><span>사용 중 <span class="muted small">(끄면 일지·대학 실기 종목 선택에서 숨김)</span></span></label>
  <label class="check"><input type="checkbox" name="is_sample" ${e.is_sample === 0 ? '' : 'checked'}><span>예시 종목 <span class="muted small">(코치진 확정 전) — 확정했으면 체크를 해제하세요</span></span></label>`;
}

get('/admin/exercises', 'staff', ctx => {
  const exs = all('SELECT * FROM exercises ORDER BY sort,id');
  ctx.page('종목 관리', html`${pageTitle('종목 관리', '종목·촬영 가이드·지표·기준값·피드백 문구를 관리합니다.')}
  <div class="list">${exs.map(e => html`<a href="/admin/exercises/${e.id}"><div class="row-m"><b>${e.name} ${e.is_sample ? chip('예시') : ''} ${e.active ? '' : chip('숨김', 'red')}</b><span>${desc(e)}</span></div>${icon('right')}</a>`)}</div>
  <h2 class="sec">종목 추가</h2><form method="post" action="/admin/exercises" class="formcard">${csrfField(ctx)}${basicFields({})}<button class="btn full">종목 만들기</button></form>`);
});
function readBasic(b) {
  const name = (b.name || '').trim(); if (!name) bad('종목 이름을 입력해 주세요.');
  return { name, unit: UNITS.includes(b.unit) ? b.unit : 'cm', hb: b.hb === '0' ? 0 : 1, kind: b.kind === 'video' ? 'video' : 'record', code: ALGOS[b.analysis_code] ? b.analysis_code : null, description: b.description || null, active: b.active ? 1 : 0, is_sample: b.is_sample ? 1 : 0 };
}
post('/admin/exercises', 'staff', ctx => {
  const e = readBasic(ctx.body);
  const r = run('INSERT INTO exercises(name,unit,higher_better,kind,description,active,is_sample,sort) VALUES(?,?,?,?,?,?,?,(SELECT COALESCE(MAX(sort),0)+1 FROM exercises))', e.name, e.unit, e.hb, e.kind, e.description, e.active, e.is_sample);
  const id = Number(r.lastInsertRowid);
  run(`INSERT INTO metrics(exercise_id,key,name,unit,moment,description,source,sort) VALUES(?,'record','기록',?,'운동일지에 입력한 기록',?,'record',0)`, id, e.unit, e.hb ? '높을수록 좋은 기록' : '낮을수록 좋은 기록');
  ctx.redirect(`/admin/exercises/${id}`, '종목을 만들었어요.');
});

// 분석 코드를 고르면 그 알고리즘의 지표를 자동으로 만든다
export function syncAlgoMetrics(exId, code) {
  const A = ALGOS[code]; if (!A) return;
  A.metrics.forEach(([key, name, unit, moment, d], i) => run(`INSERT OR IGNORE INTO metrics(exercise_id,key,name,unit,moment,description,source,sort) VALUES(?,?,?,?,?,?,'video',?)`, exId, key, name, unit, moment, d, i + 1));
}

get('/admin/exercises/:id', 'staff', ctx => {
  const e = one('SELECT * FROM exercises WHERE id=?', ctx.params.id) || notFound();
  const tab = TABS.some(([, k]) => k === ctx.query.tab) ? ctx.query.tab : 'info';
  const exs = all('SELECT id,name FROM exercises ORDER BY sort,id');
  let body;
  const metrics = all('SELECT * FROM metrics WHERE exercise_id=? ORDER BY sort,id', e.id);
  if (tab === 'info') body = html`<form method="post" action="/admin/exercises/${e.id}/info" class="formcard">${csrfField(ctx)}${basicFields(e)}<button class="btn full">저장</button></form>
    <form method="post" action="/admin/exercises/${e.id}/delete" class="mt12" data-confirm="이 종목을 삭제할까요? 일지·영상 기록의 종목 정보도 함께 사라질 수 있어요.">${csrfField(ctx)}<button class="btn danger full">${icon('trash')}종목 삭제</button></form>`;
  if (tab === 'guide') {
    const g = J(e.guide); const photos = J(e.guide_photos, []); const cautions = g.cautions && g.cautions.length ? g.cautions : [''];
    body = html`<form method="post" action="/admin/exercises/${e.id}/guide" class="formcard">${csrfField(ctx)}
      <label class="field"><span>카메라 위치</span><input type="text" name="position" value="${g.position || ''}" placeholder="예: 진행 방향의 옆(측면)에서 90°로"></label>
      <label class="field"><span>거리</span><input type="text" name="distance" value="${g.distance || ''}" placeholder="예: 3~4m"></label>
      <label class="field"><span>높이</span><input type="text" name="height" value="${g.height || ''}" placeholder="예: 허리 높이, 고정"></label>
      <span class="lbl">주의사항</span><div id="items">${cautions.map(c => html`<div class="flex mb8 li"><input type="text" name="cautions[]" value="${c}"><button type="button" class="btn xs gray" data-del>${icon('x')}</button></div>`)}</div>
      <button type="button" class="btn gray sm full mb8" id="addItem">${icon('plus')}주의사항 추가</button>
      <button class="btn full">가이드 저장</button></form>
      <div class="card mt12"><h3>예시 사진 <small>(${photos.length}/3)</small></h3>
        <div class="flex wrapf">${photos.map(p => html`<div style="position:relative"><img src="/media/guide/${p}" style="height:110px;border-radius:10px" alt="예시">
          <form method="post" action="/admin/exercises/${e.id}/photo-del" style="position:absolute;top:4px;right:4px">${csrfField(ctx)}<input type="hidden" name="f" value="${p}"><button class="btn xs dark">${icon('x')}</button></form></div>`)}</div>
        ${photos.length < 3 ? html`<label class="btn ghost full mt12">${icon('upload')}예시 사진 올리기<input type="file" accept="image/*" hidden data-photo="${e.id}"></label>` : ''}</div>
      <script>document.querySelector('[data-photo]')?.addEventListener('change',async ev=>{const f=ev.target.files[0];if(!f)return;const r=await fetch('/api/exercises/${e.id}/photo',{method:'PUT',body:f,headers:{'Content-Type':f.type,'X-CSRF':'${ctx.csrf}',Accept:'application/json'}});if(r.ok)location.reload();else toast('올리기 실패')})</script>`;
  }
  if (tab === 'metrics') {
    const vids = all(`SELECT v.id, v.created_at, u.name FROM videos v JOIN users u ON u.id=v.student_id WHERE v.exercise_id=? AND v.status='done' ORDER BY v.id DESC LIMIT 5`, e.id);
    body = html`${e.kind === 'video' ? html`<div class="card"><h3>${icon('film')} 샘플 영상으로 선 확인</h3><p class="small muted mt0">분석이 끝난 최근 영상입니다. 고르면 영상 위에 관절과 핵심 순간을 확인할 수 있어요.</p>
      ${vids.length ? html`<div class="chips">${vids.map(v => html`<a class="chip" href="/videos/${v.id}">${v.name} · ${korDateTime(v.created_at)}</a>`)}</div>` : html`<p class="small muted">아직 분석된 영상이 없어요.</p>`}</div>` : ''}
    ${metrics.map(m => html`<form method="post" action="/admin/exercises/${e.id}/metric/${m.id}" class="card">${csrfField(ctx)}
      <div class="flex"><input type="text" name="name" value="${m.name}" class="grow" required><span class="muted">${m.unit}</span><input type="number" name="sort" value="${m.sort}" style="width:64px" title="순서"></div>
      <input type="text" name="moment" value="${m.moment || ''}" placeholder="측정 순간 (예: 공을 놓는 순간)" class="mt8">
      <input type="text" name="description" value="${m.description || ''}" placeholder="학생에게 보여 줄 설명" class="mt8">
      <a class="small red b" href="?tab=preview" style="display:inline-flex;gap:4px;margin-top:10px">${icon('eye')}학생 화면 미리보기 열기</a>
      <div class="flex between mt8"><label class="check m0"><input type="checkbox" name="enabled" ${m.enabled ? 'checked' : ''}><span>사용 <span class="muted small">(${m.key})</span></span></label>
        <div class="flex">${m.source !== 'record' ? html`<button class="btn sm danger" name="del" value="1" formnovalidate>${icon('trash')}삭제</button>` : ''}<button class="btn sm">저장</button></div></div></form>`)}
    <div class="card"><h3>보조 지표 직접 만들기</h3><p class="small muted mt0">영상 분석이 아니라 학생이 일지에 숫자로 직접 넣는 지표입니다. 예) 1구간 기록(초), 턴 시간(초), 실수 횟수(회)</p>
      <form method="post" action="/admin/exercises/${e.id}/metric">${csrfField(ctx)}
        <label class="field"><span>지표 이름</span><input type="text" name="name" required></label>
        <div class="field"><span class="lbl">단위</span><div class="tg">${['초', '회', 'cm', 'm', 'kg', '%', '°'].map((u, i) => html`<label><input type="radio" name="unit" value="${u}" ${i ? '' : 'checked'}><span>${u}</span></label>`)}</div></div>
        <div class="field"><span class="lbl">좋은 방향</span><div class="tg"><label><input type="radio" name="hb" value="0" checked><span>낮을수록 좋음 (시간·실수)</span></label><label><input type="radio" name="hb" value="1"><span>높을수록 좋음 (횟수·거리)</span></label></div></div>
        <label class="field"><span>설명 (선택)</span><input type="text" name="description"></label>
        <button class="btn full">보조 지표 만들기</button></form></div>`;
  }
  if (tab === 'benchmarks') {
    const sets = all('SELECT * FROM benchmark_sets WHERE exercise_id=? ORDER BY version DESC', e.id);
    const selId = Number(ctx.query.set) || sets[0]?.id; const sel = sets.find(s => s.id === selId);
    const vals = J(sel?.vals); const scoped = sel && (sel.gender !== 'all' || sel.grade !== 'all');
    body = html`${sets.length ? html`<div class="list">${sets.map(s => html`<a href="?tab=benchmarks&set=${s.id}" style="${s.id === selId ? 'outline:2px solid var(--red);outline-offset:-2px' : ''}"><div class="row-m"><b>v${s.version} · ${G_LABEL[s.gender]} · ${GR_LABEL(s.grade)}</b></div>
      <div class="row-r">${s.status === 'published' ? chip('발행 중', 'green') : chip('초안', 'blue')}${s.is_sample ? chip('예시') : ''}</div></a>`)}</div>` : empty('아직 기준값이 없어요', '아래에서 초안을 만들어 주세요.')}
    <div class="card"><h3>다른 범위(성별·학년)용 새 초안</h3><form method="post" action="/admin/exercises/${e.id}/bset" class="flex wrapf">${csrfField(ctx)}
      <select name="gender" style="width:auto">${Object.entries(G_LABEL).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select>
      <select name="grade" style="width:auto"><option value="all">학년 전체</option>${GRADES.map(g => html`<option>${g}</option>`)}</select>
      <button class="btn sm gray" name="copy" value="">빈 초안 만들기</button>${sel ? html`<button class="btn sm gray" name="copy" value="${sel.id}">v${sel.version} 복사해서 만들기</button>` : ''}</form></div>
    ${sel ? html`<form method="post" action="/admin/exercises/${e.id}/bset/${sel.id}" class="card">${csrfField(ctx)}
      <h3>v${sel.version} · ${G_LABEL[sel.gender]} · ${GR_LABEL(sel.grade)} ${sel.status === 'published' ? chip('발행 중', 'green') : chip('초안', 'blue')}</h3>
      ${scoped ? html`<p class="small muted mt0">이 범위에서 다르게 할 지표만 채우세요. 비워 둔 지표는 '성별 전체 · 학년 전체' 기준값을 씁니다.</p>` : ''}
      <div class="scroll-x"><table class="tbl"><tr><th>지표</th><th>최소</th><th>최대</th><th>목표 (선택)</th><th>허용 오차</th></tr>
      ${metrics.filter(m => m.enabled).map(m => { const v = vals[m.key] || {}; return html`<tr><td>${m.name} <span class="muted">(${m.unit})</span></td>
        ${['min', 'max', 'target', 'tol'].map(k => html`<td><input type="number" step="any" name="${m.key}.${k}" value="${v[k] ?? ''}" style="width:72px"></td>`)}</tr>`; })}</table></div>
      <label class="field mt12"><span>근거·출처 메모</span><textarea name="note" rows="2">${sel.note || ''}</textarea></label>
      <label class="check"><input type="checkbox" name="is_sample" ${sel.is_sample ? 'checked' : ''}><span>예시 값 (코치진 확정 전) — 학생 화면에 "예시 기준값"으로 안내됩니다</span></label>
      <div class="flex wrapf"><button class="btn sm gray" name="act" value="save">초안 저장</button><button class="btn sm" name="act" value="publish">${sel.status === 'published' ? '저장 (발행 유지)' : '저장하고 발행'}</button>
        ${sel.status === 'published' ? html`<button class="btn sm ghost" name="act" value="unpublish">발행 중지</button>` : ''}<button class="btn sm danger" name="act" value="delete" formnovalidate>삭제</button></div></form>` : ''}`;
  }
  if (tab === 'templates') {
    const tpls = Object.fromEntries(all('SELECT * FROM feedback_templates WHERE exercise_id=?', e.id).map(t => [t.metric_key, t]));
    const VARS = [['{지표}', '지표 이름 (예: 도약각)'], ['{측정값}', '측정한 값과 단위 (예: 36°)'], ['{기준}', '기준 범위 (예: 40~45°)'], ['{목표}', '목표값 (예: 42°)'], ['{차이}', '기준과의 차이 (예: 4°, 항상 양수)'], ['{단위}', '단위 (예: °)']];
    const { vals } = benchmarksFor(e.id, 'M', 'all');
    body = html`<div class="note gray" style="display:block"><b class="small">쓸 수 있는 변수</b> <span class="small muted">(버튼을 누르면 커서 위치에 들어갑니다)</span><div class="row2 small mt8">${VARS.map(([v, d]) => html`<span><b>${v}</b> ${d}</span>`)}</div></div>
    ${metrics.filter(m => m.enabled).map(m => { const t = tpls[m.key] || DEFAULT_TEMPLATES; const b = vals[m.key] || { min: 10, max: 20 }; const sampleV = { low: (b.min ?? b.max) - 9, ok: ((b.min ?? 0) + (b.max ?? b.min)) / 2, near: (b.min ?? b.max) - (Number(b.tol) || 1) / 2, high: (b.max ?? b.min) + 9 };
      return html`<form method="post" action="/admin/exercises/${e.id}/tpl" class="card">${csrfField(ctx)}<input type="hidden" name="key" value="${m.key}"><h3>${m.name} <small>(${m.unit})</small></h3>
      ${[['low', '낮음일 때'], ['ok', '적정일 때'], ['near', '적정(허용 오차 안)일 때'], ['high', '높음일 때']].map(([lv, l]) => html`<label class="field"><span>${l}</span>${lv === 'near' ? html`<small style="margin:-2px 0 6px">판정은 ‘적정’이지만 측정값이 기준 범위 밖(허용 오차 안)일 때 씁니다. {차이}는 가까운 경계와의 차이입니다.</small>` : ''}
        <textarea name="${lv}" rows="2" data-tpl>${t[lv] || ''}</textarea><div class="chips mt8">${VARS.map(([v]) => html`<button type="button" class="chip" data-ins="${v}">${v}</button>`)}</div>
        <small>미리보기: ${feedbackText(t, m, sampleV[lv], b, judge(sampleV[lv], b) || { level: lv, diff: 9 })}</small></label>`)}
      <button class="btn sm full">${m.name} 문구 저장</button></form>`; })}
    <script>let last;document.addEventListener('focusin',e=>{if(e.target.matches('[data-tpl]'))last=e.target});document.addEventListener('click',e=>{const b=e.target.closest('[data-ins]');if(!b)return;const ta=last&&b.closest('.field').contains(last)?last:b.closest('.field').querySelector('textarea');const s=ta.selectionStart??ta.value.length;ta.value=ta.value.slice(0,s)+b.dataset.ins+ta.value.slice(ta.selectionEnd??s);ta.focus();ta.selectionStart=ta.selectionEnd=s+b.dataset.ins.length;})</script>`;
  }
  if (tab === 'checkpoints') {
    const cps = all('SELECT * FROM checkpoints WHERE exercise_id=? ORDER BY sort,id', e.id);
    const mOpts = sel => html`<option value="">사용 안 함 (직원이 직접 표시)</option>${metrics.filter(m => m.enabled).map(m => html`<option value="${m.key}" ${sel === m.key ? 'selected' : ''}>${m.name} (${m.unit})</option>`)}`;
    const form = (c, action, label) => html`<form method="post" action="${action}" class="${c.id ? 'pt' : ''}">${csrfField(ctx)}
      <label class="field"><span>포인트 이름</span><input type="text" name="name" value="${c.name || ''}" required placeholder="예: 팔 스윙을 크게"></label>
      <label class="field"><span>설명 (선택)</span><input type="text" name="description" value="${c.description || ''}" placeholder="학생이 보고 이해할 수 있게 짧게. 예) 백스윙 때 팔이 엉덩이 뒤까지 가야 해요"></label>
      <label class="field"><span>AI 자동 표시 (선택) · 볼 지표</span><select name="metric_key">${mOpts(c.metric_key)}</select></label>
      <div class="row2"><label class="field"><span>좋음 범위 최소</span><input type="number" step="any" name="good_min" value="${c.good_min ?? ''}"></label><label class="field"><span>좋음 범위 최대</span><input type="number" step="any" name="good_max" value="${c.good_max ?? ''}"></label></div>
      <div class="flex">${c.id ? html`<button class="btn sm danger" name="del" value="1" formnovalidate>${icon('trash')}삭제</button>` : ''}<button class="btn sm grow">${label}</button></div></form>`;
    body = html`<div class="card"><h3>중요 포인트</h3><p class="small muted mt0">이 종목 영상을 볼 때 확인할 항목입니다. 원장·부원장·강사가 영상 화면에서 포인트마다 좋음·나쁨을 표시하면 학생·학부모에게 바로 보여요. 각도 등 지표와 좋음 범위를 정해 두면 AI가 영상 분석 값으로 자동 표시해요(직원이 직접 누른 표시가 우선). 여기서 고치면 지난 영상까지 모든 영상 화면에 바로 적용됩니다.</p>
      ${cps.length ? cps.map(c => form(c, `/admin/exercises/${e.id}/cp/${c.id}`, '저장')) : empty('아직 포인트가 없어요. 아래에서 추가해 주세요.', '예) 팔 스윙을 크게, 착지 때 무릎 굽히기')}</div>
      <div class="card"><h3>포인트 추가</h3>${form({}, `/admin/exercises/${e.id}/cp`, '추가')}</div>`;
  }
  if (tab === 'preview') {
    const sets = all('SELECT * FROM benchmark_sets WHERE exercise_id=? ORDER BY version DESC', e.id);
    const gender = ['M', 'F'].includes(ctx.query.g) ? ctx.query.g : 'M'; const grade = GRADES.includes(ctx.query.gr) ? ctx.query.gr : '고3';
    const setId = Number(ctx.query.set) || null;
    const { vals, used } = benchmarksFor(e.id, gender, grade, { setId });
    const tpls = Object.fromEntries(all('SELECT * FROM feedback_templates WHERE exercise_id=?', e.id).map(t => [t.metric_key, t]));
    const q = (k, v) => '?' + new URLSearchParams({ tab: 'preview', g: gender, gr: grade, ...(setId ? { set: setId } : {}), ...Object.fromEntries(metrics.map(m => [m.key, ctx.query[m.key] ?? ''])), [k]: v }).toString();
    body = html`<form method="get" class="card"><input type="hidden" name="tab" value="preview">
      <label class="field"><span>기준값</span><select name="set"><option value="">자동 (학생 조건으로 고르기)</option>${sets.map(s => html`<option value="${s.id}" ${s.id === setId ? 'selected' : ''}>v${s.version} · ${G_LABEL[s.gender]} · ${GR_LABEL(s.grade)} · ${s.status === 'published' ? '발행 중' : '초안'}</option>`)}</select></label>
      <div class="pills mb8">${['M', 'F'].map(g => html`<a class="pill ${g === gender ? 'on' : ''}" href="${q('g', g)}">${g === 'M' ? '남학생' : '여학생'}</a>`)}</div>
      <div class="pills">${GRADES.map(g => html`<a class="pill ${g === grade ? 'on' : ''}" href="${q('gr', g)}">${g}</a>`)}</div>
      <p class="small muted">적용 기준값: ${used.length ? used.map(s => `v${s.version} · ${G_LABEL[s.gender]} · ${GR_LABEL(s.grade)}${s.is_sample ? ' (예시)' : ''}`).join(' + ') : '없음'}</p>
      <input type="hidden" name="g" value="${gender}"><input type="hidden" name="gr" value="${grade}">
      ${metrics.filter(m => m.enabled).map(m => { const v = num(ctx.query[m.key]); const b = vals[m.key]; const j = v != null ? judge(v, b) : null;
        return html`<div class="metric-row"><span>${m.name} <span class="small muted">${b ? `· 기준 ${rangeText(b, m.unit)}` : '· 기준 없음'}</span></span>
          <input type="number" step="any" name="${m.key}" value="${ctx.query[m.key] ?? ''}" style="width:90px;height:36px" placeholder="값">${j ? chip(LEVEL_LABEL[j.level], j.level === 'ok' || j.level === 'near' ? 'green' : j.level === 'low' ? 'amber' : 'red') : html`<span></span>`}
          ${j ? html`<div class="fb">${feedbackText(tpls[m.key] || DEFAULT_TEMPLATES, m, v, b, j)}</div>` : ''}</div>`; })}
      <button class="btn full mt12">판정해 보기</button></form>
      <p class="small muted">AI 분석은 참고용이며 정확한 판단은 강사 확인이 필요합니다.</p>`;
  }
  ctx.page('종목 설정', html`<a class="back" href="/admin/exercises">${icon('left')}종목 목록</a>
  <div class="pills scroll dark">${exs.map(x => html`<a class="pill ${x.id === e.id ? 'on' : ''}" href="/admin/exercises/${x.id}?tab=${tab}">${x.name}</a>`)}</div>
  ${pageTitle(e.name, e.kind === 'video' ? '영상 자세 분석 종목' : '기록 입력형 종목')}
  ${e.is_sample ? html`<div class="note">${icon('info')}예시 종목입니다. 내용을 확인한 뒤 '기본 정보'에서 예시 표시를 해제하세요.</div>` : ''}
  ${pills(TABS.filter(([, k]) => e.kind === 'video' || !['guide', 'checkpoints'].includes(k)).map(([l, k]) => [l, `?tab=${k}`, k]), tab)}
  ${body}`);
});

post('/admin/exercises/:id/info', 'staff', ctx => {
  const e = readBasic(ctx.body); const id = Number(ctx.params.id);
  run('UPDATE exercises SET name=?,unit=?,higher_better=?,kind=?,analysis_code=?,description=?,active=?,is_sample=? WHERE id=?', e.name, e.unit, e.hb, e.kind, e.code, e.description, e.active, e.is_sample, id);
  run(`UPDATE metrics SET unit=? WHERE exercise_id=? AND key='record'`, e.unit, id);
  if (e.code) syncAlgoMetrics(id, e.code);
  ctx.redirect(`/admin/exercises/${id}?tab=info`, '저장했어요.');
});
post('/admin/exercises/:id/delete', 'staff', ctx => { run('DELETE FROM exercises WHERE id=?', ctx.params.id); ctx.redirect('/admin/exercises', '종목을 삭제했어요.'); });
post('/admin/exercises/:id/guide', 'staff', ctx => {
  const b = ctx.body; const g = { position: b.position || '', distance: b.distance || '', height: b.height || '', cautions: [].concat(b.cautions || []).map(s => s.trim()).filter(Boolean) };
  run('UPDATE exercises SET guide=? WHERE id=?', JSON.stringify(g), ctx.params.id);
  ctx.redirect(`/admin/exercises/${ctx.params.id}?tab=guide`, '가이드를 저장했어요.');
});
const GUIDE_DIR = path.join(DATA_DIR, 'uploads', 'guide'); fs.mkdirSync(GUIDE_DIR, { recursive: true });
put('/api/exercises/:id/photo', 'staff', async ctx => {
  const e = one('SELECT * FROM exercises WHERE id=?', ctx.params.id) || notFound();
  const photos = J(e.guide_photos, []); if (photos.length >= 3) bad('사진은 3장까지예요.');
  const ext = { 'image/png': 'png', 'image/webp': 'webp' }[ctx.req.headers['content-type']] || 'jpg';
  const name = `g${e.id}_${Date.now().toString(36)}.${ext}`;
  const chunks = []; let n = 0; for await (const c of ctx.req) { n += c.length; if (n > 10 * 1048576) bad('사진은 10MB까지예요.'); chunks.push(c); }
  fs.writeFileSync(path.join(GUIDE_DIR, name), Buffer.concat(chunks));
  run('UPDATE exercises SET guide_photos=? WHERE id=?', JSON.stringify([...photos, name]), e.id);
  ctx.json({ ok: true });
});
post('/admin/exercises/:id/photo-del', 'staff', ctx => {
  const e = one('SELECT * FROM exercises WHERE id=?', ctx.params.id) || notFound();
  const photos = J(e.guide_photos, []).filter(p => p !== ctx.body.f);
  if (/^[\w.]+$/.test(ctx.body.f || '')) fs.rm(path.join(GUIDE_DIR, ctx.body.f), () => {});
  run('UPDATE exercises SET guide_photos=? WHERE id=?', JSON.stringify(photos), e.id);
  ctx.redirect(`/admin/exercises/${e.id}?tab=guide`, '사진을 지웠어요.');
});
get('/media/guide/:f', 'user', ctx => { if (!/^[\w.]+$/.test(ctx.params.f)) notFound(); serveFile(ctx.req, ctx.res, path.join(GUIDE_DIR, ctx.params.f), { cache: 'private, max-age=86400' }) || notFound(); });

post('/admin/exercises/:id/metric/:mid', 'staff', ctx => {
  const b = ctx.body; const m = one('SELECT * FROM metrics WHERE id=? AND exercise_id=?', ctx.params.mid, ctx.params.id) || notFound();
  if (b.del && m.source !== 'record') run('DELETE FROM metrics WHERE id=?', m.id);
  else run('UPDATE metrics SET name=?, moment=?, description=?, enabled=?, sort=? WHERE id=?', (b.name || m.name).trim(), b.moment || null, b.description || null, b.enabled ? 1 : 0, Number(b.sort) || 0, m.id);
  ctx.redirect(`/admin/exercises/${ctx.params.id}?tab=metrics`, b.del ? '지표를 삭제했어요.' : '저장했어요.');
});
post('/admin/exercises/:id/metric', 'staff', ctx => {
  const b = ctx.body; const key = 'manual_' + Date.now().toString(36);
  run(`INSERT INTO metrics(exercise_id,key,name,unit,description,source,higher_better,sort) VALUES(?,?,?,?,?,'manual',?,99)`, ctx.params.id, key, (b.name || '').trim() || bad('이름을 입력해 주세요.'), b.unit || '초', b.description || null, b.hb === '1' ? 1 : 0);
  ctx.redirect(`/admin/exercises/${ctx.params.id}?tab=metrics`, '보조 지표를 만들었어요.');
});
post('/admin/exercises/:id/bset', 'staff', ctx => {
  const id = Number(ctx.params.id); const b = ctx.body;
  const ver = (one('SELECT MAX(version) v FROM benchmark_sets WHERE exercise_id=?', id).v || 0) + 1;
  const src = b.copy ? one('SELECT vals FROM benchmark_sets WHERE id=?', b.copy) : null;
  const r = run(`INSERT INTO benchmark_sets(exercise_id,version,gender,grade,status,is_sample,vals) VALUES(?,?,?,?,'draft',1,?)`, id, ver,
    ['all', 'M', 'F'].includes(b.gender) ? b.gender : 'all', GRADES.includes(b.grade) ? b.grade : 'all', src ? src.vals : '{}');
  ctx.redirect(`/admin/exercises/${id}?tab=benchmarks&set=${r.lastInsertRowid}`, `v${ver} 초안을 만들었어요.`);
});
post('/admin/exercises/:id/bset/:sid', 'staff', ctx => {
  const s = one('SELECT * FROM benchmark_sets WHERE id=? AND exercise_id=?', ctx.params.sid, ctx.params.id) || notFound();
  const b = ctx.body;
  if (b.act === 'delete') { run('DELETE FROM benchmark_sets WHERE id=?', s.id); return ctx.redirect(`/admin/exercises/${ctx.params.id}?tab=benchmarks`, '삭제했어요.'); }
  const vals = {};
  for (const [k, v] of Object.entries(b)) { const m = /^(.+)\.(min|max|target|tol)$/.exec(k); if (!m) continue; const n = num(v); if (n == null) continue; (vals[m[1]] ||= {})[m[2]] = n; }
  for (const [k, v] of Object.entries(vals)) if (v.min != null && v.max != null && v.min > v.max) bad(`최소가 최대보다 커요 (${k})`);
  const status = b.act === 'publish' ? 'published' : b.act === 'unpublish' ? 'draft' : s.status;
  run('UPDATE benchmark_sets SET vals=?, note=?, is_sample=?, status=? WHERE id=?', JSON.stringify(vals), b.note || null, b.is_sample ? 1 : 0, status, s.id);
  ctx.redirect(`/admin/exercises/${ctx.params.id}?tab=benchmarks&set=${s.id}`, status === 'published' ? '저장하고 발행했어요. 학생 화면에 바로 반영돼요.' : '저장했어요.');
});
post('/admin/exercises/:id/tpl', 'staff', ctx => {
  const b = ctx.body;
  run(`INSERT INTO feedback_templates(exercise_id,metric_key,low,ok,near,high) VALUES(?,?,?,?,?,?) ON CONFLICT(exercise_id,metric_key) DO UPDATE SET low=excluded.low, ok=excluded.ok, near=excluded.near, high=excluded.high`, ctx.params.id, b.key, b.low || '', b.ok || '', b.near || '', b.high || '');
  ctx.redirect(`/admin/exercises/${ctx.params.id}?tab=templates`, '문구를 저장했어요.');
});
function readCp(b) { return [(b.name || '').trim() || bad('포인트 이름을 입력해 주세요.'), b.description || null, b.metric_key || null, num(b.good_min), num(b.good_max)]; }
post('/admin/exercises/:id/cp', 'staff', ctx => { run('INSERT INTO checkpoints(exercise_id,name,description,metric_key,good_min,good_max,sort) VALUES(?,?,?,?,?,?,(SELECT COUNT(*) FROM checkpoints WHERE exercise_id=?))', ctx.params.id, ...readCp(ctx.body), ctx.params.id); ctx.redirect(`/admin/exercises/${ctx.params.id}?tab=checkpoints`, '포인트를 추가했어요.'); });
post('/admin/exercises/:id/cp/:cid', 'staff', ctx => {
  if (ctx.body.del) run('DELETE FROM checkpoints WHERE id=? AND exercise_id=?', ctx.params.cid, ctx.params.id);
  else run('UPDATE checkpoints SET name=?,description=?,metric_key=?,good_min=?,good_max=? WHERE id=? AND exercise_id=?', ...readCp(ctx.body), ctx.params.cid, ctx.params.id);
  ctx.redirect(`/admin/exercises/${ctx.params.id}?tab=checkpoints`, '저장했어요.');
});
void tx; void fmtNum;
