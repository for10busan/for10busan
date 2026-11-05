// K:컨설팅 · 대학검색 · 커트라인 · 수능·모의고사 등급컷
import { get, post, notFound, bad, forbidden } from '../lib/router.js';
import { one, all, run, tx, J } from '../lib/db.js';
import { html, raw, icon, pageTitle, empty, csrfField, pills, chip } from '../lib/html.js';
import { num, fmtNum, today, korDay, canSeeCutoff, GRADES, isStaff } from '../lib/util.js';
import { branches } from '../lib/services.js';
import { REGION_GROUPS, regionGroup, uniLabel, schoolScore, practicalScore, maxPoints, practicalMax, stepPoints, latestCutoff, programRow, EXAMS, EXAM_SUBJECTS, SUBJECT_MAX, convertRaw, coverage, rangeText, examTable } from '../lib/admissions.js';

const exMap = () => Object.fromEntries(all('SELECT id,name,unit,higher_better FROM exercises').map(e => [e.id, e]));
const curYear = () => Number(today().slice(0, 4)) + (Number(today().slice(5, 7)) >= 3 ? 1 : 0); // 입시 학년도
const SAMPLE = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
const qs = (base, o) => base + '?' + new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '' && v !== false)).toString();
const f1 = v => (v == null ? '—' : fmtNum(v, 1));

// ---------- 공통: 학생 선택 + 표본 등급 ----------
function readPick(ctx) {
  const q = ctx.query;
  const s = Number(q.s) ? one(`SELECT * FROM users WHERE id=? AND role='student'`, Number(q.s)) : null;
  const g = Number(q.g) === 5 ? 5 : 9; // 처음엔 9등급제(2027학년도)
  const t = num(q.t);
  const grade = t != null ? t : s?.school_grade ?? null;
  return { s, g, t, grade, gender: s?.gender || (q.sex === 'F' ? 'F' : 'M') };
}
function studentPicker(ctx, base, keep, pick) {
  const br = branches(); const b = ctx.query.b ? Number(ctx.query.b) : null;
  const studs = all(`SELECT id,name,grade,branch_id FROM users WHERE role='student' AND status='approved' ${b ? 'AND branch_id=?' : ''} ORDER BY name`, ...(b ? [b] : []));
  const cnt = id => one(`SELECT COUNT(*) c FROM users WHERE role='student' AND status='approved'${id ? ' AND branch_id=?' : ''}`, ...(id ? [id] : [])).c;
  return html`<div class="card picker">
    <div class="flex wrapf mb8"><b class="small">${icon('users', 'red')} 학생 선택</b>
      ${[[null, '전체 지점'], ...br.map(x => [x.id, x.name])].map(([id, l]) => html`<a class="pill ${b === id ? 'on' : ''}" href="${qs(base, { ...keep, b: id })}">${l} ${cnt(id)}</a>`)}</div>
    <form method="get" action="${base}">${Object.entries({ ...keep, b }).filter(([k, v]) => v != null && k !== 's' && k !== 't').map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
      <input type="search" placeholder="이름을 입력하면 바로 찾아요" data-filter-select="#pickSel" class="mb8">
      <select name="s" id="pickSel" onchange="this.form.submit()"><option value="">학생을 고르면 그 학생 성적이 자동으로 들어가요</option>${studs.map(x => html`<option value="${x.id}" ${pick.s?.id === x.id ? 'selected' : ''}>${x.name} (${x.grade || ''})</option>`)}</select></form>
  </div>
  <div class="card"><div class="flex between wrapf"><b class="small">내신 등급제</b>
    <div class="pills mb0">${[[9, '9등급제 (2027학년도)'], [5, '5등급제 (2028학년도)']].map(([v, l]) => html`<a class="pill ${pick.g === v ? 'on' : ''}" href="${qs(base, { ...keep, b, s: pick.s?.id, t: pick.t, g: v })}">${l}</a>`)}</div></div>
    <div class="pills mt8 mb0"><span class="small muted" style="align-self:center">표본</span>${SAMPLE.map(v => html`<a class="pill ${pick.t === v ? 'on' : ''}" href="${qs(base, { ...keep, b, g: pick.g, t: v })}">${v}등급</a>`)}</div>
    <p class="help mb0">${pick.s ? html`<b>${pick.s.name}</b> · 내신 ${pick.s.school_grade != null ? `${pick.s.school_grade}등급(${pick.s.grade_system || 5}등급제)` : '미입력'}${pick.t != null ? ` → 표본 ${pick.t}등급으로 보는 중` : ''}` : '학생 이름을 고르거나 표본 등급을 누르면 대학마다 여유·적정·도전이 바로 나와요.'}</p></div>
  <script>document.querySelectorAll('[data-filter-select]').forEach(i=>{const s=document.querySelector(i.dataset.filterSelect);const all=[...s.options];i.addEventListener('input',()=>{const q=i.value.trim();s.innerHTML='';all.forEach((o,k)=>{if(!k||!q||o.text.includes(q))s.append(o)});if(q&&s.options.length===2){s.selectedIndex=1}})})</script>`;
}
const isEdu = u => /체육교육/.test(u.dept || '') && !/특수체육/.test(u.dept || ''); // 체육교육과만 (특수체육교육과 제외)
function filterUnis(ctx, admission) {
  const q = (ctx.query.q || '').trim(); const r = ctx.query.r || ''; const d = ctx.query.d || '';
  const np = ctx.query.np === '1';
  let rows = all('SELECT * FROM universities WHERE admission=? ORDER BY name, dept, id', admission);
  const counts = { all: rows.length }; for (const u of rows) counts[regionGroup(u.region)] = (counts[regionGroup(u.region)] || 0) + 1;
  const inR = u => !r || regionGroup(u.region) === r;
  counts.edu = rows.filter(u => inR(u) && isEdu(u)).length; counts.cert = rows.filter(u => inR(u) && u.teacher_cert).length; counts.nat = rows.filter(u => inR(u) && u.founding === '국립').length;
  counts.dall = rows.filter(inR).length;
  rows = rows.filter(u => {
    const prac = J(u.exercises, []).length > 0;
    if (ctx.query.np != null && (np ? prac : !prac)) return false;
    if (q && !`${u.name} ${u.dept || ''} ${u.region || ''} ${u.city || ''}`.includes(q)) return false;
    if (r && regionGroup(u.region) !== r) return false;
    if (d === 'edu' && !isEdu(u)) return false;
    if (d === 'cert' && !u.teacher_cert) return false;
    if (d === 'nat' && u.founding !== '국립') return false;
    return true;
  });
  const ord = g => { const i = REGION_GROUPS.findIndex(x => x[0] === g); return i < 0 ? 99 : i; };
  rows.sort((a, b) => ord(regionGroup(a.region)) - ord(regionGroup(b.region)) || String(a.name).localeCompare(String(b.name), 'ko') || String(a.dept || '').localeCompare(String(b.dept || ''), 'ko'));
  return { rows, counts, q, r, d };
}
function filterBar(ctx, base, keep, f) {
  return html`<form method="get" action="${base}" class="flex wrapf mb8">${Object.entries(keep).filter(([k, v]) => v != null && !['q', 'sort'].includes(k)).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
    <input type="search" name="q" value="${f.q}" placeholder="대학·학과·지역 검색 (예: 부산, 경성)" class="grow" style="min-width:160px">
    ${keep.sort !== undefined ? html`<select name="sort" style="width:auto" onchange="this.form.submit()"><option value="">기본 순서</option><option value="margin" ${ctx.query.sort === 'margin' ? 'selected' : ''}>여유 많은 순</option></select>` : ''}
    <button class="btn sm dark" style="height:44px">${icon('search')}</button></form>
  <div class="pills wrap">${[['', `전체 지역 ${f.counts.all}`], ...REGION_GROUPS.map(([g]) => [g, `${g} ${f.counts[g] || 0}`]), ...(f.counts['기타'] ? [['기타', `기타 ${f.counts['기타']}`]] : [])].map(([v, l]) => html`<a class="pill ${f.r === v ? 'on' : ''}" href="${qs(base, { ...keep, r: v })}">${l}</a>`)}</div>
  <div class="pills dark">${[['', `전체 학과 ${f.counts.dall}`], ['edu', `체육교육과 ${f.counts.edu}`], ['cert', `교직이수 ${f.counts.cert}`], ['nat', `국립 대학 ${f.counts.nat}`]].map(([v, l]) => html`<a class="pill ${f.d === v ? 'on' : ''}" href="${qs(base, { ...keep, d: v })}">${l}</a>`)}</div>`;
}
const cutCell = (ctx, c) => (canSeeCutoff(ctx.user) ? (c ? html`${f1(c.cutoff)}${c.final != null ? html`<br><span class="muted">${f1(c.final)}</span>` : ''}` : '—') : html`<span class="muted small">본원 확인</span>`);
const marginCell = (m, g) => (m == null ? '—' : html`<b class="${m >= 0 ? 'green' : 'red'}">${m >= 0 ? '+' : ''}${f1(m)}</b>${g != null ? html`<br><span class="small muted">${fmtNum(g, 1)}감</span>` : ''}`);
const verdictChip = v => (v ? chip(v[0], v[1] === 'safe' ? 'green' : v[1] === 'ok' ? 'blue' : 'red') : '—');
const exNames = (u, ex) => J(u.exercises, []).map(i => ex[i]?.name).filter(Boolean).join(' · ');

// ---------- K:컨설팅 메인 ----------
get('/admin/consulting', 'staff', ctx => {
  const m = ctx.query.m === 'jungsi' ? '정시' : '수시';
  const pick = readPick(ctx); const ex = exMap();
  const keep = { m: ctx.query.m, np: ctx.query.np, b: ctx.query.b, s: pick.s?.id, t: pick.t, g: ctx.query.g, r: ctx.query.r, d: ctx.query.d, q: ctx.query.q, sort: ctx.query.sort || '' };
  const f = filterUnis(ctx, m);
  let rows = f.rows.map(u => ({ u, c: programRow(u, { grade: pick.grade, system: pick.g, studentId: pick.s?.id }) }));
  if (ctx.query.sort === 'margin') rows.sort((a, b) => (b.c.m1 ?? -1e9) - (a.c.m1 ?? -1e9));
  const see = canSeeCutoff(ctx.user);
  ctx.page('K:컨설팅', html`
  <div class="hero" style="padding-bottom:16px"><small>Korea Sports Consulting</small><b>K:컨설팅 프로그램</b><div class="small muted">수시·정시 지원 예상</div>
    <div class="flex mt12" style="position:relative;z-index:1"><a class="btn sm dark" style="border:1px solid #444" href="/admin/consulting/results">${icon('doc')}K:결과분석표</a><a class="btn sm" href="/admin/consulting/students">${icon('users')}학생관리</a></div></div>
  <div class="seg mt12"><a class="${m === '수시' ? 'on' : ''}" href="${qs('/admin/consulting', { ...keep, m: '' })}">수시</a><a class="${m === '정시' ? 'on' : ''}" href="${qs('/admin/consulting', { ...keep, m: 'jungsi' })}">정시</a></div>
  <div class="seg">${[['0', '실기 대학'], ['1', '무실기 대학']].map(([v, l]) => html`<a class="${(ctx.query.np || '0') === v ? 'on' : ''}" href="${qs('/admin/consulting', { ...keep, np: v })}">${l}</a>`)}</div>
  ${studentPicker(ctx, '/admin/consulting', keep, pick)}
  ${filterBar(ctx, '/admin/consulting', keep, f)}
  <p class="small muted"><b>${rows.length}</b>곳 · 줄을 누르면 학교 시트로 가요 · 총점 = ${m === '정시' ? '수능 환산' : '내신 점수'} + 실기 만점${see ? ', 여유 = 총점 − 커트라인(최초합 · 예비합), 감 = 여유 ÷ 실기 한 급간' : ''}</p>
  ${rows.length ? html`<div class="card scroll-x" style="padding:8px"><table class="tbl" style="min-width:860px"><tr><th>지역</th><th>대학 · 학과</th><th>전형</th><th>모집</th><th>비율</th><th>수능최저</th><th>${m === '정시' ? '수능' : '내신'}</th><th>실기 만점</th><th>총점</th>${see ? html`<th>커트라인<br>최초합/예비</th><th>여유<br>(점수·감)</th><th>판정</th>` : ''}<th>실기 종목</th></tr>
    ${rows.map(({ u, c }) => html`<tr data-href="/admin/consulting/program/${u.id}${pick.s ? '?s=' + pick.s.id : ''}" style="cursor:pointer"><td>${u.region || '—'}</td><td style="text-align:left"><a href="/admin/consulting/program/${u.id}${pick.s ? '?s=' + pick.s.id : ''}"><b>${u.name}</b></a><br><span class="small">${u.dept || ''}${u.teacher_cert ? ' · 교직' : ''}</span></td>
      <td class="small">${[u.track && u.track_type && u.track.startsWith(u.track_type) ? null : u.track_type, u.track].filter(Boolean).join(" ") || '—'}</td><td>${u.quota ? u.quota + '명' : '—'}</td>
      <td class="small">${m === '정시' ? (u.suneung_ratio ?? '—') : (u.school_ratio ?? '—')} · ${u.practical_ratio ?? '—'}</td><td class="small">${u.suneung_min || 'X'}</td>
      <td>${f1(c.base)}</td><td>${f1(c.pmax)}</td><td><b>${f1(c.total)}</b></td>${see ? html`<td>${cutCell(ctx, c.cut)}</td><td>${marginCell(c.m1, c.g1)}</td><td>${verdictChip(c.verdict)}</td>` : ''}<td class="small" style="text-align:left">${exNames(u, ex) || '무실기'}</td></tr>`)}</table></div>
    <script>document.querySelectorAll('tr[data-href]').forEach(t=>t.addEventListener('click',e=>{if(!e.target.closest('a'))location.href=t.dataset.href}))</script>`
    : empty('조건에 맞는 대학이 없어요', '대학 관리에서 전형 정보를 넣거나, 엑셀에서 한 번에 붙여 넣을 수 있어요.')}`, { active: '/admin/consulting' });
});

// ---------- 학교 시트 ----------
function scoreTable(u, ex, which = 'scoring') {
  const ids = J(u.exercises, []); const sc = J(u[which]);
  const cols = ids.map(i => { const t = sc[i] || {}; const pts = [...new Set([...(t.M || []), ...(t.F || [])].map(r => r[1]))].sort((a, b) => b - a); return { i, t, pts }; });
  const n = Math.max(0, ...cols.map(c => c.pts.length));
  if (!n) return html`<p class="small muted">배점표가 아직 없어요.</p>`;
  const thr = (rows, p) => { const r = (rows || []).find(x => x[1] === p); return r ? fmtNum(r[0], 2) : '—'; };
  return html`<div class="scroll-x"><table class="tbl" style="min-width:${120 + cols.length * 180}px"><tr><th>등급</th>${cols.map(c => html`<th colspan="3" style="text-align:center">${ex[c.i]?.name || '?'}</th>`)}</tr>
    <tr><th></th>${cols.map(() => html`<th>배점</th><th>남</th><th>여</th>`)}</tr>
    ${Array.from({ length: n }, (_, k) => html`<tr><td>${k + 1}</td>${cols.map(c => { const p = c.pts[k]; return p == null ? html`<td></td><td></td><td></td>` : html`<td><b>${fmtNum(p, 2)}</b></td><td>${thr(c.t.M, p)}</td><td>${thr(c.t.F, p)}</td>`; })}</tr>`)}</table></div>`;
}
function monthlyAvg(sid, exId) { const r = one('SELECT AVG(record) a FROM monthly_tests WHERE student_id=? AND exercise_id=?', sid, exId); return r?.a == null ? null : Math.round(r.a * 100) / 100; }
get('/admin/consulting/program/:id', 'staff', ctx => {
  const u = one('SELECT * FROM universities WHERE id=?', ctx.params.id) || notFound();
  const ex = exMap(); const ids = J(u.exercises, []); const see = canSeeCutoff(ctx.user);
  const cuts = all('SELECT * FROM cutoffs WHERE university_id=? ORDER BY year DESC', u.id); const c = cuts[0];
  const gt = J(u.grade_table); const notes = J(u.field_notes);
  const g = Number(ctx.query.g) === 9 ? 9 : 5;
  const added = String(ctx.query.st || '').split(',').map(Number).filter(Boolean);
  const studs = added.length ? all(`SELECT * FROM users WHERE role='student' AND id IN (${added.map(() => '?').join(',')})`, ...added) : [];
  const studsAll = all(`SELECT id,name,grade FROM users WHERE role='student' AND status='approved' ORDER BY name`);
  const stepP = stepPoints(u);
  const data = { scoring: J(u.scoring), ex: Object.fromEntries(ids.map(i => [i, { hb: ex[i]?.higher_better ?? 1, name: ex[i]?.name }])), ids, cut: see && c ? [c.cutoff, c.final] : null, step: stepP,
    rows: studs.map(s => ({ id: s.id, name: s.name, gender: s.gender || 'M', school: schoolScore(u, s.school_grade, s.grade_system || 5), grade: s.school_grade, rec: Object.fromEntries(ids.map(i => [i, monthlyAvg(s.id, i)])) })),
    sample: SAMPLE.map(t => ({ t, school: schoolScore(u, t, g) })) };
  const kv = [['모집인원', u.quota ? `${u.quota}명` : '—'], ['단계 · 배수', u.stage || '—'], ['반영 비율', u.admission === '정시' ? `수능 ${u.suneung_ratio ?? '—'} · 실기 ${u.practical_ratio ?? '—'}` : `내신 ${u.school_ratio ?? '—'} · 실기 ${u.practical_ratio ?? '—'}`],
    ['수능최저', u.suneung_min || '없음'], ['실기 날짜', u.practical_date || '—'], ['면접 날짜', u.interview_date || 'X'], ...(u.admission === '정시' ? [['수능 반영 영역', u.subjects || '—'], ['영역별 반영', u.subject_weights || '—'], ['수능 · 실기 만점', `${u.suneung_max ?? '—'} · ${u.practical_max ?? '—'}`], ['메모', u.memo || '—']]
      : [['학년별 반영', u.year_weights || '—'], ['반영 교과', u.subjects || '—'], ['교과별 반영', u.subject_weights || '—'], ['반영 과목', u.subject_scope || '—']])];
  const back = ctx.query.from === 'search' ? ['대학검색', '/admin/student-predict'] : ['K:컨설팅 메인으로', '/admin/consulting'];
  ctx.page(uniLabel(u), html`<a class="back" href="${back[1]}">${icon('left')}${back[0]}</a>
  <div class="hero"><small>SCHOOL · ${u.admission}</small><b>${u.name}</b><div style="font-size:16px;font-weight:700">${u.dept || ''}</div>
    <div class="small muted">${[u.track && u.track_type && u.track.startsWith(u.track_type) ? null : u.track_type, u.track].filter(Boolean).join(" ")}${u.city || u.region ? ` · ${u.region || ''} ${u.city || ''}` : ''}${u.founding ? ` · ${u.founding}` : ''}${u.teacher_cert ? ' · 교직이수' : ''}</div></div>
  ${see ? html`<div class="grid c2 mt12"><div class="stat"><span class="st-l">최초합 CUT-LINE</span><b class="st-v red">${c ? f1(c.cutoff) : '—'}</b><span class="st-s">${c ? c.year + '학년도' : '입력 전'}</span></div>
    <div class="stat"><span class="st-l">예비합격 CUT-LINE</span><b class="st-v">${c?.final != null ? f1(c.final) : '—'}</b><span class="st-s"><a class="red" href="/admin/predict?u=${u.id}&a=${encodeURIComponent(u.admission)}">커트라인 고치기 →</a></span></div></div>` : ''}
  <div class="card mt12"><h3>모집 정보</h3><dl class="kv" style="grid-template-columns:100px 1fr">${kv.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl></div>
  ${u.admission !== '정시' ? html`<div class="card"><h3>내신 등급표</h3>${[5, 9].map(sys => { const t = gt[String(sys)] || []; return t.length ? html`<p class="small b mb8">${sys}등급제 ${u.school_max ? `(만점 ${fmtNum(u.school_max)})` : ''}</p><div class="scroll-x mb8"><table class="tbl"><tr>${t.map(r => html`<th>${r[0]}등급</th>`)}</tr><tr>${t.map(r => html`<td>${fmtNum(r[1], 2)}</td>`)}</tr></table></div>` : ''; })}
    ${!(gt['5'] || []).length && !(gt['9'] || []).length ? html`<p class="small muted mb0">아직 내신 등급표가 없어요.</p>` : ''}</div>` : ''}
  <div class="card"><div class="flex between"><h3 class="mb0">전년도 대비 변경 사항</h3><a class="btn xs ghost" href="/admin/universities/${u.id}">고치기</a></div>
    ${u.changes ? html`<p class="small mt12 mb0" style="white-space:pre-wrap">${u.changes}</p>` : html`<p class="small muted mt12 mb0">입력된 변경 사항이 없어요.</p>`}</div>
  ${ids.length ? html`<div class="card"><h3>실기 배점표</h3>
    ${Object.keys(J(u.prev_scoring)).length ? html`<div class="pills"><a class="pill ${ctx.query.prev ? '' : 'on'}" href="?${new URLSearchParams({ ...ctx.query, prev: '' })}">올해 배점표</a><a class="pill ${ctx.query.prev ? 'on' : ''}" href="?${new URLSearchParams({ ...ctx.query, prev: '1' })}">작년 배점표${u.prev_year ? ` (${u.prev_year})` : ''}</a></div>` : ''}
    ${scoreTable(u, ex, ctx.query.prev ? 'prev_scoring' : 'scoring')}<p class="help mb0">${stepP ? `실기 한 급간 ≈ ${fmtNum(stepP, 2)}점 (감 계산 기준)` : ''}</p></div>
  <div class="card"><h3>실기기록 · 최종 결과 <small>이름을 넣거나 표본을 눌러 비교해요</small></h3>
    <form method="get" class="flex wrapf mb8">${['g'].map(k => html`<input type="hidden" name="${k}" value="${g}">`)}<input type="hidden" name="st" value="${added.join(',')}" id="stKeep">
      <select id="addSt" style="flex:1;min-width:160px"><option value="">학생 이름을 고르면 결과표에 넣어요 (환산 내신·실기 테스트 평균 자동)</option>${studsAll.map(s => html`<option value="${s.id}">${s.name} (${s.grade || ''})</option>`)}</select>
      <div class="pills mb0">${[9, 5].map(v => html`<a class="pill ${g === v ? 'on' : ''}" href="?${new URLSearchParams({ ...ctx.query, g: v })}">${v}등급제</a>`)}</div></form>
    <script>document.getElementById('addSt').onchange=e=>{const k=document.getElementById('stKeep');const v=[...new Set([...k.value.split(',').filter(Boolean),e.target.value])].join(',');const u=new URL(location.href);u.searchParams.set('st',v);location.href=u}</script>
    <div class="scroll-x"><table class="tbl" id="cmp" style="min-width:${520 + ids.length * 150}px"><thead><tr><th>이름</th><th>내신</th><th>성별</th>${ids.map(i => html`<th>${ex[i]?.name}<br><span class="muted">기록 · 점수</span></th>`)}<th>실기</th><th>총점</th>${see ? html`<th>최초합 여유</th><th>예비합 여유</th>` : ''}<th></th></tr></thead><tbody></tbody></table></div>
    <p class="help">기록 칸은 월별 실기 테스트 기록 평균으로 처음 채워져요 (고칠 수 있음, 저장 안 함). 저장하려면 <a class="red" href="/admin/consulting/students">학생관리</a>에서 지원 대학으로 넣으세요. 표본 줄은 실기 만점 기준이에요.</p>
    <script>window.CMP=${raw(JSON.stringify(data).replace(/</g, '\\u003c'))}</script><script src="/js/compare.js?v=1" defer></script></div>` : ''}
  ${ids.some(i => (notes[i] || []).length) ? html`<div class="card"><h3>실기장 유의사항</h3>${ids.filter(i => (notes[i] || []).length).map(i => html`<p class="b small mb8">${ex[i]?.name}</p><ol class="small mt0">${notes[i].map(n => html`<li style="white-space:pre-wrap">${n}</li>`)}</ol>`)}</div>` : ''}
  <a class="btn ghost full" href="/admin/universities/${u.id}">${icon('pen')}이 학교 정보 고치기</a>`, { active: ctx.query.from === 'search' ? '/admin/student-predict' : '/admin/consulting' });
});

// ---------- 학생관리 (지원 대학 8개) ----------
const RESULT = { pass: ['최초합', 'green'], wait: ['예비합', 'blue'], fail: ['불합격', 'red'], none: ['결과 대기', ''] };
get('/admin/consulting/students', 'staff', ctx => {
  const y = Number(ctx.query.y) || curYear(); const gsys = Number(ctx.query.g) === 9 ? 9 : 5;
  const br = branches(); const b = ctx.query.b || ''; const gr = ctx.query.gr || ''; const q = (ctx.query.q || '').trim();
  let studs = all(`SELECT u.*, bb.name branch FROM users u LEFT JOIN branches bb ON bb.id=u.branch_id WHERE role='student' AND status='approved' ORDER BY u.name`);
  const gcount = Object.fromEntries(GRADES.map(x => [x, studs.filter(s => s.grade === x).length]));
  studs = studs.filter(s => (!b || String(s.branch_id) === b) && (!gr || s.grade === gr) && (!q || s.name.includes(q)));
  const apps = all(`SELECT a.*, u.name uname, u.dept FROM applications a JOIN universities u ON u.id=a.university_id WHERE a.year=?`, y);
  const by = {}; for (const a of apps) (by[a.student_id] ||= {})[a.slot] = a;
  const withApps = new Set(apps.map(a => a.student_id)).size;
  const unis = all('SELECT id,name,dept,track,admission FROM universities ORDER BY name, dept');
  const see = canSeeCutoff(ctx.user);
  const keep = { y, g: gsys, b, gr, q };
  ctx.page('K:컨설팅 학생관리', html`<a class="back" href="/admin/consulting">${icon('left')}K:컨설팅 MAIN</a>
  ${pageTitle('K:컨설팅 학생관리', `${y} 수시 컨설팅 — 학생 ${one(`SELECT COUNT(*) c FROM users WHERE role='student' AND status='approved'`).c}명 중 ${withApps}명 지원 대학 입력. 지원 대학을 추가하고, 실기 기록을 넣어 총점을 보고 저장·최종 결과로 결과분석표에 올려요.`)}
  <div class="flex wrapf mb8"><a class="btn sm dark" href="/admin/consulting/results?y=${y}">${icon('doc')}K:결과분석표</a>
    <div class="pills mb0">${[9, 5].map(v => html`<a class="pill ${gsys === v ? 'on' : ''}" href="${qs('/admin/consulting/students', { ...keep, g: v })}">${v}등급제</a>`)}</div>
    <div class="pills mb0">${[y - 1, y, y + 1].map(v => html`<a class="pill ${y === v ? 'on' : ''}" href="${qs('/admin/consulting/students', { ...keep, y: v })}">${v}학년도</a>`)}</div></div>
  <form class="mb8">${Object.entries(keep).filter(([k, v]) => v && k !== 'q').map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}<input type="search" name="q" value="${q}" placeholder="학생 이름을 입력하면 바로 찾아요"></form>
  ${br.length > 1 ? pills([['전체 지점', qs('/admin/consulting/students', { ...keep, b: '' }), ''], ...br.map(x => [x.name, qs('/admin/consulting/students', { ...keep, b: String(x.id) }), String(x.id)])], b) : ''}
  ${pills([[`전체 ${Object.values(gcount).reduce((a, x) => a + x, 0)}`, qs('/admin/consulting/students', { ...keep, gr: '' }), ''], ...GRADES.map(x => [`${x} ${gcount[x]}`, qs('/admin/consulting/students', { ...keep, gr: x }), x])], gr, 'dark')}
  <datalist id="uniList">${unis.map(u => html`<option value="${uniLabel(u)} · ${u.track || u.admission} #${u.id}"></option>`)}</datalist>
  ${studs.length ? studs.map((s, k) => { const mine = by[s.id] || {}; return html`<div class="card"><div class="flex between wrapf"><div><span class="muted small">${k + 1}</span> <b>${s.name}</b> <span class="small muted">${[s.grade, s.branch, s.school].filter(Boolean).join(' · ')}</span></div>
      <div class="flex"><span class="small">내신 <b>${s.school_grade != null ? `${s.school_grade}등급` : '미입력'}</b></span><a class="btn xs ghost" href="/students/${s.id}?tab=predict">상담하기</a></div></div>
    <div class="list mt8 mb8">${Array.from({ length: 8 }, (_, i) => { const a = mine[i + 1]; return a ? html`<a href="/admin/consulting/app/${a.id}"><span class="small muted">지원 ${i + 1}</span><div class="row-m"><b>${a.uname} ${a.dept || ''}</b><span>총점 ${f1(a.total)}${see && a.total != null ? (() => { const c = latestCutoff(a.university_id); return c ? ` · 여유 ${a.total - c.cutoff >= 0 ? '+' : ''}${f1(a.total - c.cutoff)}` : ''; })() : ''}</span></div>${a.final ? chip(RESULT[a.result || 'none'][0], RESULT[a.result || 'none'][1]) : chip('저장됨')}${icon('right')}</a>`
      : html`<div><span class="small muted">지원 ${i + 1}</span><span class="small muted grow">비어 있음</span></div>`; })}</div>
    <form method="post" action="/admin/consulting/apps" class="flex">${csrfField(ctx)}<input type="hidden" name="sid" value="${s.id}"><input type="hidden" name="y" value="${y}"><input type="text" name="uni" list="uniList" placeholder="지원 대학 추가 — 대학·학과 이름 (예: 경성 스포츠)" required><button class="btn sm">${icon('plus')}</button></form></div>`; }) : empty('학생이 없어요')}`, { active: '/admin/consulting' });
});
post('/admin/consulting/apps', 'staff', ctx => {
  const { sid, y, uni } = ctx.body; const m = /#(\d+)\s*$/.exec(uni || '');
  const u = m ? one('SELECT * FROM universities WHERE id=?', m[1]) : one('SELECT * FROM universities WHERE (name || IFNULL(\' \' || dept, \'\')) LIKE ? LIMIT 1', `%${(uni || '').trim()}%`);
  if (!u) bad('목록에서 대학을 골라 주세요.');
  const used = all('SELECT slot FROM applications WHERE student_id=? AND year=?', sid, y).map(r => r.slot);
  const slot = [1, 2, 3, 4, 5, 6, 7, 8].find(x => !used.includes(x)); if (!slot) bad('지원 대학은 8개까지예요.');
  const s = one('SELECT * FROM users WHERE id=?', sid);
  const records = Object.fromEntries(J(u.exercises, []).map(i => [i, monthlyAvg(s.id, i)]));
  const r = run('INSERT INTO applications(student_id,university_id,year,slot,records) VALUES(?,?,?,?,?)', sid, u.id, y, slot, JSON.stringify(records));
  recalcApp(Number(r.lastInsertRowid));
  ctx.back(`${s.name} — 지원 ${slot}에 ${u.name}을(를) 넣었어요.`);
});
function recalcApp(id) {
  const a = one('SELECT * FROM applications WHERE id=?', id); const u = one('SELECT * FROM universities WHERE id=?', a.university_id); const s = one('SELECT * FROM users WHERE id=?', a.student_id);
  const rec = J(a.records); const ex = exMap();
  const school = u.admission === '정시' ? programRow(u, { studentId: s.id }).base : schoolScore(u, s.school_grade, s.grade_system || 5);
  let prac = null; for (const i of J(u.exercises, [])) { const p = practicalScore(u, i, s.gender || 'M', rec[i], ex[i]?.higher_better); if (p != null) prac = (prac || 0) + p; }
  const total = school == null && prac == null ? null : (school || 0) + (prac || 0);
  run(`UPDATE applications SET school_score=?, practical_score=?, total=?, updated_at=datetime('now') WHERE id=?`, school, prac, total, id);
}
get('/admin/consulting/app/:id', 'staff', ctx => {
  const a = one('SELECT * FROM applications WHERE id=?', ctx.params.id) || notFound();
  const u = one('SELECT * FROM universities WHERE id=?', a.university_id); const s = one('SELECT * FROM users WHERE id=?', a.student_id);
  const ex = exMap(); const ids = J(u.exercises, []); const rec = J(a.records); const see = canSeeCutoff(ctx.user); const c = latestCutoff(u.id); const step = stepPoints(u);
  ctx.page('지원 대학', html`${pageTitle(`${s.name} · 지원 ${a.slot}`, `${uniLabel(u)} · ${[u.track && u.track_type && u.track.startsWith(u.track_type) ? null : u.track_type, u.track].filter(Boolean).join(" ")} · ${a.year}학년도`, ['학생관리', `/admin/consulting/students?y=${a.year}`])}
  <form method="post" action="/admin/consulting/app/${a.id}" class="card">${csrfField(ctx)}
    <div class="big3"><div><small>${u.admission === '정시' ? '수능' : '내신'}</small><b>${f1(a.school_score)}</b><small>${s.school_grade != null ? s.school_grade + '등급' : '내신 미입력'}</small></div><div><small>실기</small><b>${f1(a.practical_score)}</b><small>만점 ${f1(practicalMax(u))}</small></div><div><small>총점</small><b class="red">${f1(a.total)}</b><small>${see && c && a.total != null ? `여유 ${a.total - c.cutoff >= 0 ? '+' : ''}${f1(a.total - c.cutoff)}${step ? ` · ${fmtNum((a.total - c.cutoff) / step, 1)}감` : ''}` : ''}</small></div></div>
    ${ids.map(i => html`<div class="metric-row"><span>${ex[i]?.name} <span class="small muted">(${ex[i]?.unit}) · 테스트 평균 ${monthlyAvg(s.id, i) ?? '—'}</span></span><input type="number" step="any" name="r_${i}" value="${rec[i] ?? ''}" style="width:100px;height:36px"><span class="small">${f1(practicalScore(u, i, s.gender || 'M', rec[i], ex[i]?.higher_better))}점</span></div>`)}
    <label class="field mt12"><span>메모</span><input type="text" name="memo" value="${a.memo || ''}"></label>
    <div class="field"><span class="lbl">최종 결과 (결과분석표에 올라가요)</span><div class="tg">${[['', '아직'], ['none', '결과 대기'], ['pass', '최초합'], ['wait', '예비합'], ['fail', '불합격']].map(([v, l]) => html`<label><input type="radio" name="result" value="${v}" ${(a.final ? a.result || 'none' : '') === v ? 'checked' : ''}><span>${l}</span></label>`)}</div></div>
    <div class="flex"><button class="btn grow">${icon('save')}저장</button></div></form>
  <form method="post" action="/admin/consulting/app/${a.id}/delete" data-confirm="이 지원 대학을 뺄까요?">${csrfField(ctx)}<button class="btn danger full">${icon('trash')}빼기</button></form>`, { active: '/admin/consulting' });
});
post('/admin/consulting/app/:id', 'staff', ctx => {
  const a = one('SELECT * FROM applications WHERE id=?', ctx.params.id) || notFound();
  const rec = {}; for (const [k, v] of Object.entries(ctx.body)) { const m = /^r_(\d+)$/.exec(k); if (m) rec[m[1]] = num(v); }
  const r = ctx.body.result || '';
  run('UPDATE applications SET records=?, memo=?, final=?, result=? WHERE id=?', JSON.stringify(rec), ctx.body.memo || null, r ? 1 : 0, r && r !== 'none' ? r : null, a.id);
  recalcApp(a.id);
  ctx.redirect(`/admin/consulting/app/${a.id}`, r ? '저장하고 결과분석표에 올렸어요.' : '저장했어요.');
});
post('/admin/consulting/app/:id/delete', 'staff', ctx => { const a = one('SELECT * FROM applications WHERE id=?', ctx.params.id) || notFound(); run('DELETE FROM applications WHERE id=?', a.id); ctx.redirect(`/admin/consulting/students?y=${a.year}`, '뺐어요.'); });

// ---------- K:결과분석표 ----------
get('/admin/consulting/results', 'staff', ctx => {
  const y = Number(ctx.query.y) || curYear(); const q = (ctx.query.q || '').trim(); const see = canSeeCutoff(ctx.user);
  const rows = all(`SELECT a.*, s.name sname, s.school_grade, s.grade sgrade, u.name uname, u.dept, u.track FROM applications a JOIN users s ON s.id=a.student_id JOIN universities u ON u.id=a.university_id WHERE a.year=? AND a.final=1 ORDER BY u.name, u.dept, a.total DESC`, y)
    .filter(r => !q || r.uname.includes(q));
  const by = {}; for (const r of rows) (by[r.university_id] ||= []).push(r);
  ctx.page('K:결과분석표', html`<a class="back" href="/admin/consulting/students">${icon('left')}K:컨설팅 학생관리</a>
  ${pageTitle('K:결과분석표', `${y}학년도 수시 — 학교 ${Object.keys(by).length}곳 · 학생 ${new Set(rows.map(r => r.student_id)).size}명. 학생관리에서 '최종 결과'를 고른 대학이 학교별로 모여요.`)}
  <div class="pills">${[y + 1, y, y - 1].map(v => html`<a class="pill ${v === y ? 'on' : ''}" href="?y=${v}">${v}학년도</a>`)}</div>
  <form class="mb8"><input type="hidden" name="y" value="${y}"><input type="search" name="q" value="${q}" placeholder="대학 이름으로 찾기"></form>
  ${Object.keys(by).length ? Object.values(by).map(list => { const c = latestCutoff(list[0].university_id); return html`<div class="card"><div class="flex between"><h3 class="mb0">${list[0].uname} ${list[0].dept || ''}</h3>${see && c ? html`<span class="small muted">커트 ${f1(c.cutoff)}${c.final != null ? ` / ${f1(c.final)}` : ''}</span>` : ''}</div>
    <table class="tbl mt8"><tr><th>학생</th><th>내신</th><th>실기</th><th>총점</th><th>결과</th></tr>${list.map(r => html`<tr><td><a href="/admin/consulting/app/${r.id}">${r.sname}</a> <span class="small muted">${r.sgrade || ''}</span></td><td>${f1(r.school_score)}</td><td>${f1(r.practical_score)}</td><td><b>${f1(r.total)}</b></td><td>${chip(RESULT[r.result || 'none'][0], RESULT[r.result || 'none'][1])}</td></tr>`)}</table></div>`; })
    : empty(`${y}학년도 결과가 아직 없습니다`, 'K:컨설팅 학생관리에서 지원 대학의 실기 기록을 넣고 \'최종 결과\'를 고르면 여기에 올라와요.')}`, { active: '/admin/consulting' });
});

// ---------- 대학검색 ----------
const trackText = u => [u.track && u.track_type && u.track.startsWith(u.track_type) ? null : u.track_type, u.track].filter(Boolean).join(' ');
const ratioText = u => u.admission === '정시'
  ? [u.school_ratio ? `학생부 ${u.school_ratio}%` : null, u.suneung_ratio != null ? `수능 ${u.suneung_ratio}%` : null, u.practical_ratio != null ? `실기 ${u.practical_ratio}%` : null].filter(Boolean).join(' · ')
  : [u.school_ratio != null ? `내신 ${u.school_ratio}%` : null, u.practical_ratio != null ? `실기 ${u.practical_ratio}%` : null].filter(Boolean).join(' · ');
function uniCard(ctx, u, ex, pick) {
  const c = programRow(u, { grade: pick.grade, system: pick.g, studentId: pick.s?.id }); const see = canSeeCutoff(ctx.user);
  const isJ = u.admission === '정시';
  const q = new URLSearchParams(Object.entries({ s: pick.s?.id, g: pick.g, t: pick.t }).filter(([, v]) => v != null && v !== '')).toString();
  return html`<details class="uc" data-src="/admin/student-predict/card/${u.id}${q ? '?' + q : ''}"><summary>
    <div class="uc-h"><div class="uc-t"><b>${u.name}</b> <span>${u.dept || ''}</span></div>${pick.grade != null && see ? verdictChip(c.verdict) : ''}${icon('down', 'uc-i')}</div>
    <div class="uc-m">${[[u.region, u.city].filter(Boolean).join(' '), u.founding, trackText(u), u.quota ? `모집 ${u.quota}명` : null, ratioText(u)].filter(Boolean).join(' · ') || u.admission}</div>
    <div class="uc-m">실기: ${exNames(u, ex) || '무실기'}</div>
    <div class="uc-s"><span>${isJ ? '수능' : '내신'} 만점 <b>${f1(isJ ? u.suneung_max : u.school_max)}</b></span><span>실기 만점 <b>${f1(c.pmax)}</b></span>${see ? html`<span>커트라인 <b>${c.cut ? f1(c.cut.cutoff) : '—'}</b>${c.cut?.final != null ? ` (최종 ${f1(c.cut.final)})` : ''}</span>` : ''}
      ${pick.grade != null || (isJ && c.base != null) ? html`<span class="blue">총점 <b>${f1(c.total)}</b></span>${see && c.m1 != null ? html`<span class="${c.m1 >= 0 ? 'green' : 'red'}">여유 <b>${c.m1 >= 0 ? '+' : ''}${f1(c.m1)}</b></span>` : ''}` : ''}</div>
  </summary><div class="uc-b"><p class="small muted">불러오는 중…</p></div></details>`;
}
function uniLinkCard(ctx, u, ex, pick, href, extra = '') {
  const c = programRow(u, { grade: pick.grade, system: pick.g, studentId: pick.s?.id }); const see = canSeeCutoff(ctx.user);
  return html`<div class="card"><a href="${href}" style="display:block"><div class="flex between"><b style="font-size:16px">${u.name}</b>${pick.grade != null && see ? verdictChip(c.verdict) : ''}</div><div class="b">${u.dept || ''}</div>
    <p class="small muted mt8 mb0">${[[u.region, u.city].filter(Boolean).join(' '), u.founding, trackText(u), u.quota ? `모집 ${u.quota}명` : null, u.school_ratio != null ? `내신 ${u.school_ratio}%` : null, u.practical_ratio != null ? `실기 ${u.practical_ratio}%` : null].filter(Boolean).join(' · ') || u.admission}</p>
    <p class="small mt8 mb0"><span class="muted">실기:</span> ${exNames(u, ex) || '무실기'}</p>
    <div class="chips mt8">${chip(`${u.admission === '정시' ? '수능' : '내신'} 만점 ${f1(u.admission === '정시' ? u.suneung_max : u.school_max)}`)}${chip(`실기 만점 ${f1(c.pmax)}`)}${see ? chip(`커트라인 ${c.cut ? f1(c.cut.cutoff) : '—'}${c.cut?.final != null ? ` (최종 ${f1(c.cut.final)})` : ''}`, 'dark') : chip('커트라인 본원 확인')}
      ${pick.grade != null ? html`${chip(`${u.admission === '정시' ? '수능' : '내신'} ${f1(c.base)}`, 'blue')}${chip(`총점 ${f1(c.total)}`, 'blue')}${see && c.m1 != null ? chip(`여유 ${c.m1 >= 0 ? '+' : ''}${f1(c.m1)}`, c.m1 >= 0 ? 'green' : 'red') : ''}` : ''}</div></a>${extra}</div>`;
}
function uniDetail(ctx, u, ex, pick) {
  const see = canSeeCutoff(ctx.user); const isJ = u.admission === '정시';
  const ids = J(u.exercises, []); const sc = J(u.scoring); const gt = J(u.grade_table);
  const cuts = see ? all('SELECT * FROM cutoffs WHERE university_id=? ORDER BY year DESC', u.id) : [];
  const row = programRow(u, { grade: pick.grade, system: pick.g, studentId: pick.s?.id });
  const rec = pick.s ? Object.fromEntries(ids.map(i => [i, monthlyAvg(pick.s.id, i)])) : {};
  const data = { isJ, g: pick.g, grade: pick.grade, base: isJ ? row.base : null, gender: pick.gender || 'M', gt, scoring: sc, rec,
    ex: ids.map(i => ({ id: i, name: ex[i]?.name || '?', unit: ex[i]?.unit || '', hb: ex[i]?.higher_better ?? 1 })),
    cut: see && cuts[0] ? [cuts[0].cutoff, cuts[0].final] : null };
  const info = [['학교/전형명', u.name], ['지역 / 운영', [[u.region, u.city].filter(Boolean).join(' '), u.founding].filter(Boolean).join(' / ')], ['학과', u.dept], ['전형', trackText(u)],
    ['모집인원', u.quota ? `${u.quota}명` : null], ['배수선발 · 단계', u.stage], ['교직이수', u.teacher_cert ? 'O' : null], ['실기 만점', practicalMax(u) != null ? `${fmtNum(practicalMax(u))}점` : null],
    ['반영비율', ratioText(u), 1],
    ...(isJ ? [['수능 반영 영역', u.subjects, 1], ['영역별 반영', u.subject_weights, 1], ['수능 만점', u.suneung_max != null ? `${fmtNum(u.suneung_max)}점` : null]]
      : [['학년별 반영', u.year_weights], ['내신 반영교과', [u.subjects, u.subject_weights, u.subject_scope].filter(Boolean).join(' · '), 1]]),
    ['수능최저', u.suneung_min || 'X'], ['면접고사', u.interview_date || 'X'], ['실기고사', u.practical_date, 1], ['메모', u.memo, 1]].filter(r => r[1]);
  const notes = J(u.field_notes);
  return html`
  ${u.changes ? html`<div class="uc-chg"><b>전년도 대비 변경 사항</b><div>${u.changes}</div></div>` : ''}
  <div class="uc-sec"><div class="uc-st">${isJ ? '수능' : '내신'} · 실기 · 총점${see ? ' · 커트라인' : ''}</div>
    <div class="uc-calc" data-calc>
      <script type="application/json">${raw(JSON.stringify(data).replace(/</g, '\\u003c'))}</script>
      <div class="row2">${isJ ? html`<label class="field"><span>수능 환산 점수 ${u.suneung_max ? `(만점 ${fmtNum(u.suneung_max)})` : ''}</span><input type="number" step="any" data-k="base" value="${row.base != null ? fmtNum(row.base, 2) : ''}" placeholder="${pick.s ? '모의고사 성적이 없어요' : '예: 520'}"></label>`
        : html`<label class="field"><span>적용 학년도</span><select data-k="g"><option value="9" ${pick.g === 9 ? 'selected' : ''}>2027학년도 · 9등급제</option><option value="5" ${pick.g === 5 ? 'selected' : ''}>2028학년도 · 5등급제</option></select></label>
          <label class="field"><span>내신 등급 (소수점 가능)</span><input type="number" step="any" data-k="grade" value="${pick.grade ?? ''}" placeholder="예: 2.5"></label>`}</div>
      <div class="uc-grid${see ? '' : ' nocut'}">
        <div class="uc-box"><small>${isJ ? '수능' : '학생부'}</small><b data-o="base">—</b></div>
        <div class="uc-box uc-prac"><div class="flex between"><small>실기 <b data-o="prac">0</b> / ${f1(practicalMax(u))}</small>${ids.length ? html`<select data-k="gender" class="uc-sex"><option value="M">남</option><option value="F" ${data.gender === 'F' ? 'selected' : ''}>여</option></select>` : ''}</div>
          ${ids.length ? html`<div class="uc-ex">${data.ex.map(e => html`<label><span>${e.name}</span><input type="number" step="any" data-ex="${e.id}" value="${rec[e.id] ?? ''}" placeholder="기록${e.unit ? ' (' + e.unit + ')' : ''}"><em data-o="p${e.id}">0</em></label>`)}</div>` : html`<p class="small muted mb0">실기 없음</p>`}</div>
        <div class="uc-box uc-tot"><small>총점</small><b data-o="total">—</b><em data-o="margin"></em></div>
        ${see ? html`<div class="uc-box"><small>커트라인</small><b>${cuts[0] ? f1(cuts[0].cutoff) : '—'}</b>${cuts[0]?.final != null ? html`<em>최종 ${f1(cuts[0].final)}</em>` : ''}</div>` : ''}
      </div>
      ${see && cuts.length ? html`<div class="uc-cut"><b class="small">커트라인 비교</b><div class="scroll-x"><table class="tbl"><tr><th>학년도</th><th>최초합</th><th>최종합</th><th>평균</th><th>경쟁률</th></tr>
        ${cuts.map(c => html`<tr><td>${c.year}학년도</td><td>${f1(c.cutoff)}</td><td>${f1(c.final)}</td><td>${f1(c.average)}</td><td>${c.competition != null ? fmtNum(c.competition, 2) + ':1' : '—'}</td></tr>`)}</table></div>
        ${cuts.filter(c => c.memo).map(c => html`<p class="help mb0">${c.year}학년도: ${c.memo}</p>`)}</div>` : ''}
    </div></div>
  <div class="uc-sec"><div class="uc-st">입시 정보</div><div class="uc-info">${info.map(([k, v, wide]) => html`<div class="${wide ? 'w' : ''}"><small>${k}</small><div>${v}</div></div>`)}</div></div>
  ${ids.length ? html`<div class="uc-sec"><div class="flex between"><div class="uc-st mb0">실기 배점표 <span data-o="sexlabel">(${data.gender === 'F' ? '여' : '남'} 기준)</span></div></div>
    <div class="scroll-x"><table class="uc-tbl" data-o="table"></table></div>
    <p class="help mb0">초록색 줄이 위에서 입력한 기록이 들어가는 점수예요.${Object.keys(notes).length ? html`<br>${ids.filter(i => notes[i]).map(i => html`${ex[i]?.name}: ${[].concat(notes[i]).join(' / ')}<br>`)}` : ''}</p></div>` : ''}
  <div class="flex mt8"><a class="btn sm ghost grow" href="/admin/consulting/program/${u.id}?from=search${pick.s ? '&st=' + pick.s.id : ''}">${icon('doc')}학교 시트 크게 보기</a>${isStaff(ctx.user) ? html`<a class="btn sm ghost grow" href="/admin/universities/${u.id}">${icon('pen')}이 학교 정보 고치기</a>` : ''}</div>`;
}
const UC_JS = `(()=>{const f=(v,d=1)=>v==null||isNaN(v)?'—':(+v).toFixed(d).replace(/\\.0+$/,'').replace(/(\\.\\d*?)0+$/,'$1');
function school(t,g){if(!t||!t.length||g==null||g==='')return null;const r=[...t].sort((a,b)=>a[0]-b[0]);if(g<=r[0][0])return r[0][1];for(let i=1;i<r.length;i++)if(g<=r[i][0]){const[a,b]=r[i-1],[c,d]=r[i];return b+(d-b)*(g-a)/(c-a)}return r[r.length-1][1]}
function pts(t,hb,v){if(!t||!t.length||v==null||v==='')return null;let b=0;for(const[th,p]of t)if(hb?v>=th:v<=th)b=Math.max(b,p);return b}
function hit(t,hb,v){if(v==null||v===''||!t)return -1;let bi=-1,bp=-1;t.forEach(([th,p],i)=>{if((hb?v>=th:v<=th)&&p>bp){bp=p;bi=i}});return bi}
function run(box){const D=JSON.parse(box.querySelector('script').textContent);const $=s=>box.querySelector(s);const root=box.closest('.uc-b');const O=k=>root.querySelector('[data-o="'+k+'"]');
 const val=k=>{const e=$('[data-k="'+k+'"]');return e?e.value:''};
 const calc=()=>{const sex=val('gender')||D.gender;let base=D.isJ?(val('base')===''?null:+val('base')):school(D.gt[val('g')||D.g],val('grade')===''?null:+val('grade'));
  let prac=0,any=false;const rec={};D.ex.forEach(e=>{const i=$('[data-ex="'+e.id+'"]');const v=i&&i.value!==''?+i.value:null;rec[e.id]=v;const p=pts((D.scoring[e.id]||{})[sex],e.hb,v);if(p!=null){prac+=p;any=true}const o=O('p'+e.id);if(o)o.textContent=f(p??0,2)+' / '+f(Math.max(0,...((D.scoring[e.id]||{})[sex]||[[0,0]]).map(r=>r[1])),2)});
  O('base').textContent=f(base,2);O('prac').textContent=f(prac,2);const tot=base==null&&!any?null:(base||0)+prac;O('total').textContent=f(tot,2);
  const m=O('margin');if(m)m.textContent=D.cut&&tot!=null&&base!=null?('여유 '+(tot-D.cut[0]>=0?'+':'')+f(tot-D.cut[0],2)):'';if(m)m.className=D.cut&&tot!=null&&tot-D.cut[0]>=0?'green':'red';
  const T=O('table');if(T){const cols=D.ex.map(e=>({e,t:((D.scoring[e.id]||{})[sex]||[])}));const n=Math.max(0,...cols.map(c=>c.t.length));
   let h='<tr>'+cols.map(c=>'<th colspan="2">'+c.e.name+'<small>만점 '+f(Math.max(0,...c.t.map(r=>r[1])),2)+'</small></th>').join('')+'</tr><tr class="sub">'+cols.map(c=>'<td>점수</td><td>기록'+(c.e.unit?' ('+c.e.unit+')':'')+'</td>').join('')+'</tr>';
   for(let k=0;k<n;k++){h+='<tr>'+cols.map(c=>{const r=c.t[k];if(!r)return '<td></td><td></td>';const on=hit(c.t,c.e.hb,rec[c.e.id])===k;const th=r[0]>=9999?'그 외':r[0]===0&&c.e.hb?'그 외':f(r[0],2);return '<td class="'+(on?'on':'')+'">'+f(r[1],2)+'</td><td class="'+(on?'on':'')+'">'+th+'</td>'}).join('')+'</tr>'}
   T.innerHTML=h;const L=O('sexlabel');if(L)L.textContent='('+(sex==='F'?'여':'남')+' 기준)'}};
 box.addEventListener('input',calc);box.addEventListener('change',calc);calc()}
document.addEventListener('toggle',async e=>{const d=e.target;if(!(d instanceof HTMLDetailsElement)||!d.classList.contains('uc')||!d.open)return;
 document.querySelectorAll('details.uc[open]').forEach(o=>{if(o!==d)o.open=false});
 const top=d.getBoundingClientRect().top;if(top<70)d.scrollIntoView({block:'start'});else if(top<0)d.scrollIntoView();
 if(d.dataset.loaded)return;d.dataset.loaded=1;
 const b=d.querySelector('.uc-b');try{const r=await fetch(d.dataset.src,{credentials:'same-origin'});b.innerHTML=await r.text();b.querySelectorAll('[data-calc]').forEach(run)}catch(_){b.innerHTML='<p class="small red">불러오지 못했어요. 다시 열어 주세요.</p>';delete d.dataset.loaded}},true)})()`;
get('/admin/student-predict/card/:id', 'staff', ctx => {
  const u = one('SELECT * FROM universities WHERE id=?', ctx.params.id) || notFound();
  ctx.send(uniDetail(ctx, u, exMap(), readPick(ctx)));
});
get('/admin/student-predict/jungsi', 'staff', ctx => ctx.redirect('/admin/student-predict?m=jungsi'));
get('/admin/student-predict', 'staff', ctx => {
  const m = ctx.query.m === 'jungsi' ? '정시' : '수시'; const pick = readPick(ctx); const ex = exMap();
  const keep = { m: ctx.query.m, b: ctx.query.b, s: pick.s?.id, t: pick.t, g: ctx.query.g, r: ctx.query.r, d: ctx.query.d, q: ctx.query.q };
  const f = filterUnis(ctx, m);
  ctx.page('대학검색', html`${studentPicker(ctx, '/admin/student-predict', keep, pick)}
  ${pageTitle('대학검색', '대학을 누르면 바로 아래에 변경 사항, 총점 계산, 입시 정보, 실기 배점표가 펼쳐져요.')}
  <div class="seg"><a class="${m === '수시' ? 'on' : ''}" href="${qs('/admin/student-predict', { ...keep, m: '' })}">수시</a><a class="${m === '정시' ? 'on' : ''}" href="${qs('/admin/student-predict', { ...keep, m: 'jungsi' })}">정시</a></div>
  ${filterBar(ctx, '/admin/student-predict', keep, f)}
  <p class="small muted"><b>${f.rows.length}</b>곳 · 대학을 누르면 입시 정보와 실기 배점표가 열려요</p>
  ${f.rows.length ? f.rows.map((u, i) => { const g = regionGroup(u.region); const head = !f.r && (i === 0 || regionGroup(f.rows[i - 1].region) !== g); return html`${head ? html`<h2 class="sec uc-reg">${g} <small>${f.rows.filter(x => regionGroup(x.region) === g).length}곳</small></h2>` : ''}${uniCard(ctx, u, ex, pick)}`; }) : empty('조건에 맞는 대학이 없어요')}
  <script>${raw(UC_JS)}</script>`, { active: '/admin/student-predict' });
});

// ---------- 커트라인 ----------
get('/admin/predict', 'staff', ctx => {
  if (!canSeeCutoff(ctx.user)) return ctx.page('커트라인', html`${pageTitle('커트라인')}${empty('커트라인은 원장·부원장만 볼 수 있어요', '학생·학부모·강사 화면에는 "본원에서 확인" 안내만 나와요.')}`);
  const adm = ctx.query.a === '정시' || ctx.query.m === 'jungsi' ? '정시' : '수시'; const pick = readPick(ctx); const ex = exMap();
  const keep = { a: adm, b: ctx.query.b, s: pick.s?.id, t: pick.t, g: ctx.query.g, r: ctx.query.r, d: ctx.query.d, q: ctx.query.q };
  const f = filterUnis(ctx, adm); const total = f.counts.all; const filled = one('SELECT COUNT(DISTINCT university_id) c FROM cutoffs c JOIN universities u ON u.id=c.university_id WHERE u.admission=?', adm).c;
  const only = Number(ctx.query.u) ? f.rows.filter(u => u.id === Number(ctx.query.u)) : null;
  const y = curYear();
  const form = u => { const c = latestCutoff(u.id); return html`<form method="post" action="/admin/predict" class="flex wrapf mt8" style="border-top:1px solid var(--line);padding-top:10px">${csrfField(ctx)}<input type="hidden" name="u" value="${u.id}"><input type="hidden" name="a" value="${adm}">
    <input type="number" name="year" value="${c?.year || y}" style="width:84px;height:36px" title="학년도"><input type="number" step="any" name="cutoff" value="${c?.cutoff ?? ''}" placeholder="최초합" style="width:96px;height:36px"><input type="number" step="any" name="final" value="${c?.final ?? ''}" placeholder="최종(예비)" style="width:96px;height:36px">
    <button class="btn sm">${icon('save')}</button><a class="btn sm ghost" href="/admin/predict/${u.id}">기록</a></form>`; };
  ctx.page('커트라인', html`${studentPicker(ctx, '/admin/predict', keep, pick)}
  ${pageTitle('커트라인', `대학마다 최초합·최종합 커트라인을 입력합니다 (${filled}/${total}곳 입력). 원장·부원장 화면에만 보이고, 학생·학부모·강사에게는 "본원에서 확인" 안내만 나와요.`)}
  <div class="seg"><a class="${adm === '수시' ? 'on' : ''}" href="${qs('/admin/predict', { ...keep, a: '수시' })}">수시 커트라인</a><a class="${adm === '정시' ? 'on' : ''}" href="${qs('/admin/predict', { ...keep, a: '정시' })}">정시 커트라인</a></div>
  ${filterBar(ctx, '/admin/predict', keep, f)}
  ${(only || f.rows).map(u => uniLinkCard(ctx, u, ex, pick, `/admin/consulting/program/${u.id}`, form(u)))}`, { active: '/admin/predict' });
});
get('/admin/predict/:id', 'staff', ctx => {
  if (!canSeeCutoff(ctx.user)) forbidden();
  const u = one('SELECT * FROM universities WHERE id=?', ctx.params.id) || notFound();
  const cuts = all('SELECT * FROM cutoffs WHERE university_id=? ORDER BY year DESC', u.id);
  ctx.page('커트라인 기록', html`${pageTitle(uniLabel(u), '학년도별 커트라인', ['커트라인', `/admin/predict?u=${u.id}&a=${encodeURIComponent(u.admission)}`])}
  ${cuts.length ? html`<div class="card"><table class="tbl"><tr><th>학년도</th><th>최초합</th><th>최종(예비)</th><th>평균</th><th>경쟁률</th><th></th></tr>${cuts.map(c => html`<tr><td>${c.year}</td><td>${f1(c.cutoff)}</td><td>${f1(c.final)}</td><td>${f1(c.average)}</td><td>${c.competition ?? '—'}</td><td><form method="post" action="/admin/predict/${c.id}/delete" data-confirm="지울까요?">${csrfField(ctx)}<button class="btn xs gray">${icon('trash')}</button></form></td></tr>`)}</table></div>` : empty('기록이 없어요')}
  <form method="post" action="/admin/predict" class="card">${csrfField(ctx)}<input type="hidden" name="u" value="${u.id}"><input type="hidden" name="a" value="${u.admission}"><input type="hidden" name="back" value="detail">
    <div class="row3"><label class="field"><span>학년도</span><input type="number" name="year" value="${curYear()}" required></label><label class="field"><span>최초합</span><input type="number" step="any" name="cutoff" required></label><label class="field"><span>최종(예비)</span><input type="number" step="any" name="final"></label></div>
    <div class="row2"><label class="field"><span>평균 (선택)</span><input type="number" step="any" name="average"></label><label class="field"><span>경쟁률 (선택)</span><input type="number" step="any" name="competition"></label></div>
    <button class="btn full">저장</button><p class="help">같은 학년도를 다시 저장하면 덮어써요.</p></form>`, { active: '/admin/predict' });
});
post('/admin/predict', 'staff', ctx => {
  if (!canSeeCutoff(ctx.user)) forbidden();
  const b = ctx.body; const cut = num(b.cutoff); const yr = Number(b.year);
  if (!yr) bad('학년도를 입력해 주세요.');
  if (cut == null) { run('DELETE FROM cutoffs WHERE university_id=? AND year=?', b.u, yr); return ctx.back('커트라인을 지웠어요.'); }
  run(`INSERT INTO cutoffs(university_id,year,cutoff,final,average,competition) VALUES(?,?,?,?,?,?) ON CONFLICT(university_id,year) DO UPDATE SET cutoff=excluded.cutoff, final=excluded.final, average=COALESCE(excluded.average, average), competition=COALESCE(excluded.competition, competition)`, b.u, yr, cut, num(b.final), num(b.average), num(b.competition));
  if (b.back === 'detail') return ctx.redirect(`/admin/predict/${b.u}`, '저장했어요.');
  ctx.back('커트라인을 저장했어요.');
});
post('/admin/predict/:id/delete', 'staff', ctx => { if (!canSeeCutoff(ctx.user)) forbidden(); const c = one('SELECT * FROM cutoffs WHERE id=?', ctx.params.id) || notFound(); run('DELETE FROM cutoffs WHERE id=?', c.id); ctx.redirect(`/admin/predict/${c.university_id}`, '지웠어요.'); });

// ---------- 수능·모의고사 등급컷 ----------
get('/admin/exams', 'staff', ctx => {
  const year = Number(ctx.query.year) || curYear(); const exam = EXAMS.includes(ctx.query.exam) ? ctx.query.exam : '3월';
  const subjects = EXAM_SUBJECTS.flatMap(([, l]) => l); const subj = subjects.includes(ctx.query.subj) ? ctx.query.subj : '언매';
  const rows = examTable(year, exam, subj); const max = SUBJECT_MAX(subj); const cov = coverage(rows, max);
  const filled = new Set(all('SELECT subject FROM exam_tables WHERE year=? AND exam=?', year, exam).map(r => r.subject));
  const ex = (r, i) => { const hi = r?.raw?.[0]; if (hi == null) return ''; const lo = r.raw[1] ?? hi; const mid = Math.round((hi + lo) / 2); const v = convertRaw([r], mid); return v ? `예) 원점수 ${mid}점 → 표준점수 ${v.std ?? '—'} · 백분위 ${v.pct ?? '—'} · ${v.grade ?? '—'}등급 (원점수 ${hi - lo + 1}개 채움)` : ''; };
  const editRows = rows.length ? rows : [{}];
  ctx.page('수능·모의고사 등급컷', html`${pageTitle('수능·모의고사 등급컷', '시험·과목마다 원점수 → 표준점수·백분위·등급 표를 넣으면, 학생이 적은 원점수에 자동으로 채워져요. 영어·한국사는 절대평가라 표가 필요 없어요.')}
  <div class="mnav"><a class="btn sm ghost" href="?year=${year - 1}&exam=${exam}&subj=${subj}">${icon('left')}${year - 1}</a><b>${year}학년도</b><a class="btn sm ghost" href="?year=${year + 1}&exam=${exam}&subj=${subj}">${year + 1}${icon('right')}</a></div>
  ${pills(EXAMS.map(e => [e, `?year=${year}&exam=${encodeURIComponent(e)}&subj=${subj}`, e]), exam, 'dark')}
  <div class="card"><b class="small">과목 고르기</b>${EXAM_SUBJECTS.map(([g, l]) => html`<div class="flex wrapf mt8"><span class="small muted" style="width:34px">${g}</span>${l.map(s => html`<a class="pill ${s === subj ? 'on' : ''}" style="padding:5px 10px" href="?year=${year}&exam=${encodeURIComponent(exam)}&subj=${encodeURIComponent(s)}">${s}${filled.has(s) ? ' ✓' : ''}</a>`)}</div>`)}</div>
  <form method="post" action="/admin/exams" class="card">${csrfField(ctx)}<input type="hidden" name="year" value="${year}"><input type="hidden" name="exam" value="${exam}"><input type="hidden" name="subj" value="${subj}">
    <h3>${exam}${exam === '수능' ? '' : ' 모의고사'} · ${subj} 변환표</h3>
    <p class="small muted mt0">원점수 몇 점부터 몇 점까지와, 그 양 끝 원점수일 때의 표준점수·백분위를 적으세요. 구간 사이 원점수는 <b>비례해서 자동으로 계산</b>돼요. 끝 값을 비우면 구간 전체가 같은 값이고, 한 점만이면 끝 원점수를 비워도 돼요. 원점수 0~${max}점.</p>
    <details class="mb8"><summary class="small b" style="cursor:pointer">엑셀에서 붙여 넣어 한 번에 채우기 ▼</summary>
      <p class="help">엑셀에서 7칸(원점수 시작, 원점수 끝, 표준 시작, 표준 끝, 백분위 시작, 백분위 끝, 등급)을 줄마다 복사해 붙여 넣으세요. 기존 표를 바꿔요.</p>
      <textarea name="paste" rows="5" placeholder="100	96	140	130	100	90	1"></textarea></details>
    <div id="items">${editRows.map(r => html`<div class="pt li"><div class="row3 small"><label>원점수<div class="flex"><input type="number" name="raw_hi[]" value="${r.raw?.[0] ?? ''}" placeholder="${max}">~<input type="number" name="raw_lo[]" value="${r.raw?.[1] ?? ''}" placeholder="${max - 4}"></div></label>
      <label>표준점수<div class="flex"><input type="number" step="any" name="std_hi[]" value="${r.std?.[0] ?? ''}" placeholder="140">~<input type="number" step="any" name="std_lo[]" value="${r.std?.[1] ?? ''}" placeholder="130"></div></label>
      <label>백분위<div class="flex"><input type="number" step="any" name="pct_hi[]" value="${r.pct?.[0] ?? ''}" placeholder="100">~<input type="number" step="any" name="pct_lo[]" value="${r.pct?.[1] ?? ''}" placeholder="90"></div></label></div>
      <div class="flex mt8"><label class="small">등급 <input type="number" name="grade[]" value="${r.grade ?? ''}" min="1" max="9" style="width:70px;height:34px"></label><span class="small muted grow">${ex(r)}</span><button type="button" class="btn xs gray" data-del>${icon('x')}</button></div></div>`)}</div>
    <button type="button" class="btn gray sm full mb8" id="addItem">${icon('plus')}구간 추가</button>
    <p class="small">채워지는 원점수 <b>${cov.count}</b>개 (0~${max}점 중)</p>
    ${cov.missing.length && rows.length ? html`<div class="note">${icon('alert')}<span>표가 없는 원점수: <b>${rangeText(cov.missing)}</b> — 학생이 이 점수를 적으면 계산되지 않아요.</span></div>` : ''}
    <div class="flex"><button class="btn grow">${icon('save')}저장</button><button class="btn ghost" name="clear" value="1" formnovalidate data-confirm="이 과목 표를 지울까요?">표 지우기</button></div></form>`, { active: '/admin/exams' });
});
post('/admin/exams', 'staff', ctx => {
  const b = ctx.body; const year = Number(b.year); const exam = b.exam; const subj = b.subj;
  if (!year || !EXAMS.includes(exam)) bad('시험을 확인해 주세요.');
  if (b.clear) { run('DELETE FROM exam_tables WHERE year=? AND exam=? AND subject=?', year, exam, subj); return ctx.redirect(`/admin/exams?year=${year}&exam=${encodeURIComponent(exam)}&subj=${encodeURIComponent(subj)}`, '표를 지웠어요.'); }
  let rows = [];
  if ((b.paste || '').trim()) {
    for (const line of b.paste.split(/\r?\n/)) { const c = line.split(/\t|,|\s{2,}/).map(x => num(x.trim())); if (c[0] == null) continue; rows.push({ raw: [c[0], c[1]], std: [c[2], c[3]], pct: [c[4], c[5]], grade: c[6] }); }
  } else {
    const A = k => [].concat(b[k] || []);
    A('raw_hi').forEach((v, i) => { const hi = num(v); if (hi == null) return; rows.push({ raw: [hi, num(A('raw_lo')[i])], std: [num(A('std_hi')[i]), num(A('std_lo')[i])], pct: [num(A('pct_hi')[i]), num(A('pct_lo')[i])], grade: num(A('grade')[i]) }); });
  }
  rows = rows.map(r => ({ ...r, raw: [Math.max(r.raw[0], r.raw[1] ?? r.raw[0]), r.raw[1] == null ? null : Math.min(r.raw[0], r.raw[1])] })).sort((x, y) => y.raw[0] - x.raw[0]);
  run(`INSERT INTO exam_tables(year,exam,subject,rows) VALUES(?,?,?,?) ON CONFLICT(year,exam,subject) DO UPDATE SET rows=excluded.rows, updated_at=datetime('now')`, year, exam, subj, JSON.stringify(rows));
  ctx.redirect(`/admin/exams?year=${year}&exam=${encodeURIComponent(exam)}&subj=${encodeURIComponent(subj)}`, `${rows.length}개 구간을 저장했어요.`);
});
void tx; void maxPoints; void korDay; void isStaff;
