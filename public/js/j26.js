// K:컨설팅 → 2026 정시: 수능 성적을 넣으면 학교마다 엑셀과 같은 수식으로 환산 점수·여유·판정이 바로 나옴
import { makeBook, isError } from './xl.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// 실기 종목: 길면 글자 수가 비슷하게 두 줄로 나눔
const exLines = (a) => { const t = a.join(' · '); if (a.length < 2 || t.length <= 18) return t; let k = 1, best = 1e9; for (let i = 1; i < a.length; i++) { const d = Math.abs(a.slice(0, i).join(' · ').length - a.slice(i).join(' · ').length); if (d < best) { best = d; k = i; } } return `<span class="exl">${a.slice(0, k).join(' · ')}</span><span class="exl">${a.slice(k).join(' · ')}</span>`; };
const n = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const f = (v, d = 2) => { const x = n(v); if (x == null) return '—'; return String(Math.round(x * 10 ** d) / 10 ** d); };
const dash = v => (v == null || v === '' || v === 'ㅡ' ? '—' : esc(v));
const parts = l => l.filter(([, v]) => typeof v === 'number' ? v > 0 : v && v !== 'ㅡ').map(([k, v]) => `${k} ${typeof v === 'number' ? f(v * 100, 1) + '%' : v}`).join(' · ') || '—';
const pct = v => (typeof v === 'number' ? (v ? f(v * 100, 1) : '·') : v && v !== 'ㅡ' ? esc(v) : '·');

const PCTS = [100, 97, 95, 93, 90, 88, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30];
const KOR = ['화작', '언매'], MATH = ['확통', '미적분', '기하'];
const TAM = ['생윤', '윤사', '한지', '세지', '동아사', '세계사', '법정', '경제', '사문', '물리1', '화학1', '생과1', '지학1', '물리2', '화학2', '생과2', '지학2'];
const LANG2 = ['독일어', '프랑스어', '스페인어', '중국어', '일본어', '러시아어', '아랍어', '베트남어', '한문'];
// 성적 입력 칸 (엑셀 수능성적기입 열)
const SUBJ = [
  { k: '국어', sel: ['G', KOR], raw: 'H', out: [['I', '등급'], ['J', '백분위'], ['K', '표준점수']] },
  { k: '수학', sel: ['L', MATH], raw: 'M', out: [['N', '등급'], ['O', '백분위'], ['P', '표준점수']] },
  { k: '영어', raw: 'R', out: [['S', '등급']] },
  { k: '탐구1', sel: ['V', TAM], raw: 'W', out: [['X', '등급'], ['Y', '백분위'], ['Z', '표준점수']] },
  { k: '탐구2', sel: ['AA', TAM], raw: 'AB', out: [['AC', '등급'], ['AD', '백분위'], ['AE', '표준점수']] },
  { k: '한국사', raw: 'AK', out: [['AL', '등급']] },
  { k: '제2외/한문', sel: ['AF', LANG2], raw: 'AG', out: [['AH', '등급'], ['AI', '백분위'], ['AJ', '표준점수']], opt: true },
];
const REGION = [['서울', ['서울']], ['수도권', ['경기', '인천', '수원']], ['강원/제주', ['강원', '제주']], ['대전/충청', ['대전', '세종', '충북', '충남']], ['대구/경북', ['대구', '경북']], ['부산/경남', ['부산', '울산', '경남']], ['광주/전라', ['광주', '전북', '전남']]];
const regionOf = r => { const s = String(r || '').trim(); for (const [g, l] of REGION) if (l.some(x => s.startsWith(x))) return g; return '기타'; };
const gunOf = p => (String(p.gun || '').match(/([가나다])/) || [])[1] || '';
const EXS = [[/윗몸|싯업|sit/i, '싯업'], [/제자리\s*멀리/, '제멀'], [/메디신/, '메디신'], [/지그재그|Z-?런/i, '지그재그'], [/서전트/, '서전트'], [/높이뛰기/, '높뛰'], [/배근력/, '배근력'], [/좌전굴|체전굴|앞으로\s*굽/, '좌전굴'], [/농구/, '농구'], [/배구/, '배구'], [/핸드볼/, '핸드볼'], [/축구/, '축구']];
const exShort = s => { s = String(s); for (const [re, v] of EXS) if (re.test(s)) return v; const m = s.match(/(\d+)\s*m/i); if (m) return m[1] + 'm' + (/왕복/.test(s) ? '왕복' : ''); return s; };

export function start(root, init) {
  const S = { see: !!init.see, csrf: init.csrf, sid: init.s || null, sname: init.sname || '', inp: {}, rec: {}, filt: { gun: '', reg: '', edu: false, q: '', sort: '' }, open: null, data: null, book: null, dirty: false };
  if (init.saved) { S.inp = init.saved.inp || {}; S.rec = init.saved.rec || {}; }
  if (!S.inp.D) S.inp.D = init.gender === 'F' ? '여' : '남'; // 성별이 비면 엑셀 실기 배점 칸이 빈칸이 됨
  root.innerHTML = '<div class="card"><p class="small muted mb0">2026 정시 계산 자료를 불러오는 중…</p></div>';
  fetch('/admin/j26/data.json', { credentials: 'same-origin' }).then(r => (r.ok ? r.json() : Promise.reject(r.status))).then(d => {
    S.data = d;
    const dyn = { [d.vs.sheet]: { row: d.vs.row, forms: d.vs.forms } };
    for (const [s, x] of Object.entries(d.sheets)) dyn[s] = { row: x.row, forms: x.forms };
    S.book = makeBook({ consts: d.consts, dyn, vs: { sheet: d.vs.sheet, row: d.vs.row } });
    S.byId = new Map(d.programs.map(p => [String(p.id), p]));
    render(); applyInputs(); drawTable();
  }).catch(e => { root.innerHTML = `<div class="card"><p class="small red mb0">2026 정시 자료를 불러오지 못했어요 (${esc(e)}). 새로고침해 주세요.</p></div>`; });

  const VS = () => S.data.vs.sheet; const VR = () => S.data.vs.row;
  const cell = (sheet, col) => { const row = sheet === VS() ? VR() : S.data.sheets[sheet].row; const v = S.book.cell(sheet, col + row); return isError(v) ? null : v; };
  const hasScore = () => ['H', 'I', 'J', 'K', 'M', 'N', 'O', 'P', 'W', 'X', 'Y', 'Z'].some(k => S.inp[k] != null && S.inp[k] !== '');
  function applyInputs() {
    S.book.set(VS(), { C: '학생', ...S.inp });
    for (const [s, r] of Object.entries(S.rec)) if (S.data.sheets[s]) S.book.set(s, r);
  }

  // ---------- 화면 ----------
  function render() {
    const d = S.data;
    root.innerHTML = `
    <div class="card j26-score">
      <div class="j26-pct"><b>예상 점수 표본</b>${PCTS.map(v => `<a class="pill" data-pct="${v}">백${v}</a>`).join('')}</div>
      <div class="flex between wrapf mb8"><b>${S.sid ? esc(S.sname) + ' · ' : ''}2026 수능 성적</b>
        <div class="flex wrapf">
          <label class="j26-inl">등급 표본 <select data-sample><option value="">고르기</option>${d.samples.filter(s => !/^백/.test(s.name)).map(s => `<option>${esc(s.name)}</option>`).join('')}</select></label>
          <label class="j26-inl">성별 <select data-k="D"><option>남</option><option>여</option></select></label>
          <button type="button" class="btn sm ghost" data-clear>비우기</button>
          ${S.sid ? '<button type="button" class="btn sm" data-save>저장</button>' : ''}
        </div></div>
      <div class="j26-grid">${SUBJ.map(sj => `<div class="j26-sub${sj.opt ? ' opt' : ''}"><b>${sj.k}</b>
        ${sj.sel ? `<select data-k="${sj.sel[0]}"><option value="">과목</option>${sj.sel[1].map(o => `<option>${o}</option>`).join('')}</select>` : ''}
        <label>원점수<input type="number" step="any" inputmode="decimal" data-k="${sj.raw}"></label>
        ${sj.out.map(([c, l]) => `<label>${l}<input type="number" step="any" inputmode="decimal" data-k="${c}" data-out></label>`).join('')}</div>`).join('')}
        <div class="j26-sub"><b>내신</b><label>교과 등급<input type="number" step="any" data-k="AM"></label><label>비교과<select data-k="AN"><option value="">—</option><option>상</option><option>중</option><option>하</option></select></label></div>
      </div>
      <p class="help mb0">원점수를 넣으면 2026학년도 수능 기준으로 등급·백분위·표준점수가 자동으로 채워져요(회색 글자). 성적표 값을 직접 넣으면 그 값으로 계산해요. 영어·한국사는 원점수로 등급을 정해요.${S.sid ? '' : ' 학생을 고르면 입력값을 저장할 수 있어요.'}</p>
    </div>
    <div class="jfil">
      <div class="pills mb0" data-f="gun">${[['', '전체 군'], ['가', '가군'], ['나', '나군'], ['다', '다군']].map(([v, l]) => `<a class="pill ${v ? 'gp g' + v : ''}" data-v="${v}">${l} <small></small></a>`).join('')}</div>
      <div class="pills mb0" data-f="reg">${[['', '전체 지역'], ...REGION.map(([g]) => [g, g])].map(([v, l]) => `<a class="pill" data-v="${v}">${l}</a>`).join('')}</div>
    </div>
    <div class="jfil"><div class="pills dark mb0" data-f="edu"><a class="pill" data-v="">전체 학과</a><a class="pill" data-v="1">체육교육</a></div>
      <input type="search" placeholder="대학·학과 검색" data-q style="max-width:260px;height:38px">
      <select data-sort style="width:auto;height:38px"><option value="">기본 순서 (군 → 엑셀 순)</option>${S.see ? '<option value="m">여유 많은 순</option>' : ''}<option value="g">수능 환산 높은 순</option></select></div>
    <p class="small muted mt8" data-count></p>
    <div class="jt-wrap"><table class="jt j26t${S.see ? '' : ' nocut'}"><thead><tr><th rowspan="2">군</th><th rowspan="2">지역</th><th rowspan="2" class="l">대학 · 학과</th><th rowspan="2">모집</th><th colspan="3">비율</th><th rowspan="2">지표</th><th rowspan="2">수능 환산</th><th rowspan="2">내신</th><th rowspan="2">실기만점<br>총점</th>
      ${S.see ? '<th colspan="2">커트라인</th><th rowspan="2">여유<br><small>점수</small></th><th rowspan="2">판정</th><th rowspan="2">여유감점<br><small>실기 몇 감</small></th><th colspan="3">2026 커트라인</th>' : ''}<th rowspan="2">실기 종목</th></tr>
      <tr class="sub"><th>수능</th><th>내신</th><th>실기</th>${S.see ? '<th>최종</th><th>최저</th><th>부산</th><th>협회</th><th>타학원</th>' : ''}</tr></thead><tbody></tbody></table></div>`;
    // 값 채우기
    root.querySelectorAll('[data-k]').forEach(el => { const v = S.inp[el.dataset.k]; if (v != null) el.value = v; });
    root.addEventListener('input', onInput); root.addEventListener('change', onInput);
    root.addEventListener('click', onClick);
    syncFilters();
  }
  let tmr = null;
  function onInput(e) {
    const el = e.target;
    if (el.matches('[data-sample]')) { const smp = S.data.samples.find(s => s.name === el.value); if (smp) useSample({ ...smp.inp }, null); return; }
    if (el.matches('[data-q]')) { S.filt.q = el.value.trim(); drawTable(); return; }
    if (el.matches('[data-sort]')) { S.filt.sort = el.value; drawTable(); return; }
    if (el.matches('[data-rec]')) { const s = el.dataset.sheet; S.rec[s] = { ...(S.rec[s] || {}) }; if (el.value === '') delete S.rec[s][el.dataset.rec]; else S.rec[s][el.dataset.rec] = +el.value; S.book.set(s, { [el.dataset.rec]: el.value === '' ? '' : +el.value }); S.dirty = true; updateDetail(); return; }
    if (!el.matches('.j26-score [data-k]')) return;
    const k = el.dataset.k; const v = el.value;
    if (k !== 'D') root.querySelectorAll('[data-pct].on').forEach(a => a.classList.remove('on'));
    if (v === '') delete S.inp[k]; else S.inp[k] = el.type === 'number' ? +v : v;
    S.dirty = true;
    clearTimeout(tmr); tmr = setTimeout(recalc, 120);
  }
  function useSample(inp, pctOn) {
    S.inp = { ...inp, D: S.inp.D || inp.D || '남' };
    root.querySelectorAll('.j26-score [data-k]').forEach(x => { x.value = S.inp[x.dataset.k] ?? ''; });
    root.querySelectorAll('[data-pct]').forEach(a => a.classList.toggle('on', String(pctOn) === a.dataset.pct));
    if (pctOn != null) $('[data-sample]', root).value = '';
    S.dirty = true; recalc();
  }
  // 백분위 표본: 엑셀 표본(백93 등)이 있으면 그대로, 없으면 2026 변환표에서 그 백분위가 되는 원점수를 찾음
  function pctSample(v) {
    if (v >= 100) { const m = S.data.samples.find(x => x.name === '만점자'); if (m) return { ...m.inp }; }
    const ex = S.data.samples.find(x => x.name === '백' + v); if (ex) return { ...ex.inp };
    const T = (sheet, c1, c2, r1, r2) => { const t = S.data.consts[sheet] || {}; const rows = []; for (let r = r1; r <= r2; r++) { const raw = t[c1 + r], pc = t[c2 + r]; if (typeof raw === 'number' && typeof pc === 'number') rows.push([raw, pc]); } return rows; };
    const pick = rows => { let best = null; for (const [raw, pc] of rows) if (pc >= v && (best == null || raw < best)) best = raw; return best ?? (rows.length ? Math.max(...rows.map(r => r[0])) : null); };
    const grade = v >= 96 ? 1 : v >= 89 ? 2 : v >= 77 ? 3 : v >= 60 ? 4 : v >= 40 ? 5 : v >= 23 ? 6 : v >= 11 ? 7 : v >= 4 ? 8 : 9;
    return { G: '화작', H: pick(T('국어,수학(수능)', 'C', 'D', 7, 107)), L: '확통', M: pick(T('국어,수학(수능)', 'O', 'P', 7, 107)), R: 100 - grade * 10,
      V: '생윤', W: pick(T('탐구(수능)', 'C', 'D', 7, 57)), AA: '사문', AB: pick(T('탐구(수능)', 'AY', 'AZ', 7, 57)), AK: 50, AM: 5, AN: '상' };
  }
  function recalc() {
    S.book.clearInputs(VS()); S.book.set(VS(), { C: '학생', ...S.inp });
    // 자동으로 계산된 칸은 회색 안내 글자로
    root.querySelectorAll('.j26-score [data-out]').forEach(el => { const k = el.dataset.k; if (S.inp[k] == null) { const v = cell(VS(), k); el.placeholder = v == null || v === '' || v === 0 ? '' : f(v); } else el.placeholder = ''; });
    drawTable();
  }
  function onClick(e) {
    const p = e.target.closest('[data-f] .pill');
    if (p) { const g = p.parentElement.dataset.f; S.filt[g] = g === 'edu' ? p.dataset.v === '1' : p.dataset.v; syncFilters(); drawTable(); return; }
    const pc = e.target.closest('[data-pct]'); if (pc) { useSample(pctSample(+pc.dataset.pct), pc.dataset.pct); return; }
    if (e.target.closest('[data-clear]')) { S.inp = { D: S.inp.D || '남' }; root.querySelectorAll('.j26-score [data-k]').forEach(x => { x.value = S.inp[x.dataset.k] ?? ''; }); $('[data-sample]', root).value = ''; root.querySelectorAll('[data-pct]').forEach(a => a.classList.remove('on')); S.dirty = true; recalc(); return; }
    if (e.target.closest('[data-save]')) { save(e.target.closest('[data-save]')); return; }
    if (e.target.closest('tr.jx')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) { if (e.target.closest('a') && (e.metaKey || e.ctrlKey)) return; e.preventDefault(); S.open = S.open === tr.dataset.id ? null : tr.dataset.id; drawTable(); if (S.open) { const t = $('tr[data-id="' + S.open + '"]', root); const top = t.getBoundingClientRect().top; if (top > innerHeight * 0.6 || top < 0) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }
  }
  async function save(btn) {
    btn.disabled = true; const old = btn.textContent; btn.textContent = '저장 중…';
    try { const r = await fetch('/admin/j26/score', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-csrf': S.csrf }, body: JSON.stringify({ s: S.sid, inp: S.inp, rec: S.rec }) }); if (!r.ok) throw 0; S.dirty = false; btn.textContent = '저장했어요'; setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1200); }
    catch (_) { btn.textContent = old; btn.disabled = false; alert('저장하지 못했어요. 새로고침 후 다시 해 주세요.'); }
  }
  addEventListener('beforeunload', e => { if (S.dirty && S.sid) { e.preventDefault(); e.returnValue = ''; } });
  function syncFilters() {
    root.querySelectorAll('[data-f]').forEach(box => { const g = box.dataset.f; box.querySelectorAll('.pill').forEach(p => p.classList.toggle('on', g === 'edu' ? (p.dataset.v === '1') === S.filt.edu : p.dataset.v === S.filt[g])); });
  }

  // ---------- 표 ----------
  function rowCalc(p) {
    const s = p.sheet; const G = cell(s, 'G'), H = cell(s, 'H'), Z = cell(s, 'Z'), X = cell(s, 'X');
    const ok = hasScore();
    const mg = ok && n(Z) != null && n(p.cut) != null ? Z - p.cut : null;
    const verdict = !ok || n(Z) == null || n(p.cut) == null ? null : Z >= p.cut ? ['적정', 'blue'] : n(p.cut_low) != null && Z >= p.cut_low ? ['소신', 'amber'] : ['위험', 'red'];
    return { G: ok ? G : null, H: ok ? H : null, Z: ok ? Z : null, X: ok && mg != null ? X : null, mg, verdict };
  }
  function drawTable() {
    const d = S.data; const F = S.filt;
    const base = d.programs.filter(p => (!F.reg || regionOf(p.region) === F.reg) && (!F.edu || /체육교육/.test(p.dept || '') && !/특수/.test(p.dept || '')) && (!F.q || `${p.name} ${p.dept} ${p.region}`.replace(/\s/g, '').includes(F.q.replace(/\s/g, ''))));
    const cnt = { '': base.length }; for (const p of base) { const g = gunOf(p); if (g) cnt[g] = (cnt[g] || 0) + 1; }
    root.querySelectorAll('[data-f="gun"] .pill').forEach(a => { a.querySelector('small').textContent = cnt[a.dataset.v] || 0; });
    let rows = base.filter(p => !F.gun || gunOf(p) === F.gun).map(p => ({ p, c: rowCalc(p) }));
    const gi = p => { const i = '가나다'.indexOf(gunOf(p)); return i < 0 ? 9 : i; };
    rows.sort((a, b) => gi(a.p) - gi(b.p));
    if (F.sort === 'm') rows.sort((a, b) => (b.c.mg ?? -1e9) - (a.c.mg ?? -1e9));
    if (F.sort === 'g') rows.sort((a, b) => (n(b.c.G) ?? -1e9) - (n(a.c.G) ?? -1e9));
    $('[data-count]', root).textContent = `${rows.length}곳 · 줄을 누르면 바로 아래에 실기 기록 입력과 학교 정보가 열려요 · 실기만점 총점 = 수능 환산 + 내신 + 실기 만점${S.see ? ', 여유 = 실기만점 총점 − 커트라인(최종), 여유감점 = 그 여유를 실기 배점표 한 칸 점수로 나눈 값(실기에서 몇 감까지 괜찮은지)' : ''}`;
    // 여유감점: 엑셀 여유감점 칸 = (실기만점 총점 − 최종 커트) ÷ 실기 배점표 한 칸 점수 → 실기에서 몇 감까지 여유가 있는지
    const gam = (v, m) => (n(v) == null ? '—' : `<b class="${(m ?? v) >= 0 ? 'green' : 'red'}">${v >= 0 ? '+' : ''}${f(v, 1)}감</b>`); // 색은 여유 점수와 같게
    const vchip = v => (v ? `<span class="chip ${v[1]}">${v[0]}</span>` : '—');
    const mgc = v => (v == null ? '—' : `<b class="${v >= 0 ? 'green' : 'red'}">${v >= 0 ? '+' : ''}${f(v, 2)}</b>`);
    const tb = $('.j26t tbody', root);
    tb.innerHTML = rows.map(({ p, c }) => {
      const g = gunOf(p); const evn = (d.sheets[p.sheet]?.events || []).map(e => e.name); const ex = (evn.length ? evn : (p.events || [])).map(exShort);
      const tr = `<tr data-id="${esc(p.id)}" class="${g ? 'g' + g : ''}${S.open === String(p.id) ? ' on' : ''}"><td class="gun" data-a="gun">${g ? g + '군' : '—'}</td><td class="reg" data-a="reg" data-l="지역">${esc(String(p.region || '').split('\n')[0])}<span>${esc(String(p.region || '').split('\n')[1] || '')}</span></td>
        <td class="l nm" data-a="nm"><a href="#">${esc(p.name)} <b>${esc(p.dept)}</b></a>${p.cert === '교직' ? ' <span class="tag">교직</span>' : ''}${p.on_home ? '' : ' <span class="tag gray">요강</span>'}</td>
        <td class="small" data-a="q" data-l="모집">${esc(String(p.quota ?? '—')).replace(/\n/g, '<br>')}</td><td data-a="rs" data-l="수능 %">${pct(p.r_sun)}</td><td data-a="rn" data-l="내신 %">${pct(p.r_school)}</td><td data-a="rp" data-l="실기 %">${pct(p.r_prac)}</td><td class="small" data-a="idx" data-l="지표">${dash(p.idx_ks)}</td>
        <td data-a="cg" data-l="수능 환산"><b>${f(c.G)}</b></td><td data-a="ch" data-l="내신">${c.H ? f(c.H) : c.G != null ? (typeof p.r_school === 'number' && p.r_school > 0 ? '<span class="need">필요</span>' : 'X') : '—'}</td><td class="tot" data-a="tot" data-l="총점">${f(c.Z)}</td>
        ${S.see ? `<td data-a="ct" data-l="커트 최종"><b>${f(p.cut, 1)}</b></td><td data-a="cl" data-l="커트 최저">${f(p.cut_low, 1)}</td><td data-a="mg" data-l="여유">${mgc(c.mg)}</td><td data-a="vd">${vchip(c.verdict)}</td><td class="gam" data-a="gam" data-l="여유감점">${gam(c.X, c.mg)}</td><td data-a="cb" data-l="26 부산">${f(p.cut_busan, 1)}</td><td data-a="ca" data-l="26 협회">${f(p.cut_assoc, 1)}</td><td data-a="co" data-l="26 타학원">${f(p.cut_other, 1)}</td>` : ''}
        <td class="exs" data-a="exs">${exLines(ex.map(esc))}</td></tr>`;
      return S.open === String(p.id) ? tr + `<tr class="jx ${g ? 'g' + g : ''}"><td colspan="${S.see ? 20 : 12}"><div class="jx-in" data-detail></div></td></tr>` : tr;
    }).join('') || `<tr><td colspan="20" class="muted" style="padding:20px">조건에 맞는 학과가 없어요</td></tr>`;
    if (S.open) drawDetail();
  }

  // ---------- 펼친 학교 ----------
  // 처음 열 때만 전체를 그리고, 실기 기록을 칠 때는 숫자·색만 바꿈 (입력 칸이 그대로 있어야 계속 칠 수 있음)
  function drawDetail() {
    const box = $('[data-detail]', root); if (!box) return;
    const p = S.byId.get(S.open); const sh = S.data.sheets[p.sheet]; const s = p.sheet;
    const male = (S.inp.D || '남') !== '여';
    const recs = S.rec[s] || {};
    const info = [['전형', `${p.track || ''} · ${p.stage || ''}`], ['모집인원', p.quota], ['반영 비율', parts([['수능', p.r_sun], ['내신', p.r_school], ['실기', p.r_prac], ['면접', p.r_itv], ['적/인성', p.r_apt]])],
      ['수능 반영', `${p.idx_ks || ''}${p.idx_tam && p.idx_tam !== 'ㅡ' ? ' (탐구 ' + p.idx_tam + ')' : ''} · ` + parts([['국어', p.kor_w], [`수학${p.math_sel && p.math_sel !== 'ㅡ' ? '(' + p.math_sel + ')' : ''}`, p.math_w], ['영어', p.eng_w], [`탐구(${p.tam_n || '—'}과목${p.tam_sel && p.tam_sel !== 'ㅡ' ? ', ' + p.tam_sel : ''})`, p.tam_w]])],
      ['수능 반영 과목', p.subjects], ['가산점', [p.kor_bonus, p.math_bonus].filter(x => x && x !== 'ㅡ').join(' / ')], ['영어 등급별', `${p.eng_how || ''} ${(p.eng_pts || []).map((v, i) => `${i + 1}등급 ${v ?? '—'}`).join(' · ')}`],
      ['한국사 등급별', `${p.hist || ''} ${p.hist_how || ''} ${(p.hist_pts || []).map((v, i) => `${i + 1}:${v ?? '—'}`).join(' · ')}`], ['내신 반영', p.school_subjects],
      ['원서접수', p.d_apply], ['실기고사', p.d_prac], ['면접', p.d_itv], ['최종 발표', p.d_final], ['전년도 경쟁률', p.c_quota ? `${p.c_quota}명 모집 · ${p.c_app ?? '—'}명 지원 · ${f(p.c_rate, 2)} : 1` : null],
      ['입시 변경사항', p.changes], ...(S.see ? [['커트 비고', p.cut_note]] : [])].filter(([, v]) => v != null && v !== '' && v !== 'ㅡ' && v !== '-');
    const evs = sh.events || [];
    const tbl = sh.table || [];
    box.innerHTML = `<div class="jx-hd"><b>${esc(p.name)} ${esc(p.dept)}</b><span class="small muted">${esc(p.gun || '')} · ${esc(String(p.region || '').replace(/\n/g, ' '))} · ${esc(p.founding || '')}</span><button type="button" class="btn xs ghost" data-x>닫기</button></div>
      <div class="uc-sec"><div class="uc-st">총점 계산 <span class="small muted">(${male ? '남' : '여'} 기준 · 실기 기록을 넣으면 바로 계산)</span></div>
        <div class="uc-grid j26-box">
          <div class="uc-box"><small>수능 환산</small><b data-o="G">—</b></div>
          <div class="uc-box"><small>내신</small><b data-o="H">—</b></div>
          <div class="uc-box uc-prac"><small>실기 <b data-o="I">0</b> / ${f(typeof p.p_prac === 'number' && p.p_prac ? p.p_prac : n(cell(s, 'Z')) != null ? cell(s, 'Z') - (n(cell(s, 'G')) || 0) - (n(cell(s, 'H')) || 0) : null)}</small>
            ${evs.length ? `<div class="uc-ex">${evs.map(e => `<label><span>${esc(e.name)}</span><input type="number" step="any" inputmode="decimal" data-rec="${e.rec}" data-sheet="${esc(s)}" value="${recs[e.rec] ?? ''}" placeholder="기록"><em data-pt="${e.pts}"></em></label>`).join('')}</div>` : '<p class="small muted mb0">실기 없음</p>'}</div>
          <div class="uc-box uc-tot" data-o="totbox"><span class="j26-vd" data-o="vd"></span><small>총점</small><b data-o="tot">—</b><em data-o="mg"></em></div>
        </div>
        <p class="help mb0" data-o="note"></p></div>
      ${tbl.length ? `<div class="uc-sec"><div class="uc-st">실기 배점표 (2026학년도)</div><div class="scroll-x"><table class="uc-tbl j26-tbl"><tr>${tbl.map(t => `<th colspan="3">${esc(t.name)}</th>`).join('')}</tr>
        <tr class="sub">${tbl.map(() => '<td>배점</td><td>남</td><td>여</td>').join('')}</tr>
        ${Array.from({ length: Math.max(...tbl.map(t => t.rows.length)) }, (_, i) => `<tr>${tbl.map((t, ti) => { const r = t.rows[i]; return r ? `<td data-t="${ti}-${i}" data-c="p">${f(r[0])}</td><td data-t="${ti}-${i}" data-c="m">${typeof r[1] === 'number' ? f(r[1]) : esc(r[1] ?? '')}</td><td data-t="${ti}-${i}" data-c="f">${typeof r[2] === 'number' ? f(r[2]) : esc(r[2] ?? '')}</td>` : '<td></td><td></td><td></td>'; }).join('')}</tr>`).join('')}</table></div>
        <p class="help mb0">초록색 줄이 입력한 기록이 받은 점수예요.</p></div>` : ''}
      <div class="uc-sec"><div class="uc-st">입시 정보 (2026학년도)</div><div class="uc-info">${info.map(([k, v]) => `<div class="${String(v).length > 28 ? 'w' : ''}"><small>${k}</small><div>${esc(v).replace(/\n/g, '<br>')}</div></div>`).join('')}</div></div>`;
    $('[data-x]', box).onclick = () => { S.open = null; drawTable(); };
    updateDetail();
  }
  function updateDetail() {
    const box = $('[data-detail]', root); if (!box) return;
    const p = S.byId.get(S.open); const sh = S.data.sheets[p.sheet]; const s = p.sheet;
    const O = k => $(`[data-o="${k}"]`, box);
    const ok = hasScore();
    const G = ok ? n(cell(s, 'G')) : null, H = ok ? n(cell(s, 'H')) : null, I = n(cell(s, 'I')) || 0;
    O('G').textContent = f(G); O('H').textContent = ok ? f(H) : '—'; O('I').textContent = f(I);
    const anyRec = Object.keys(S.rec[s] || {}).length > 0;
    const tot = ok ? (G || 0) + (H || 0) + I : anyRec ? I : null;
    O('tot').textContent = f(tot);
    const mg = O('mg');
    // 총점으로 판정: 최종 커트 이상 적정 · 최저 커트 이상 소신 · 그 아래 위험
    const vbox = O('totbox'); const vd = O('vd'); vbox.classList.remove('v-ok', 'v-mid', 'v-risk'); vd.textContent = '';
    if (S.see && ok && n(p.cut) != null && tot != null) {
      const m = tot - p.cut; mg.className = m >= 0 ? 'green' : 'red'; mg.textContent = `최종 커트 ${f(p.cut, 2)} 대비 ${m >= 0 ? '+' : ''}${f(m, 2)}${n(p.cut_low) != null ? ` · 최저 ${f(p.cut_low, 2)}` : ''}`;
      const v = tot >= p.cut ? ['적정', 'v-ok'] : n(p.cut_low) != null && tot >= p.cut_low ? ['소신', 'v-mid'] : ['위험', 'v-risk'];
      vbox.classList.add(v[1]); vd.textContent = v[0];
    }
    else { mg.className = ''; mg.textContent = ok ? '' : '수능 성적을 넣으면 수능 환산과 합쳐져요'; }
    O('note').textContent = ok ? `실기만점 총점 ${f(cell(s, 'Z'))} = 수능 환산 + 내신 + 실기 만점.${S.sid ? ' 실기 기록도 위 「저장」을 누르면 함께 저장돼요.' : ''}` : '수능 성적(또는 표본)을 넣으면 수능 환산 점수도 계산돼요.';
    // 종목별 배점 + 배점표 표시
    box.querySelectorAll('.j26-tbl td.hit').forEach(td => td.classList.remove('hit'));
    const evs = sh.events || []; const tbl = sh.table || [];
    evs.forEach((e, i) => {
      const pt = cell(s, e.pts); const em = $(`[data-pt="${e.pts}"]`, box);
      const has = (S.rec[s] || {})[e.rec] != null;
      if (em) em.textContent = has && pt !== '' && pt != null ? f(pt) + '점' : '';
      if (!has || n(pt) == null) return;
      // 같은 순서의 배점표(이름이 비슷하면 그쪽)에서 그 점수 줄을 찾아 칠함
      let ti = tbl.findIndex(t => String(t.name).replace(/\s/g, '') === String(e.name).replace(/\s/g, ''));
      if (ti < 0) ti = i < tbl.length ? i : -1;
      if (ti < 0) return;
      const ri = tbl[ti].rows.findIndex(r => typeof r[0] === 'number' && Math.abs(r[0] - pt) < 1e-6);
      const sc = (S.inp.D || '남') === '여' ? 'f' : 'm';
      if (ri >= 0) box.querySelectorAll(`.j26-tbl td[data-t="${ti}-${ri}"]`).forEach(td => { if (td.dataset.c === 'p' || td.dataset.c === sc) td.classList.add('hit'); });
    });
  }
}
