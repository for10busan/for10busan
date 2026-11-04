import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, post, notFound, bad, forbidden } from '../lib/router.js';
import { one, all, run, tx, J } from '../lib/db.js';
import { html, icon, pageTitle, empty, csrfField, chip } from '../lib/html.js';
import { num, fmtNum, isStaff, today, korDay, isValidDate, canSeeCutoff } from '../lib/util.js';
import { EXAMS, EXAM_SUBJECTS, convertRaw, examTable, englishGrade, historyGrade } from '../lib/admissions.js';
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
const cellOf = v => v == null ? '—' : typeof v === 'number' ? html`${v}<small class="muted">등급</small>` :
  html`<b>${v.grade ?? '—'}</b><small class="muted">등급</small>${v.sub ? html`<div class="small muted">${v.sub}</div>` : ''}${v.raw != null ? html`<div class="small">원점수 ${v.raw}</div>` : ''}${v.std != null ? html`<div class="small muted">표점 ${v.std} · 백분위 ${v.pct ?? '—'}</div>` : ''}`;
export function examsTab(ctx, s) {
  const self = ctx.user.id === s.id;
  const rows = all('SELECT * FROM mock_exams WHERE student_id=? ORDER BY date DESC', s.id);
  const yr = Number(today().slice(0, 4)) + (Number(today().slice(5, 7)) >= 3 ? 1 : 0);
  const sel = (name, opts) => html`<select name="${name}">${opts.map(o => html`<option>${o}</option>`)}</select>`;
  return html`${rows.length ? html`<div class="card"><h3>모의고사 성적</h3><div class="scroll-x"><table class="tbl"><tr><th>시험</th>${SUBJ.map(x => html`<th>${x}</th>`)}<th></th></tr>
    ${rows.map(r => { const sc = J(r.scores); return html`<tr><td><b>${r.name}</b><div class="small muted">${korDay(r.date)}</div></td>${SUBJ.map(x => html`<td>${cellOf(sc[x])}</td>`)}
      <td>${self ? html`<form method="post" action="/me/exams/${r.id}/delete" data-confirm="지울까요?">${csrfField(ctx)}<button class="btn xs gray">${icon('trash')}</button></form>` : ''}</td></tr>`; })}</table></div>
    <p class="help">원점수를 넣으면 본원이 등록한 등급컷으로 표준점수·백분위·등급을 계산해요. 등급컷이 아직 없으면 등급만 비워 둬요.</p></div>`
    : empty(self ? '아직 입력한 모의고사 성적이 없어요' : '학생이 아직 입력한 모의고사 성적이 없어요')}
  ${self ? html`<form method="post" action="/me/exams" class="card">${csrfField(ctx)}<h3>성적 입력 <small>원점수</small></h3>
    <div class="row3"><label class="field"><span>학년도</span><input type="number" name="year" value="${yr}" required></label><label class="field"><span>시험</span>${sel('exam', EXAMS)}</label><label class="field"><span>날짜</span><input type="date" name="date" value="${today()}" required></label></div>
    <div class="row2"><label class="field"><span>국어 선택</span>${sel('sub_국어', EXAM_SUBJECTS[0][1])}</label><label class="field"><span>국어 원점수</span><input type="number" name="raw_국어" min="0" max="100"></label></div>
    <div class="row2"><label class="field"><span>수학 선택</span>${sel('sub_수학', EXAM_SUBJECTS[1][1])}</label><label class="field"><span>수학 원점수</span><input type="number" name="raw_수학" min="0" max="100"></label></div>
    <div class="row2"><label class="field"><span>영어 원점수</span><input type="number" name="raw_영어" min="0" max="100"></label><label class="field"><span>한국사 원점수</span><input type="number" name="raw_한국사" min="0" max="50"></label></div>
    <div class="row2"><label class="field"><span>탐구1 과목</span>${sel('sub_탐구1', EXAM_SUBJECTS[2][1])}</label><label class="field"><span>탐구1 원점수</span><input type="number" name="raw_탐구1" min="0" max="50"></label></div>
    <div class="row2"><label class="field"><span>탐구2 과목</span>${sel('sub_탐구2', EXAM_SUBJECTS[2][1])}</label><label class="field"><span>탐구2 원점수</span><input type="number" name="raw_탐구2" min="0" max="50"></label></div>
    <button class="btn full">저장</button></form>` : ''}`;
}
post('/me/exams', 'student', ctx => {
  const b = ctx.body; if (!isValidDate(b.date) || !EXAMS.includes(b.exam)) bad('시험과 날짜를 확인해 주세요.');
  const year = Number(b.year) || Number(b.date.slice(0, 4));
  const sc = {};
  for (const x of SUBJ) {
    const raw = num(b['raw_' + x]); if (raw == null) continue;
    if (x === '영어') { sc[x] = { raw, grade: englishGrade(raw) }; continue; }
    if (x === '한국사') { sc[x] = { raw, grade: historyGrade(raw) }; continue; }
    const sub = b['sub_' + x] || null;
    const conv = sub ? convertRaw(examTable(year, b.exam, sub), raw) : null;
    sc[x] = { sub, raw, std: conv?.std ?? null, pct: conv?.pct ?? null, grade: conv?.grade ?? null };
  }
  if (!Object.keys(sc).length) bad('원점수를 한 과목 이상 입력해 주세요.');
  run('INSERT INTO mock_exams(student_id,date,name,scores) VALUES(?,?,?,?)', ctx.user.id, b.date, `${year}학년도 ${b.exam}${b.exam === '수능' ? '' : ' 모의고사'}`, JSON.stringify(sc));
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
  const see = canSeeCutoff(ctx.user);
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
    ${see && vd ? html`<div class="verdict ${vd[1]}">${vd[0]} <span class="small" style="font-weight:600">· ${vd[2]}</span></div>` : ''}
    <h3 class="mt12">합격선</h3>${!see ? html`<div class="note gray">${icon('info')}<span>합격선은 본원에서만 확인 가능합니다.</span></div>` : cut.length ? html`<table class="tbl"><tr><th>학년도</th><th>최초합</th><th>최종(예비)</th><th>경쟁률</th></tr>${cut.map(c => html`<tr><td>${c.year}</td><td>${fmtNum(c.cutoff)}</td><td>${c.final == null ? '—' : fmtNum(c.final)}</td><td>${c.competition == null ? '—' : c.competition + ':1'}</td></tr>`)}</table>
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
      <label class="field"><span>모집 단위 메모</span><input type="text" value="${u.admission || '수시'}" disabled></label></div>
    <div class="field"><span class="lbl">전형</span><div class="tg">${['수시', '정시'].map(a => html`<label><input type="radio" name="admission" value="${a}" ${(u.admission || '수시') === a ? 'checked' : ''}><span>${a}</span></label>`)}</div></div>
    <div class="field"><span class="lbl">실기 종목</span><div class="tg" data-order>${[...sel.map(i => exs.find(e => e.id === i)).filter(Boolean), ...exs.filter(e => !sel.includes(e.id))].map(e => html`<label><input type="checkbox" value="${e.id}" ${sel.includes(e.id) ? 'checked' : ''}><span>${e.name}</span></label>`)}</div>
      <input type="hidden" name="exercises" value="${JSON.stringify(sel)}"><small>고른 순서대로 표시됩니다.</small></div>
    <details ${u.id ? 'open' : ''}><summary class="b small" style="cursor:pointer;margin-bottom:10px">모집 정보 (K:컨설팅 학교 시트) ▼</summary>
    <div class="row3"><label class="field"><span>시·도</span><input type="text" name="region" value="${u.region || ''}" placeholder="부산"></label><label class="field"><span>시·군·구</span><input type="text" name="city" value="${u.city || ''}" placeholder="수영구"></label>
      <label class="field"><span>설립</span><select name="founding"><option value="">—</option>${['국립', '사립', '공립'].map(x => html`<option ${u.founding === x ? 'selected' : ''}>${x}</option>`)}</select></label></div>
    <div class="row3"><label class="field"><span>전형 유형</span><input type="text" name="track_type" value="${u.track_type || ''}" placeholder="실기위주"></label><label class="field"><span>모집인원</span><input type="number" name="quota" value="${u.quota ?? ''}"></label><label class="field"><span>단계 · 배수</span><input type="text" name="stage" value="${u.stage || ''}" placeholder="일괄"></label></div>
    <div class="row3"><label class="field"><span>내신 비율(%)</span><input type="number" step="any" name="school_ratio" value="${u.school_ratio ?? ''}"></label><label class="field"><span>실기 비율(%)</span><input type="number" step="any" name="practical_ratio" value="${u.practical_ratio ?? ''}"></label><label class="field"><span>수능 비율(%) · 정시</span><input type="number" step="any" name="suneung_ratio" value="${u.suneung_ratio ?? ''}"></label></div>
    <div class="row2"><label class="field"><span>수능최저</span><input type="text" name="suneung_min" value="${u.suneung_min || ''}" placeholder="예: 2합 7 · 한국사"></label><label class="field"><span>수능 만점 (정시)</span><input type="number" step="any" name="suneung_max" value="${u.suneung_max ?? ''}"></label></div>
    <div class="row2"><label class="field"><span>실기 날짜</span><input type="text" name="practical_date" value="${u.practical_date || ''}" placeholder="10.10(금)~13(월)"></label><label class="field"><span>면접 날짜</span><input type="text" name="interview_date" value="${u.interview_date || ''}" placeholder="X"></label></div>
    <div class="row2"><label class="field"><span>학년별 반영</span><input type="text" name="year_weights" value="${u.year_weights || ''}" placeholder="1학년 20 · 2학년 40 · 3학년 40"></label><label class="field"><span>반영 교과</span><input type="text" name="subjects" value="${u.subjects || ''}" placeholder="국어, 영어"></label></div>
    <div class="row2"><label class="field"><span>교과별 반영</span><input type="text" name="subject_weights" value="${u.subject_weights || ''}"></label><label class="field"><span>반영 과목</span><input type="text" name="subject_scope" value="${u.subject_scope || ''}"></label></div>
    <label class="check"><input type="checkbox" name="teacher_cert" ${u.teacher_cert ? 'checked' : ''}><span>교직이수 가능</span></label>
    <label class="field"><span>전년도 대비 변경 사항</span><textarea name="changes" rows="3">${u.changes || ''}</textarea></label></details>
    <label class="field"><span>메모 (선택)</span><textarea name="memo" rows="2">${u.memo || ''}</textarea></label>
    <button class="btn full">${u.id ? '저장' : '대학 추가'}</button></form>
    <script>(()=>{const box=document.currentScript.previousElementSibling.querySelector('[data-order]');const h=box.parentElement.querySelector('[name=exercises]');let o=JSON.parse(h.value||'[]');box.addEventListener('change',e=>{const v=+e.target.value;o=o.filter(x=>x!==v);if(e.target.checked)o.push(v);h.value=JSON.stringify(o)})})()</script>`;
}
const DETAIL = ['city', 'founding', 'track_type', 'quota', 'stage', 'school_ratio', 'practical_ratio', 'suneung_ratio', 'suneung_max', 'suneung_min', 'practical_date', 'interview_date', 'year_weights', 'subjects', 'subject_weights', 'subject_scope', 'changes'];
const NUMF = ['quota', 'school_ratio', 'practical_ratio', 'suneung_ratio', 'suneung_max'];
function readUni(b) {
  const name = (b.name || '').trim(); if (!name) bad('대학 이름을 입력해 주세요.');
  let ex = []; try { ex = JSON.parse(b.exercises || '[]').map(Number).filter(Boolean); } catch {}
  return [name, b.dept || null, b.track || null, b.region || null, b.admission === '정시' ? '정시' : '수시', JSON.stringify(ex), b.memo || null];
}
function saveDetail(id, b) {
  run(`UPDATE universities SET ${DETAIL.map(k => k + '=?').join(',')}, teacher_cert=? WHERE id=?`, ...DETAIL.map(k => NUMF.includes(k) ? num(b[k]) : ((b[k] || '').trim() || null)), b.teacher_cert ? 1 : 0, id);
}
get('/admin/universities', 'staff', ctx => {
  const ex = exMap(); const q = (ctx.query.q || '').trim();
  const rows = all(`SELECT u.*, (SELECT COUNT(*) FROM cutoffs c WHERE c.university_id=u.id) nc FROM universities u ${q ? 'WHERE name LIKE ? OR dept LIKE ?' : ''} ORDER BY name, dept`, ...(q ? [`%${q}%`, `%${q}%`] : []));
  const total = one('SELECT COUNT(*) c FROM universities').c;
  ctx.page('대학 관리', html`${pageTitle('대학 관리', '학생이 목표로 고를 대학과 대학별 실기 종목·환산표·배점을 관리합니다.')}
  <div class="note">${icon('info')}<span>대학 목록과 실기 종목은 예시로 넣어 두었어요. 내신 환산표·실기 배점표·합격선은 매년 모집요강을 보고 입력해 주세요.</span></div>
  <details class="card"><summary>대학 추가${icon('down')}</summary>${uniForm(ctx, {}, '/admin/universities')}</details>
  ${bundled().length ? html`<div class="card"><h3>준비된 모집요강 자료</h3><p class="small muted mt0">Claude가 원장님이 모아 주신 모집요강을 정리해 앱에 넣어 둔 자료예요. 누르면 학교 시트에 채워져요(여러 번 눌러도 같은 학과는 덮어써요).</p>
    ${bundled().map(f => html`<form method="post" action="/admin/universities/import-bundled" class="mb8" data-confirm="${f.replace(/\.json$/, '')} 자료를 불러올까요?">${csrfField(ctx)}<input type="hidden" name="file" value="${f}"><button class="btn full">${icon('upload')}${f.replace(/\.json$/, '')} 불러오기</button></form>`)}</div>` : ''}
  <details class="card"><summary>정리된 자료(JSON) 한 번에 넣기${icon('down')}</summary>
    <form method="post" action="/admin/universities/import-json">${csrfField(ctx)}<p class="small muted mt0">Claude가 모집요강을 정리해 준 자료를 붙여 넣는 칸이에요. 실기 종목과 배점표까지 함께 들어가요.</p>
    <textarea name="json" rows="5"></textarea><button class="btn full mt8">${icon('upload')}불러오기</button></form></details>
  <details class="card"><summary>엑셀에서 붙여 넣어 한 번에 채우기${icon('down')}</summary>
    <form method="post" action="/admin/universities/import">${csrfField(ctx)}
    <p class="small muted mt0">엑셀 첫 줄에 아래 제목 중 필요한 것만 넣고, 표를 통째로 복사해서 붙여 넣으세요. <b>대학</b>과 <b>학과</b>가 같은 줄은 내용을 고치고, 없으면 새로 만들어요.</p>
    <p class="small" style="background:#f6f7f9;border-radius:8px;padding:8px">대학 · 학과 · 전형구분(수시/정시) · 전형유형 · 전형명 · 시도 · 시군구 · 설립 · 모집인원 · 단계 · 내신비율 · 실기비율 · 수능비율 · 수능최저 · 내신만점 · 실기만점 · 실기날짜 · 면접날짜 · 교직 · 실기종목(쉼표로) · 학년별반영 · 반영교과 · 교과별반영 · 반영과목 · 변경사항 · 메모 · 최초합 · 최종합 · 학년도</p>
    <textarea name="paste" rows="6" placeholder="대학	학과	전형구분	전형명	시도	모집인원	내신비율	실기비율	실기종목	최초합	최종합	학년도"></textarea>
    <button class="btn full mt8">${icon('upload')}불러오기</button></form></details>
  <form class="flex mb8"><input type="search" name="q" value="${q}" placeholder="대학·학과 검색"><button class="btn sm dark" style="height:44px">${icon('search')}</button></form>
  <h2 class="sec">대학 목록 <small>(${q ? `${rows.length} / ` : ''}${total})</small></h2>
  <div class="list">${rows.map(u => html`<a href="/admin/universities/${u.id}"><div class="row-m"><b>${uniLabel(u)} <span class="muted small" style="display:inline">(${u.admission})</span></b>
    <span>${J(u.exercises, []).map(i => ex[i]?.name).filter(Boolean).join(' · ') || '실기 종목 미지정'}</span></div>
    <div class="row-r">${u.school_max ? chip('환산표', 'green') : ''}${u.nc ? chip(`합격선 ${u.nc}`, 'blue') : ''}${icon('right')}</div></a>`)}</div>`);
});
post('/admin/universities', 'staff', ctx => {
  const r = run('INSERT INTO universities(name,dept,track,region,admission,exercises,memo,is_sample) VALUES(?,?,?,?,?,?,?,0)', ...readUni(ctx.body));
  saveDetail(Number(r.lastInsertRowid), ctx.body);
  ctx.redirect(`/admin/universities/${r.lastInsertRowid}`, '대학을 추가했어요. 환산표와 배점을 입력해 주세요.');
});
post('/admin/universities/import', 'staff', ctx => {
  const lines = (ctx.body.paste || '').split(/\r?\n/).filter(l => l.trim()); if (lines.length < 2) bad('제목 줄과 내용 줄을 함께 붙여 넣어 주세요.');
  const H = { '대학': 'name', '학과': 'dept', '전형구분': 'admission', '전형유형': 'track_type', '전형명': 'track', '시도': 'region', '시군구': 'city', '설립': 'founding', '모집인원': 'quota', '단계': 'stage', '내신비율': 'school_ratio', '실기비율': 'practical_ratio', '수능비율': 'suneung_ratio', '수능최저': 'suneung_min', '내신만점': 'school_max', '실기만점': 'practical_max', '수능만점': 'suneung_max', '실기날짜': 'practical_date', '면접날짜': 'interview_date', '교직': 'teacher_cert', '실기종목': 'exercises', '최초합': 'cutoff', '최종합': 'final', '학년도': 'year', '학년별반영': 'year_weights', '반영교과': 'subjects', '교과별반영': 'subject_weights', '반영과목': 'subject_scope', '변경사항': 'changes', '메모': 'memo' };
  const head = lines[0].split('\t').map(h => H[h.trim().replace(/\s/g, '')] || null);
  if (!head.includes('name')) bad('첫 줄에 "대학" 제목이 있어야 해요.');
  const exs = all('SELECT id,name FROM exercises'); const findEx = n => { const k = n.replace(/\s/g, ''); return exs.find(e => e.name.replace(/\s/g, '') === k || k.includes(e.name.replace(/\s/g, '')) || e.name.replace(/\s/g, '').includes(k))?.id; };
  let made = 0, upd = 0;
  tx(() => { for (const line of lines.slice(1)) {
    const c = line.split('\t'); const o = {}; head.forEach((k, i) => { if (k) o[k] = (c[i] || '').trim(); }); if (!o.name) continue;
    const adm = o.admission === '정시' ? '정시' : '수시';
    let u = one('SELECT * FROM universities WHERE name=? AND IFNULL(dept,\'\')=? AND admission=? AND IFNULL(track,\'\')=IFNULL(?,\'\')', o.name, o.dept || '', adm, o.track || null);
    if (!u && o.track) { u = one('SELECT * FROM universities WHERE name=? AND IFNULL(dept,\'\')=? AND admission=? AND track IS NULL', o.name, o.dept || '', adm); if (u) run('UPDATE universities SET track=? WHERE id=?', o.track, u.id); }
    if (!u) { u = { id: Number(run('INSERT INTO universities(name,dept,admission,track,is_sample) VALUES(?,?,?,?,0)', o.name, o.dept || null, adm, o.track || null).lastInsertRowid) }; made++; } else upd++;
    const set = []; const vals = [];
    for (const k of ['track_type', 'region', 'city', 'founding', 'stage', 'suneung_min', 'practical_date', 'interview_date', 'year_weights', 'subjects', 'subject_weights', 'subject_scope', 'changes', 'memo']) if (o[k] && o[k] !== '-') { set.push(k + '=?'); vals.push(o[k]); }
    for (const k of ['quota', 'school_ratio', 'practical_ratio', 'suneung_ratio', 'school_max', 'practical_max', 'suneung_max']) if (num(o[k]) != null) { set.push(k + '=?'); vals.push(num(o[k])); }
    if (o.teacher_cert) { set.push('teacher_cert=?'); vals.push(/^(o|y|1|교직|예|가능)/i.test(o.teacher_cert) ? 1 : 0); }
    if (o.exercises && o.exercises !== '-') { const ids = o.exercises.split(/[,·/]/).map(x => findEx(x.trim())).filter(Boolean); if (ids.length) { set.push('exercises=?'); vals.push(JSON.stringify(ids)); } }
    if (set.length) run(`UPDATE universities SET ${set.join(',')} WHERE id=?`, ...vals, u.id);
    if (num(o.cutoff) != null) run('INSERT INTO cutoffs(university_id,year,cutoff,final) VALUES(?,?,?,?) ON CONFLICT(university_id,year) DO UPDATE SET cutoff=excluded.cutoff, final=excluded.final', u.id, Number(o.year) || Number(today().slice(0, 4)) + 1, num(o.cutoff), num(o.final));
  } });
  ctx.redirect('/admin/universities', `${made}곳을 새로 만들고 ${upd}곳을 고쳤어요.`);
});
// JSON으로 한 번에 넣기: 모집단위 정보 + 실기 종목 + 배점표 (정시 자료 정리용)
post('/admin/universities/import-json', 'staff', ctx => {
  let list; try { list = JSON.parse(ctx.body.json || '[]'); } catch { bad('JSON 형식이 맞지 않아요.'); }
  const [made, upd] = importPrograms(list);
  ctx.redirect('/admin/universities', `${made}곳을 새로 만들고 ${upd}곳을 고쳤어요.`);
});
// 앱에 함께 들어 있는 정리 자료(scripts/data/*.json) 불러오기
const DATA_DIR_BUNDLED = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'data');
const bundled = () => { try { return fs.readdirSync(DATA_DIR_BUNDLED).filter(f => f.endsWith('.json')).sort(); } catch { return []; } };
post('/admin/universities/import-bundled', 'staff', ctx => {
  const f = bundled().find(x => x === ctx.body.file) || bad('자료를 찾을 수 없어요.');
  const [made, upd] = importPrograms(JSON.parse(fs.readFileSync(path.join(DATA_DIR_BUNDLED, f), 'utf8')));
  ctx.redirect('/admin/universities', `${f.replace(/\.json$/, '')}: ${made}곳을 새로 만들고 ${upd}곳을 고쳤어요.`);
});
function importPrograms(list) {
  if (!Array.isArray(list)) list = [list];
  const norm = x => String(x || '').replace(/[\s()·\-]/g, '').replace(/m왕복/, 'm왕복');
  const exs = () => all('SELECT id,name,unit,higher_better FROM exercises');
  const findOrMakeEx = e => {
    const k = norm(e.name); const hit = exs().find(x => norm(x.name) === k);
    if (hit) return hit.id;
    return Number(run('INSERT INTO exercises(name,unit,higher_better,kind,is_sample,sort) VALUES(?,?,?,\'record\',0,99)', e.name, e.unit || '', e.hb === 0 ? 0 : 1).lastInsertRowid);
  };
  const TXT = ['track_type', 'region', 'city', 'founding', 'stage', 'suneung_min', 'practical_date', 'interview_date', 'year_weights', 'subjects', 'subject_weights', 'subject_scope', 'changes', 'memo'];
  const NUM = ['quota', 'school_ratio', 'practical_ratio', 'suneung_ratio', 'school_max', 'practical_max', 'suneung_max', 'step_points'];
  let made = 0, upd = 0;
  tx(() => { for (const o of list) {
    if (!o || !o.name) continue;
    const adm = o.admission === '정시' ? '정시' : '수시';
    // 학교 통합 등으로 이름이 바뀐 경우: 예전 이름의 같은 학과(모든 전형)를 새 이름으로 옮김
    if (Array.isArray(o.rename_from) && o.rename_from[0]) run('UPDATE universities SET name=?, dept=? WHERE name=? AND IFNULL(dept,\'\')=?', o.name, o.dept || null, o.rename_from[0], o.rename_from[1] || '');
    let u = one('SELECT id FROM universities WHERE name=? AND IFNULL(dept,\'\')=? AND admission=? AND IFNULL(track,\'\')=?', o.name, o.dept || '', adm, o.track || '');
    if (!u) { u = { id: Number(run('INSERT INTO universities(name,dept,admission,track,is_sample) VALUES(?,?,?,?,0)', o.name, o.dept || null, adm, o.track || null).lastInsertRowid) }; made++; } else upd++;
    const set = [], vals = [];
    for (const k of TXT) if (o[k] != null && o[k] !== '') { set.push(k + '=?'); vals.push(String(o[k])); }
    for (const k of NUM) if (o[k] != null && o[k] !== '' && Number.isFinite(Number(o[k]))) { set.push(k + '=?'); vals.push(Number(o[k])); }
    if (o.teacher_cert != null) { set.push('teacher_cert=?'); vals.push(o.teacher_cert ? 1 : 0); }
    if (Array.isArray(o.exercises) && o.exercises.length) {
      const ids = [], sc = {}, notes = {};
      for (const e of o.exercises) { const id = findOrMakeEx(e); ids.push(id); if (e.M || e.F) sc[id] = { M: e.M || [], F: e.F || e.M || [] }; if (e.notes) notes[id] = [].concat(e.notes); }
      set.push('exercises=?', 'scoring=?'); vals.push(JSON.stringify(ids), JSON.stringify(sc));
      if (Object.keys(notes).length) { set.push('field_notes=?'); vals.push(JSON.stringify(notes)); }
    }
    if (set.length) run(`UPDATE universities SET ${set.join(',')} WHERE id=?`, ...vals, u.id);
  } });
  return [made, upd];
}
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
    <label class="field"><span>실기 한 급간 점수 (선택)</span><input type="number" step="any" name="step_points" value="${u.step_points ?? ''}"><small>비워 두면 배점표에서 자동으로 계산해요. K:컨설팅의 "감"(여유 ÷ 급간)에 쓰여요.</small></label>
    ${ids.length ? html`<details class="mb8"><summary class="b small" style="cursor:pointer">작년 배점표 (비교용) ▼</summary><label class="field mt8"><span>작년 학년도</span><input type="number" name="prev_year" value="${u.prev_year ?? ''}"></label>
      ${ids.map(i => html`<div class="row2">${['M', 'F'].map(g => html`<label class="field"><span>${ex[i]?.name} · ${g === 'M' ? '남' : '여'} (작년)</span><textarea name="p_${i}_${g}" rows="3">${tableText((J(u.prev_scoring)[i] || {})[g])}</textarea></label>`)}</div>`)}</details>
    <h3 class="mt12">실기장 유의사항</h3><p class="small muted mt0">종목마다 한 줄에 하나씩 적어요. 학교 시트 맨 아래에 보여요.</p>
    ${ids.map(i => html`<label class="field"><span>${ex[i]?.name}</span><textarea name="n_${i}" rows="3" placeholder="센서기 측정\n2회 측정">${(J(u.field_notes)[i] || []).join('\n')}</textarea></label>`)}` : ''}
    <label class="check"><input type="checkbox" name="is_sample" ${u.is_sample ? 'checked' : ''}><span>예시 값 (학생 화면에 "예시 값"으로 안내)</span></label>
    <button class="btn full">환산표·배점 저장</button></form>
  <a class="btn ghost full mb8" href="/admin/consulting/program/${u.id}">${icon('eye')}K:컨설팅 학교 시트로 보기</a>
  <form method="post" action="/admin/universities/${u.id}/delete" data-confirm="이 대학을 삭제할까요? 목표 대학·합격선도 함께 삭제돼요.">${csrfField(ctx)}<button class="btn danger full">${icon('trash')}대학 삭제</button></form>`);
});
post('/admin/universities/:id', 'staff', ctx => { run('UPDATE universities SET name=?,dept=?,track=?,region=?,admission=?,exercises=?,memo=? WHERE id=?', ...readUni(ctx.body), ctx.params.id); saveDetail(ctx.params.id, ctx.body); ctx.redirect(`/admin/universities/${ctx.params.id}`, '저장했어요.'); });
post('/admin/universities/:id/scores', 'staff', ctx => {
  const u = one('SELECT * FROM universities WHERE id=?', ctx.params.id) || notFound(); const b = ctx.body;
  const gt = { 5: parseTable(b.g5), 9: parseTable(b.g9) }; const sc = {};
  for (const i of J(u.exercises, [])) sc[i] = { M: parseTable(b[`s_${i}_M`]), F: parseTable(b[`s_${i}_F`]) };
  const prev = {}, notes = {};
  for (const i of J(u.exercises, [])) { prev[i] = { M: parseTable(b[`p_${i}_M`]), F: parseTable(b[`p_${i}_F`]) }; notes[i] = (b[`n_${i}`] || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean); }
  run('UPDATE universities SET school_max=?, grade_table=?, practical_max=?, scoring=?, is_sample=?, step_points=?, prev_scoring=?, prev_year=?, field_notes=? WHERE id=?', num(b.school_max), JSON.stringify(gt), num(b.practical_max), JSON.stringify(sc), b.is_sample ? 1 : 0, num(b.step_points), JSON.stringify(prev), num(b.prev_year), JSON.stringify(notes), u.id);
  ctx.redirect(`/admin/universities/${u.id}`, '환산표·배점을 저장했어요.');
});
post('/admin/universities/:id/delete', 'staff', ctx => { run('DELETE FROM universities WHERE id=?', ctx.params.id); ctx.redirect('/admin/universities', '삭제했어요.'); });

void forbidden; void canViewStudent; void isStaff;
