import { get, post, notFound, bad, forbidden } from '../lib/router.js';
import { one, all, run, tx, J } from '../lib/db.js';
import { html, icon, pageTitle, empty, csrfField, chip } from '../lib/html.js';
import { num, fmtNum, isStaff, today, korDay, isValidDate } from '../lib/util.js';
import { canViewStudent } from '../lib/services.js';
import { recordSeries } from './students.js';

const exMap = () => Object.fromEntries(all('SELECT id,name,unit,higher_better FROM exercises').map(e => [e.id, e]));
const uniLabel = u => `${u.name}${u.dept ? ' ' + u.dept : ''}${u.track ? ` (${u.track})` : ''}`;

// ---------- 계산 ----------
// grade_table: { "5": [[등급, 점수], ...], "9": [...] } — 사이 값은 직선 보간
export function schoolScore(u, grade, system) {
  const t = J(u.grade_table)[String(system)];
  if (!t || !t.length || grade == null) return null;
  const rows = [...t].sort((a, b) => a[0] - b[0]);
  if (grade <= rows[0][0]) return rows[0][1];
  for (let i = 1; i < rows.length; i++) if (grade <= rows[i][0]) { const [g0, s0] = rows[i - 1], [g1, s1] = rows[i]; return s0 + ((s1 - s0) * (grade - g0)) / (g1 - g0); }
  return rows[rows.length - 1][1];
}
// scoring: { [exerciseId]: { M: [[기록, 점수], ...], F: [...] } } — 기록이 기준을 넘는 가장 높은 점수
export function practicalScore(u, exId, gender, record, hb) {
  const t = (J(u.scoring)[exId] || {})[gender || 'M'];
  if (!t || !t.length || record == null) return null;
  let best = 0;
  for (const [th, pts] of t) if (hb ? record >= th : record <= th) best = Math.max(best, pts);
  return best;
}
export function maxPoints(u, exId, gender) { const t = (J(u.scoring)[exId] || {})[gender || 'M']; return t && t.length ? Math.max(...t.map(r => r[1])) : null; }
export function bestRecords(sid) { const o = {}; for (const s of recordSeries(sid)) { const vs = s.pts.map(p => p.v); o[s.id] = s.hb ? Math.max(...vs) : Math.min(...vs); } return o; }
function verdict(total, c) {
  if (!c || total == null) return null;
  if (c.average != null && total >= c.average) return ['안정', 'safe', `평균보다 ${fmtNum(total - c.average)}점 높아요`];
  if (total >= c.cutoff) return ['적정', 'ok', `합격선보다 ${fmtNum(total - c.cutoff)}점 높아요`];
  return ['도전', 'risk', `합격선까지 ${fmtNum(c.cutoff - total)}점 남았어요`];
}

// ---------- 학생 탭: 목표 대학 ----------
export function targetsTab(ctx, s) {
  const self = ctx.user.id === s.id; const ex = exMap();
  const tgs = all('SELECT t.*, u.* FROM target_universities t JOIN universities u ON u.id=t.university_id WHERE t.student_id=? ORDER BY t.rank', s.id);
  const best = bestRecords(s.id);
  const unis = self ? all('SELECT id,name,dept,track,admission FROM universities ORDER BY name, dept') : [];
  const y = Number(today().slice(0, 4)) + 1;
  const card = t => {
    const ids = J(t.exercises, []); const sc = schoolScore(t, s.school_grade, s.grade_system || 5);
    return html`<div class="pt"><div><span class="red b small">${t.rank}지망</span> <b>${uniLabel(t)}</b> <span class="small muted">(${t.admission}${t.year ? ` · ${t.year}학년도` : ''})</span></div>
      <div class="small muted mt8">실기:</div><div class="chips mt8">${ids.length ? ids.map(i => chip(ex[i]?.name || '?')) : chip('실기 종목 미지정')}</div>
      <div class="note gray mt8 mb0 small" style="display:block">${t.school_max ? html`내신 <b>${fmtNum(t.school_max)}점</b> 만점 · 내 점수 <b class="red">${sc == null ? '—' : fmtNum(sc) + '점'}</b>` : '내신 환산표 미설정'} ${s.school_grade != null ? `(${s.school_grade}등급, ${s.grade_system || 5}등급제)` : '(내신 미입력)'}</div>
      ${ids.length ? html`<p class="small mt8 mb0"><span class="amber b">${icon('trophy')} 내 최고 기록</span> ${ids.map(i => `${ex[i]?.name} ${best[i] != null ? fmtNum(best[i]) + ex[i].unit : '—'}`).join(' · ')}</p>` : ''}</div>`;
  };
  return html`<div class="card"><h3>목표 대학</h3>${tgs.length ? tgs.map(card) : empty('아직 고른 목표 대학이 없어요', self ? '아래에서 최대 4지망까지 골라 주세요.' : '')}</div>
  ${self ? html`<form method="post" action="/me/targets" class="card">${csrfField(ctx)}<h3>목표 대학 고르기</h3>
    ${[1, 2, 3, 4].map(r => { const cur = tgs.find(t => t.rank === r); return html`<div class="row2"><label class="field"><span>${r}지망</span><select name="u${r}"><option value="">선택 안 함</option>${unis.map(u => html`<option value="${u.id}" ${cur?.university_id === u.id ? 'selected' : ''}>${uniLabel(u)} · ${u.admission}</option>`)}</select></label>
      <label class="field"><span>학년도</span><select name="y${r}">${[y, y + 1, y + 2].map(v => html`<option ${(cur?.year || y) === v ? 'selected' : ''}>${v}</option>`)}</select></label></div>`; })}
    <button class="btn full">저장</button></form>` : ''}`;
}
post('/me/targets', 'student', ctx => {
  tx(() => {
    run('DELETE FROM target_universities WHERE student_id=?', ctx.user.id);
    for (const r of [1, 2, 3, 4]) { const u = Number(ctx.body['u' + r]); if (u) run('INSERT INTO target_universities(student_id,university_id,rank,year) VALUES(?,?,?,?)', ctx.user.id, u, r, Number(ctx.body['y' + r]) || null); }
  });
  ctx.redirect('/me/targets', '목표 대학을 저장했어요.');
});

// ---------- 학생 탭: 모의고사 ----------
const SUBJ = ['국어', '수학', '영어', '탐구1', '탐구2', '한국사'];
export function examsTab(ctx, s) {
  const self = ctx.user.id === s.id;
  const rows = all('SELECT * FROM mock_exams WHERE student_id=? ORDER BY date DESC', s.id);
  return html`${rows.length ? html`<div class="card"><h3>모의고사 성적 <small>등급</small></h3><div class="scroll-x"><table class="tbl"><tr><th>시험</th>${SUBJ.map(x => html`<th>${x}</th>`)}<th></th></tr>
    ${rows.map(r => { const sc = J(r.scores); return html`<tr><td><b>${r.name}</b><div class="small muted">${korDay(r.date)}</div></td>${SUBJ.map(x => html`<td>${sc[x] ?? '—'}</td>`)}
      <td>${self ? html`<form method="post" action="/me/exams/${r.id}/delete" data-confirm="지울까요?">${csrfField(ctx)}<button class="btn xs gray">${icon('trash')}</button></form>` : ''}</td></tr>`; })}</table></div></div>`
    : empty(self ? '아직 입력한 모의고사 성적이 없어요' : '학생이 아직 입력한 모의고사 성적이 없어요')}
  ${self ? html`<form method="post" action="/me/exams" class="card">${csrfField(ctx)}<h3>성적 입력</h3>
    <div class="row2"><label class="field"><span>시험 이름</span><input type="text" name="name" required placeholder="예: 6월 모의평가"></label><label class="field"><span>날짜</span><input type="date" name="date" value="${today()}" required></label></div>
    <div class="row3">${SUBJ.map(x => html`<label class="field"><span>${x}</span><input type="number" name="s_${x}" min="1" max="9" step="1" placeholder="등급"></label>`)}</div>
    <button class="btn full">저장</button></form>` : ''}`;
}
post('/me/exams', 'student', ctx => {
  const b = ctx.body; if (!(b.name || '').trim() || !isValidDate(b.date)) bad('시험 이름과 날짜를 확인해 주세요.');
  const sc = {}; for (const x of SUBJ) { const v = num(b['s_' + x]); if (v != null) sc[x] = Math.min(9, Math.max(1, Math.round(v))); }
  run('INSERT INTO mock_exams(student_id,date,name,scores) VALUES(?,?,?,?)', ctx.user.id, b.date, b.name.trim(), JSON.stringify(sc));
  ctx.redirect('/me/exams', '저장했어요.');
});
post('/me/exams/:id/delete', 'student', ctx => { run('DELETE FROM mock_exams WHERE id=? AND student_id=?', ctx.params.id, ctx.user.id); ctx.redirect('/me/exams', '지웠어요.'); });

// ---------- 학생 탭: 합격 예측 ----------
export function predictTab(ctx, s) {
  const self = ctx.user.id === s.id; const ex = exMap();
  const q = ctx.query; const unis = all('SELECT * FROM universities ORDER BY name, dept');
  const search = (q.q || '').trim(); const onlyEdu = !!q.edu;
  const shown = unis.filter(u => (!search || `${u.name} ${u.dept || ''} ${u.region || ''}`.includes(search)) && (!onlyEdu || (u.dept || '').includes('체육교육')));
  const firstTarget = one('SELECT university_id FROM target_universities WHERE student_id=? ORDER BY rank LIMIT 1', s.id);
  const uid = Number(q.u) || firstTarget?.university_id || shown[0]?.id;
  const u = unis.find(x => x.id === uid);
  const system = Number(q.sys) === 9 ? 9 : Number(q.sys) === 5 ? 5 : s.grade_system || 5;
  const grade = num(q.grade) ?? s.school_grade;
  const gender = ['M', 'F'].includes(q.gender) ? q.gender : s.gender || 'M';
  const best = bestRecords(s.id);
  const base = self ? '/me/predict' : `/students/${s.id}`;
  const hidden = self ? '' : html`<input type="hidden" name="tab" value="predict">`;
  if (!u) return empty('대학이 없어요', '학원에서 대학을 등록하면 예측할 수 있어요.');
  const ids = J(u.exercises, []);
  const recs = Object.fromEntries(ids.map(i => [i, num(q['r' + i]) ?? best[i] ?? null]));
  const pts = Object.fromEntries(ids.map(i => [i, practicalScore(u, i, gender, recs[i], ex[i]?.higher_better)]));
  const sch = schoolScore(u, grade, system);
  const prac = ids.reduce((a, i) => a + (pts[i] || 0), 0);
  const total = (sch || 0) + prac;
  const cut = all('SELECT * FROM cutoffs WHERE university_id=? ORDER BY year DESC', u.id);
  const vd = verdict(total, cut[0]);
  const hasScoring = ids.some(i => maxPoints(u, i, gender) != null);
  return html`
  ${self ? html`<form method="post" action="/me/grade" class="card">${csrfField(ctx)}<h3>내 내신 성적</h3><div class="row2">
    <label class="field"><span>평균 등급</span><input type="number" step="0.01" min="1" max="9" name="grade" value="${s.school_grade ?? ''}" placeholder="예: 2.33"></label>
    <label class="field"><span>등급제</span><select name="sys"><option value="5" ${s.grade_system !== 9 ? 'selected' : ''}>5등급제 (2028학년도~)</option><option value="9" ${s.grade_system === 9 ? 'selected' : ''}>9등급제 (~2027학년도)</option></select></label></div><button class="btn sm full">저장</button></form>`
    : html`<div class="card"><b>내신 성적</b> ${s.school_grade != null ? html`평균 <b class="red">${s.school_grade}등급</b> <span class="small muted">(${s.grade_system || 5}등급제)</span>` : html`<span class="muted">미입력</span>`}</div>`}
  <form method="get" action="${base}" class="card">${hidden}<h3>대학 선택</h3>
    <label class="field"><span>대학 검색</span><input type="search" name="q" value="${search}" placeholder="대학명·학과·지역 (예: 부산, 경성)"></label>
    <label class="check"><input type="checkbox" name="edu" value="1" ${onlyEdu ? 'checked' : ''}><span>체육교육과만</span></label>
    <label class="field"><span>대학·전형 <small style="display:inline">(${shown.length}곳)</small></span><select name="u" onchange="this.form.submit()">${shown.map(x => { const sc = schoolScore(x, grade, system); return html`<option value="${x.id}" ${x.id === u.id ? 'selected' : ''}>${uniLabel(x)} · ${x.admission}${sc != null ? ` · 내신 ${fmtNum(sc)}점` : ''}</option>`; })}</select>
      <small>대학 이름 옆 점수는 ${grade != null ? `내신 ${grade}등급(${system}등급제)을` : '내신을'} 그 학교 환산표로 바꾼 학생부 점수예요.</small></label>
    <h3 class="mt12">내신 · 실기 입력</h3>
    <div class="row3"><label class="field"><span>등급제</span><select name="sys"><option value="5" ${system === 5 ? 'selected' : ''}>5등급제</option><option value="9" ${system === 9 ? 'selected' : ''}>9등급제</option></select></label>
      <label class="field"><span>내신 등급</span><input type="number" step="0.01" name="grade" value="${grade ?? ''}"></label>
      <label class="field"><span>성별 (배점 기준)</span><select name="gender"><option value="M" ${gender === 'M' ? 'selected' : ''}>남</option><option value="F" ${gender === 'F' ? 'selected' : ''}>여</option></select></label></div>
    ${ids.length ? ids.map(i => html`<div class="metric-row"><span>${ex[i]?.name} <span class="small muted">${best[i] != null ? `· 내 최고 ${fmtNum(best[i])}${ex[i].unit}` : ''}</span></span>
      <input type="number" step="any" name="r${i}" value="${recs[i] ?? ''}" style="width:90px;height:36px" placeholder="${ex[i]?.unit}"><span class="small"><b>${pts[i] == null ? '—' : fmtNum(pts[i])}</b>${maxPoints(u, i, gender) != null ? ` / ${maxPoints(u, i, gender)}점` : ''}</span></div>`) : html`<p class="small muted">이 대학은 실기 종목이 지정되지 않았어요.</p>`}
    <button class="btn full mt12">계산하기</button></form>
  <div class="card"><h3>${uniLabel(u)} <small>${u.admission}</small></h3>
    ${u.is_sample ? html`<div class="note">${icon('info')}이 대학의 환산표·배점은 예시 값이에요. 실제 모집요강으로 확인하세요.</div>` : ''}
    <div class="big3"><div><small>학생부</small><b>${sch == null ? '—' : fmtNum(sch)}</b><small>${u.school_max ? `/ ${fmtNum(u.school_max)}` : '환산표 없음'}</small></div>
      <div><small>실기</small><b>${hasScoring ? fmtNum(prac) : '—'}</b><small>${u.practical_max ? `/ ${fmtNum(u.practical_max)}` : hasScoring ? '' : '배점표 없음'}</small></div>
      <div><small>총점</small><b class="red">${sch == null && !hasScoring ? '—' : fmtNum(total)}</b><small>${u.school_max || u.practical_max ? `/ ${fmtNum((u.school_max || 0) + (u.practical_max || 0))}` : ''}</small></div></div>
    ${vd ? html`<div class="verdict ${vd[1]}">${vd[0]} <span class="small" style="font-weight:600">· ${vd[2]}</span></div>` : ''}
    <h3 class="mt12">합격선</h3>${cut.length ? html`<table class="tbl"><tr><th>학년도</th><th>합격선</th><th>평균</th><th>경쟁률</th></tr>${cut.map(c => html`<tr><td>${c.year}</td><td>${fmtNum(c.cutoff)}</td><td>${c.average == null ? '—' : fmtNum(c.average)}</td><td>${c.competition == null ? '—' : c.competition + ':1'}</td></tr>`)}</table>
      <p class="help">평균 이상은 안정, 합격선 이상은 적정으로 판정해요. 참고용이에요.</p>` : html`<p class="small muted m0">아직 등록된 합격선이 없어요.</p>`}
    ${u.memo ? html`<p class="small mt12 mb0" style="white-space:pre-wrap">${u.memo}</p>` : ''}</div>`;
}
post('/me/grade', 'student', ctx => {
  const g = num(ctx.body.grade); if (g != null && (g < 1 || g > 9)) bad('등급은 1~9 사이로 입력해 주세요.');
  run('UPDATE users SET school_grade=?, grade_system=? WHERE id=?', g, Number(ctx.body.sys) === 9 ? 9 : 5, ctx.user.id);
  ctx.redirect('/me/predict', '내신을 저장했어요.');
});

// ---------- 관리: 대학 ----------
function uniForm(ctx, u, action) {
  const exs = all('SELECT id,name FROM exercises WHERE active=1 ORDER BY sort,id');
  const sel = J(u.exercises, []);
  return html`<form method="post" action="${action}" class="formcard">${csrfField(ctx)}
    <div class="row2"><label class="field"><span>대학 이름</span><input type="text" name="name" value="${u.name || ''}" required placeholder="예: 부산대학교"></label>
      <label class="field"><span>학과 (선택)</span><input type="text" name="dept" value="${u.dept || ''}" placeholder="예: 체육교육과"></label></div>
    <div class="row2"><label class="field"><span>전형명 (선택)</span><input type="text" name="track" value="${u.track || ''}" placeholder="예: 실기위주 실기우수자"></label>
      <label class="field"><span>지역 (선택)</span><input type="text" name="region" value="${u.region || ''}" placeholder="예: 부산"></label></div>
    <div class="field"><span class="lbl">전형</span><div class="tg">${['수시', '정시'].map(a => html`<label><input type="radio" name="admission" value="${a}" ${(u.admission || '수시') === a ? 'checked' : ''}><span>${a}</span></label>`)}</div></div>
    <div class="field"><span class="lbl">실기 종목</span><div class="tg" data-order>${[...sel.map(i => exs.find(e => e.id === i)).filter(Boolean), ...exs.filter(e => !sel.includes(e.id))].map(e => html`<label><input type="checkbox" value="${e.id}" ${sel.includes(e.id) ? 'checked' : ''}><span>${e.name}</span></label>`)}</div>
      <input type="hidden" name="exercises" value="${JSON.stringify(sel)}"><small>고른 순서대로 표시됩니다.</small></div>
    <label class="field"><span>메모 (선택)</span><textarea name="memo" rows="2">${u.memo || ''}</textarea></label>
    <button class="btn full">${u.id ? '저장' : '대학 추가'}</button></form>
    <script>(()=>{const box=document.currentScript.previousElementSibling.querySelector('[data-order]');const h=box.parentElement.querySelector('[name=exercises]');let o=JSON.parse(h.value||'[]');box.addEventListener('change',e=>{const v=+e.target.value;o=o.filter(x=>x!==v);if(e.target.checked)o.push(v);h.value=JSON.stringify(o)})})()</script>`;
}
function readUni(b) {
  const name = (b.name || '').trim(); if (!name) bad('대학 이름을 입력해 주세요.');
  let ex = []; try { ex = JSON.parse(b.exercises || '[]').map(Number).filter(Boolean); } catch {}
  return [name, b.dept || null, b.track || null, b.region || null, b.admission === '정시' ? '정시' : '수시', JSON.stringify(ex), b.memo || null];
}
get('/admin/universities', 'staff', ctx => {
  const ex = exMap(); const q = (ctx.query.q || '').trim();
  const rows = all(`SELECT u.*, (SELECT COUNT(*) FROM cutoffs c WHERE c.university_id=u.id) nc FROM universities u ${q ? 'WHERE name LIKE ? OR dept LIKE ?' : ''} ORDER BY name, dept`, ...(q ? [`%${q}%`, `%${q}%`] : []));
  const total = one('SELECT COUNT(*) c FROM universities').c;
  ctx.page('대학 관리', html`${pageTitle('대학 관리', '학생이 목표로 고를 대학과 대학별 실기 종목·환산표·배점을 관리합니다.')}
  <div class="note">${icon('info')}<span>대학 목록과 실기 종목은 예시로 넣어 두었어요. 내신 환산표·실기 배점표·합격선은 매년 모집요강을 보고 입력해 주세요.</span></div>
  <details class="card"><summary>대학 추가${icon('down')}</summary>${uniForm(ctx, {}, '/admin/universities')}</details>
  <form class="flex mb8"><input type="search" name="q" value="${q}" placeholder="대학·학과 검색"><button class="btn sm dark" style="height:44px">${icon('search')}</button></form>
  <h2 class="sec">대학 목록 <small>(${q ? `${rows.length} / ` : ''}${total})</small></h2>
  <div class="list">${rows.map(u => html`<a href="/admin/universities/${u.id}"><div class="row-m"><b>${uniLabel(u)} <span class="muted small" style="display:inline">(${u.admission})</span></b>
    <span>${J(u.exercises, []).map(i => ex[i]?.name).filter(Boolean).join(' · ') || '실기 종목 미지정'}</span></div>
    <div class="row-r">${u.school_max ? chip('환산표', 'green') : ''}${u.nc ? chip(`합격선 ${u.nc}`, 'blue') : ''}${icon('right')}</div></a>`)}</div>`);
});
post('/admin/universities', 'staff', ctx => {
  const r = run('INSERT INTO universities(name,dept,track,region,admission,exercises,memo,is_sample) VALUES(?,?,?,?,?,?,?,0)', ...readUni(ctx.body));
  ctx.redirect(`/admin/universities/${r.lastInsertRowid}`, '대학을 추가했어요. 환산표와 배점을 입력해 주세요.');
});
const tableText = rows => (rows || []).map(r => r.join(' ')).join('\n');
const parseTable = s => (s || '').split(/\n/).map(l => l.trim().split(/[\s,=:]+/).map(Number)).filter(r => r.length >= 2 && r.every(Number.isFinite)).map(r => [r[0], r[1]]);
get('/admin/universities/:id', 'staff', ctx => {
  const u = one('SELECT * FROM universities WHERE id=?', ctx.params.id) || notFound();
  const ex = exMap(); const ids = J(u.exercises, []); const gt = J(u.grade_table); const sc = J(u.scoring);
  ctx.page('대학 설정', html`${pageTitle(uniLabel(u), u.admission, ['대학 목록', '/admin/universities'])}
  ${uniForm(ctx, u, `/admin/universities/${u.id}`)}
  <form method="post" action="/admin/universities/${u.id}/scores" class="card mt12">${csrfField(ctx)}<h3>내신 환산표</h3>
    <p class="small muted mt0">한 줄에 "등급 점수"로 적어요. 사이 등급(예: 2.33)은 직선으로 계산해요.</p>
    <label class="field"><span>학생부 만점</span><input type="number" step="any" name="school_max" value="${u.school_max ?? ''}"></label>
    <div class="row2"><label class="field"><span>5등급제</span><textarea name="g5" rows="6" placeholder="1 300\n2 294\n3 285\n4 270\n5 250">${tableText(gt['5'])}</textarea></label>
      <label class="field"><span>9등급제</span><textarea name="g9" rows="6" placeholder="1 300\n2 297\n...\n9 200">${tableText(gt['9'])}</textarea></label></div>
    <h3 class="mt12">실기 배점표</h3><p class="small muted mt0">한 줄에 "기록 점수". 높을수록 좋은 종목은 그 기록 이상, 낮을수록 좋은 종목은 그 기록 이하일 때 그 점수를 받아요.</p>
    <label class="field"><span>실기 만점</span><input type="number" step="any" name="practical_max" value="${u.practical_max ?? ''}"></label>
    ${ids.length ? ids.map(i => html`<div class="row2">${['M', 'F'].map(g => html`<label class="field"><span>${ex[i]?.name} · ${g === 'M' ? '남' : '여'} <small style="display:inline">(${ex[i]?.unit})</small></span><textarea name="s_${i}_${g}" rows="5" placeholder="${ex[i]?.higher_better ? '300 100\n290 95\n280 90' : '8.0 100\n8.3 95\n8.6 90'}">${tableText((sc[i] || {})[g])}</textarea></label>`)}</div>`) : html`<p class="small muted">위에서 실기 종목을 먼저 골라 주세요.</p>`}
    <label class="check"><input type="checkbox" name="is_sample" ${u.is_sample ? 'checked' : ''}><span>예시 값 (학생 화면에 "예시 값"으로 안내)</span></label>
    <button class="btn full">환산표·배점 저장</button></form>
  <form method="post" action="/admin/universities/${u.id}/delete" data-confirm="이 대학을 삭제할까요? 목표 대학·합격선도 함께 삭제돼요.">${csrfField(ctx)}<button class="btn danger full">${icon('trash')}대학 삭제</button></form>`);
});
post('/admin/universities/:id', 'staff', ctx => { run('UPDATE universities SET name=?,dept=?,track=?,region=?,admission=?,exercises=?,memo=? WHERE id=?', ...readUni(ctx.body), ctx.params.id); ctx.redirect(`/admin/universities/${ctx.params.id}`, '저장했어요.'); });
post('/admin/universities/:id/scores', 'staff', ctx => {
  const u = one('SELECT * FROM universities WHERE id=?', ctx.params.id) || notFound(); const b = ctx.body;
  const gt = { 5: parseTable(b.g5), 9: parseTable(b.g9) }; const sc = {};
  for (const i of J(u.exercises, [])) sc[i] = { M: parseTable(b[`s_${i}_M`]), F: parseTable(b[`s_${i}_F`]) };
  run('UPDATE universities SET school_max=?, grade_table=?, practical_max=?, scoring=?, is_sample=? WHERE id=?', num(b.school_max), JSON.stringify(gt), num(b.practical_max), JSON.stringify(sc), b.is_sample ? 1 : 0, u.id);
  ctx.redirect(`/admin/universities/${u.id}`, '환산표·배점을 저장했어요.');
});
post('/admin/universities/:id/delete', 'staff', ctx => { run('DELETE FROM universities WHERE id=?', ctx.params.id); ctx.redirect('/admin/universities', '삭제했어요.'); });

// ---------- 관리: 합격선 ----------
get('/admin/predict', 'staff', ctx => {
  const adm = ctx.query.a === '정시' ? '정시' : '수시';
  const search = (ctx.query.q || '').trim(); const onlyEdu = !!ctx.query.edu;
  const unis = all(`SELECT u.*, (SELECT COUNT(*) FROM cutoffs c WHERE c.university_id=u.id) nc FROM universities u WHERE admission=? ORDER BY name, dept`, adm)
    .filter(u => (!search || `${u.name} ${u.dept || ''} ${u.region || ''}`.includes(search)) && (!onlyEdu || (u.dept || '').includes('체육교육')));
  const uid = Number(ctx.query.u) || unis[0]?.id; const u = unis.find(x => x.id === uid) || (uid ? one('SELECT * FROM universities WHERE id=?', uid) : null);
  const cuts = u ? all('SELECT * FROM cutoffs WHERE university_id=? ORDER BY year DESC', u.id) : [];
  const y = Number(today().slice(0, 4));
  ctx.page('합격선 입력', html`${pageTitle('합격선 입력', '대학 합격 예측에서 학생들이 비교하는 연도별 합격선을 입력합니다. 학생·학부모 화면에 바로 반영됩니다.')}
  <div class="seg"><a href="?a=수시" class="${adm === '수시' ? 'on' : ''}">수시 합격선</a><a href="?a=정시" class="${adm === '정시' ? 'on' : ''}">정시</a></div>
  <form class="card"><h3>대학 선택</h3><input type="hidden" name="a" value="${adm}">
    <label class="field"><span>대학 검색</span><input type="search" name="q" value="${search}" placeholder="대학명·학과·지역 (예: 부산, 경성)"></label>
    <label class="check"><input type="checkbox" name="edu" value="1" ${onlyEdu ? 'checked' : ''} onchange="this.form.submit()"><span>체육교육과만</span></label>
    <label class="field"><span>대학·전형 <small style="display:inline">(${unis.length}곳)</small></span><select name="u" onchange="this.form.submit()">${unis.map(x => html`<option value="${x.id}" ${x.id === u?.id ? 'selected' : ''}>${x.nc ? '✓ ' : ''}${uniLabel(x)}</option>`)}</select>
      <small>✓ 표시는 합격선이 이미 등록된 전형입니다.</small></label></form>
  ${u ? html`<div class="card"><h3>${uniLabel(u)}</h3><b class="small">등록된 합격선 (${cuts.length})</b>
    ${cuts.length ? html`<table class="tbl mt8"><tr><th>학년도</th><th>합격선</th><th>평균</th><th>경쟁률</th><th></th></tr>${cuts.map(c => html`<tr><td>${c.year}</td><td>${fmtNum(c.cutoff)}</td><td>${c.average == null ? '—' : fmtNum(c.average)}</td><td>${c.competition ?? '—'}</td>
      <td><form method="post" action="/admin/predict/${c.id}/delete" data-confirm="지울까요?">${csrfField(ctx)}<button class="btn xs gray">${icon('trash')}</button></form></td></tr>`)}</table>` : html`<p class="small muted">아직 등록된 합격선이 없습니다.</p>`}
    <hr class="sep"><b>합격선 저장</b><p class="help mt0">같은 학년도를 다시 저장하면 덮어씁니다. 평균·경쟁률·메모는 비워도 됩니다. 평균을 넣으면 학생 화면에서 평균 이상은 안정, 합격선 이상은 적정으로 판정합니다.</p>
    <form method="post" action="/admin/predict" class="mt8">${csrfField(ctx)}<input type="hidden" name="u" value="${u.id}"><input type="hidden" name="a" value="${adm}">
      <div class="row2"><label class="field"><span>학년도</span><input type="number" name="year" value="${y}" required></label><label class="field"><span>합격선(최저, 총점)</span><input type="number" step="any" name="cutoff" required></label></div>
      <div class="row2"><label class="field"><span>평균 (선택)</span><input type="number" step="any" name="average"></label><label class="field"><span>경쟁률 (선택)</span><input type="number" step="any" name="competition" placeholder="예: 5.2"></label></div>
      <label class="field"><span>메모 (선택)</span><input type="text" name="memo"></label>
      <div class="flex"><button type="reset" class="btn ghost">입력 지우기</button><button class="btn grow">저장</button></div></form></div>` : empty('대학이 없어요', '대학 관리에서 먼저 추가해 주세요.')}`);
});
post('/admin/predict', 'staff', ctx => {
  const b = ctx.body; const cut = num(b.cutoff); const yr = Number(b.year);
  if (cut == null || !yr) bad('학년도와 합격선을 입력해 주세요.');
  run(`INSERT INTO cutoffs(university_id,year,cutoff,average,competition,memo) VALUES(?,?,?,?,?,?) ON CONFLICT(university_id,year) DO UPDATE SET cutoff=excluded.cutoff, average=excluded.average, competition=excluded.competition, memo=excluded.memo`, b.u, yr, cut, num(b.average), num(b.competition), b.memo || null);
  ctx.redirect(`/admin/predict?a=${encodeURIComponent(b.a || '수시')}&u=${b.u}`, '합격선을 저장했어요.');
});
post('/admin/predict/:id/delete', 'staff', ctx => { const c = one('SELECT * FROM cutoffs WHERE id=?', ctx.params.id) || notFound(); run('DELETE FROM cutoffs WHERE id=?', c.id); ctx.redirect(`/admin/predict?u=${c.university_id}`, '지웠어요.'); });
void forbidden; void canViewStudent; void isStaff;
