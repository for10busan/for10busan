import { get } from '../lib/router.js';
import { one, all } from '../lib/db.js';
import { html, icon, stat, pageTitle, empty, pills } from '../lib/html.js';
import { today, addDays, korDay, korDateTime, ATT_LABEL } from '../lib/util.js';
import { sessionsOn, rate } from '../lib/services.js';

function attendanceToday(t) {
  const ses = sessionsOn(t);
  const ids = ses.filter(s => !s.canceled).map(s => s.id);
  const counts = { present: 0, late: 0, absent: 0, excused: 0 };
  let total = 0;
  for (const s of ses) if (!s.canceled) total += s.n_students;
  if (ids.length) for (const r of all(`SELECT status, COUNT(*) c FROM attendance WHERE session_id IN (${ids.map(() => '?').join(',')}) GROUP BY status`, ...ids)) counts[r.status] = r.c;
  const checked = counts.present + counts.late + counts.absent + counts.excused;
  return { ses, counts, unchecked: Math.max(0, total - checked) };
}

export function longAbsent(days = 30, streak = 3, minRate = 70) {
  const from = addDays(today(), -days); const t = today();
  const students = all(`SELECT id,name FROM users WHERE role='student' AND status='approved'`);
  const out = [];
  for (const s of students) {
    const rows = all(`SELECT a.status, ses.canceled FROM attendance a JOIN class_sessions ses ON ses.id=a.session_id
      WHERE a.student_id=? AND ses.date BETWEEN ? AND ? ORDER BY ses.date DESC`, s.id, from, t);
    let st = 0; for (const r of rows) { if (r.canceled) continue; if (r.status === 'absent') st++; else break; }
    const valid = rows.filter(r => !r.canceled);
    const p = valid.filter(r => r.status === 'present').length, l = valid.filter(r => r.status === 'late').length;
    const rt = valid.length >= 3 ? rate(p, l, valid.length) : null;
    if (st >= streak || (rt != null && rt < minRate)) out.push({ ...s, streak: st, rate: rt });
  }
  return out;
}

get('/admin', 'staff', ctx => {
  const u = ctx.user; const t = today();
  const { ses, counts, unchecked } = attendanceToday(t);
  const ym = t.slice(0, 7);
  const m = one(`SELECT SUM(a.status='present') p, SUM(a.status='late') l, COUNT(*) n FROM attendance a JOIN class_sessions s ON s.id=a.session_id WHERE substr(s.date,1,7)=? AND s.canceled=0`, ym);
  const monthRate = rate(m.p || 0, m.l || 0, m.n || 0);
  const la = longAbsent().length;
  const staffN = one(`SELECT COUNT(*) c FROM users WHERE role IN ('owner','vice','coach') AND status='approved'`).c;
  const sa = one(`SELECT SUM(status='present') p, SUM(status='absent') a FROM staff_attendance WHERE date=?`, t);
  const from = addDays(t, -6);
  const studentsN = one(`SELECT COUNT(*) c FROM users WHERE role='student' AND status='approved'`).c;
  const active = one(`SELECT COUNT(DISTINCT sid) c FROM (SELECT student_id sid FROM logs WHERE date>=? UNION SELECT student_id FROM videos WHERE date(created_at,'+9 hours')>=?)`, from, from).c;
  const logsN = one(`SELECT COUNT(*) c FROM logs WHERE date>=?`, from).c;
  const vidN = one(`SELECT COUNT(*) c FROM videos WHERE date(created_at,'+9 hours')>=?`, from).c;
  const comN = one(`SELECT COUNT(*) c FROM comments WHERE date(created_at,'+9 hours')>=?`, from).c;
  const linked = one(`SELECT COUNT(DISTINCT student_id) c FROM parent_links WHERE status='approved'`).c;
  const pend = one(`SELECT COUNT(*) c FROM users WHERE status='pending'`).c;
  const pendL = one(`SELECT COUNT(*) c FROM parent_links WHERE status='pending'`).c;
  const toReview = one(`SELECT COUNT(*) c FROM videos WHERE status='done' AND reviewed_at IS NULL`).c;
  const title = { owner: '원장님', vice: '부원장님', coach: '선생님' }[u.role];

  const vNo = one(`SELECT COUNT(*) c FROM videos WHERE date(created_at,'+9 hours')>=? AND reviewed_at IS NULL`, from).c;
  const vYes = one(`SELECT COUNT(*) c FROM videos WHERE date(created_at,'+9 hours')>=? AND reviewed_at IS NOT NULL`, from).c;
  const lNo = one(`SELECT COUNT(*) c FROM logs WHERE date>=? AND reviewed_at IS NULL`, from).c;
  const lYes = one(`SELECT COUNT(*) c FROM logs WHERE date>=? AND reviewed_at IS NOT NULL`, from).c;
  const [yy, mm, dd] = t.split('-');
  const wd = '일월화수목금토'[new Date(t + 'T00:00:00Z').getUTCDay()];
  const tiles = [['UNIVERSITY', '대학검색', '/admin/student-predict'], ['TODAY CLASS', '오늘 수업', '/coach'], ['STUDENTS', '학생', '/students'],
    ['TEST RECORD', '실기 기록 입력', '/ranking/entry'], ['GRADE CUT', '등급컷', '/admin/exams'], ['CALENDAR', '캘린더', '/calendar']];

  ctx.page('홈', html`
  <div class="khero"><div><small>FOR10 STAFF</small><b>${u.name} ${title}</b></div><div class="kdate"><b>${Number(mm)}.${Number(dd)}</b><span>${yy} · ${wd}요일</span></div></div>
  ${pend || pendL ? html`<div class="note amber">${icon('usercheck')}<span>승인 대기 — <a href="/admin/approvals"><u>가입 ${pend}건</u></a> · <a href="/admin/links"><u>학부모 연결 ${pendL}건</u></a></span></div>` : ''}
  <div class="ktiles">${tiles.map(([en, ko, h], i) => html`<a href="${h}"><span class="kn">${String(i + 1).padStart(2, '0')}</span><small>${en}</small><b>${ko}</b>${icon('right')}</a>`)}</div>
  <h2 class="sec">오늘 출결 <a class="small" href="/admin/stats">출결 통계 · CSV ${icon('right')}</a></h2>
  <div class="grid">
    ${stat('출석·지각', `${counts.present + counts.late}명`, `지각 ${counts.late}`, '/admin/today?s=present')}
    ${stat('결석', `${counts.absent}명`, `공결 ${counts.excused} · 미체크 ${unchecked}`, '/admin/today?s=absent')}
    ${stat('이번 달 출석률', monthRate == null ? '-' : `${monthRate}%`, '', '/admin/stats')}
    ${stat('장기 결석자', `${la}명`, '최근 30일', '/admin/stats#long-absent', la ? 'red' : '')}
  </div>
  <h2 class="sec">영상 · 일지 확인 <small>최근 7일</small></h2>
  <div class="grid">
    ${stat('영상 미확인', `${vNo}개`, '', '/admin/activity?t=videos&c=no', vNo ? 'warn' : '')}
    ${stat('영상 확인', `${vYes}개`, '', '/admin/activity?t=videos&c=yes')}
    ${stat('일지 미확인', `${lNo}개`, '', '/admin/activity?t=logs&c=no', lNo ? 'warn' : '')}
    ${stat('일지 확인', `${lYes}개`, '', '/admin/activity?t=logs&c=yes')}
  </div>
  <h2 class="sec">최근 7일 이용</h2>
  <div class="grid">
    ${stat('활동한 학생', `${active}/${studentsN}명`, '일지·영상 기준', '/admin/activity?t=students')}
    ${stat('일지', `${logsN}개`, '', '/admin/activity?t=logs')}
    ${stat('영상 · 코멘트', `${vidN} · ${comN}`, '', '/admin/activity?t=videos')}
    ${stat('학부모 연결 학생', `${linked}/${studentsN}명`, '', '/admin/activity?t=linked')}
  </div>
  <div class="grid c3">
    ${stat('직원 출근', `${sa.p || 0}/${staffN}명`, '눌러서 내 출근 남기기', '/admin/staff-attendance')}
    ${stat('K:컨설팅', '지원', '학생별 지원·결과', '/admin/consulting/students')}
    ${stat('반 관리', '반', '시간표·학생', '/admin/classes')}
  </div>
  <h2 class="sec">오늘 수업 · ${korDay(t)}</h2>
  ${ses.length ? html`<div class="list">${ses.map(s => {
    const un = s.canceled ? 0 : Math.max(0, s.n_students - s.n_checked);
    return html`<a href="/sessions/${s.id}"><div class="row-m"><b>${s.class_name}</b><span>${s.start_time ? `${s.start_time}${s.end_time ? '~' + s.end_time : ''} · ` : ''}학생 ${s.n_students}명${s.kind === 'makeup' ? ' · 보강' : ''}</span></div>
      <div class="row-r">${s.canceled ? html`<span class="chip">휴강</span>` : un ? html`<span class="chip amber">미체크 ${un}명</span>` : html`<span class="chip green">체크 완료</span>`}${icon('right')}</div></a>`;
  })}</div>` : empty('오늘은 수업이 없습니다', '반 관리에서 수업 요일을 정하면 일정이 자동으로 만들어져요.')}
  `);
});

get('/admin/today', 'staff', ctx => {
  const t = today(); const s = ctx.query.s === 'absent' ? 'absent' : 'present';
  const rows = all(`SELECT a.status, a.memo, u.id, u.name, c.name class_name FROM attendance a JOIN class_sessions ses ON ses.id=a.session_id
    JOIN classes c ON c.id=ses.class_id JOIN users u ON u.id=a.student_id WHERE ses.date=? AND a.status IN (${s === 'present' ? "'present','late'" : "'absent','excused'"}) ORDER BY u.name`, t);
  ctx.page('오늘 출결', html`${pageTitle(s === 'present' ? '오늘 출석·지각' : '오늘 결석·공결', korDay(t), ['홈', '/admin'])}
  ${pills([['출석·지각', '/admin/today?s=present', 'present'], ['결석·공결', '/admin/today?s=absent', 'absent']], s)}
  ${rows.length ? html`<div class="list">${rows.map(r => html`<a href="/students/${r.id}"><div class="row-m"><b>${r.name}</b><span>${r.class_name}${r.memo ? ' · ' + r.memo : ''}</span></div>
    <div class="row-r"><span class="chip ${{ present: 'green', late: 'amber', absent: 'red', excused: 'blue' }[r.status]}">${ATT_LABEL[r.status]}</span>${icon('right')}</div></a>`)}</div>` : empty('해당하는 학생이 없어요')}`);
});

get('/admin/activity', 'staff', ctx => {
  const t = today(); const from = addDays(t, -6);
  const tab = ['students', 'logs', 'videos', 'comments', 'linked'].includes(ctx.query.t) ? ctx.query.t : 'students';
  const cf = ['no', 'yes'].includes(ctx.query.c) ? ctx.query.c : '';
  const cw = cf === 'no' ? ' AND reviewed_at IS NULL' : cf === 'yes' ? ' AND reviewed_at IS NOT NULL' : '';
  const stu = all(`SELECT u.id,u.name,(SELECT COUNT(*) FROM logs l WHERE l.student_id=u.id AND l.date>=?) nl,
    (SELECT COUNT(*) FROM videos v WHERE v.student_id=u.id AND date(v.created_at,'+9 hours')>=?) nv FROM users u WHERE role='student' AND status='approved' ORDER BY name`, from, from).filter(r => r.nl || r.nv);
  const logs = all(`SELECT l.*, u.name FROM logs l JOIN users u ON u.id=l.student_id WHERE l.date>=?${cw.replace(/reviewed_at/g, 'l.reviewed_at')} ORDER BY l.date DESC, l.id DESC`, from);
  const vids = all(`SELECT v.*, u.name, e.name ex FROM videos v JOIN users u ON u.id=v.student_id JOIN exercises e ON e.id=v.exercise_id WHERE date(v.created_at,'+9 hours')>=?${cw.replace(/reviewed_at/g, 'v.reviewed_at')} ORDER BY v.id DESC`, from);
  const coms = all(`SELECT c.*, u.name author FROM comments c LEFT JOIN users u ON u.id=c.author_id WHERE date(c.created_at,'+9 hours')>=? ORDER BY c.id DESC`, from);
  const linked = all(`SELECT DISTINCT u.id, u.name, p.name parent FROM parent_links pl JOIN users u ON u.id=pl.student_id JOIN users p ON p.id=pl.parent_id WHERE pl.status='approved' ORDER BY u.name`);
  const tabs = [[`활동한 학생 ${stu.length}`, '?t=students', 'students'], [`일지 ${logs.length}`, '?t=logs', 'logs'], [`영상 ${vids.length}`, '?t=videos', 'videos'], [`코멘트 ${coms.length}`, '?t=comments', 'comments'], [`학부모 연결 ${linked.length}`, '?t=linked', 'linked']];
  let list;
  if (tab === 'students') list = stu.map(r => html`<a href="/students/${r.id}"><div class="row-m"><b>${r.name}</b></div><div class="row-r">일지 ${r.nl} · 영상 ${r.nv}${icon('right')}</div></a>`);
  if (tab === 'logs') list = logs.map(r => html`<a href="/logs/${r.id}"><div class="row-m"><b>${r.name}</b><span>${korDay(r.date)}</span></div><div class="row-r">${r.reviewed_at ? html`<span class="chip green">확인</span>` : html`<span class="chip amber">미확인</span>`}${icon('right')}</div></a>`);
  if (tab === 'videos') list = vids.map(r => html`<a href="/videos/${r.id}"><div class="row-m"><b>${r.name} · ${r.ex}</b><span>${korDateTime(r.created_at)}</span></div><div class="row-r">${r.reviewed_at ? html`<span class="chip green">강사 확인</span>` : ''}${icon('right')}</div></a>`);
  if (tab === 'comments') list = coms.map(r => html`<a href="/${r.target_type === 'log' ? 'logs' : 'videos'}/${r.target_id}"><div class="row-m"><b>${r.author || '알 수 없음'}</b><span>${r.body}</span></div><div class="row-r">${icon('right')}</div></a>`);
  if (tab === 'linked') list = linked.map(r => html`<a href="/students/${r.id}"><div class="row-m"><b>${r.name}</b><span>학부모 ${r.parent}</span></div><div class="row-r">${icon('right')}</div></a>`);
  ctx.page('이용 현황', html`${pageTitle('이용 현황 · 최근 7일', '누가 무엇을 했는지 확인해요.', ['홈', '/admin'])}
  ${pills(tabs, tab)}
  ${['logs', 'videos'].includes(tab) ? pills([['전체', `?t=${tab}`, ''], ['미확인', `?t=${tab}&c=no`, 'no'], ['확인', `?t=${tab}&c=yes`, 'yes']], cf) : ''}
  ${list.length ? html`<div class="list">${list}</div>` : empty('기록이 없어요')}`);
});

get('/coach', 'staff', ctx => {
  const t = today(); const u = ctx.user;
  const mine = ctx.query.all ? null : u.id;
  let ses = sessionsOn(t, mine);
  const showingAll = !mine || !ses.length && !ctx.query.mine;
  if (!ses.length && mine) ses = sessionsOn(t);
  const ids = ses.filter(s => !s.canceled).map(s => s.class_id);
  const unchecked = ses.filter(s => !s.canceled).reduce((a, s) => a + Math.max(0, s.n_students - s.n_checked), 0);
  const vids = all(`SELECT v.*, u.name, e.name ex FROM videos v JOIN users u ON u.id=v.student_id JOIN exercises e ON e.id=v.exercise_id WHERE v.status='done' AND v.reviewed_at IS NULL ORDER BY v.id DESC LIMIT 30`);
  const nolog = ids.length ? all(`SELECT DISTINCT u.id,u.name FROM class_students cs JOIN users u ON u.id=cs.user_id WHERE cs.class_id IN (${ids.map(() => '?').join(',')}) AND u.id NOT IN (SELECT student_id FROM logs WHERE date=?) ORDER BY u.name`, ...ids, t) : [];
  ctx.page('오늘 수업', html`${pageTitle('오늘 수업', `${korDay(t)} · ${u.name} ${u.role === 'coach' ? '강사님' : u.role === 'vice' ? '부원장님' : '원장님'}`)}
  <div class="grid c3">
    ${stat(html`${icon('doc')} 미체크 출결`, `${unchecked}명`, '', '#unchecked')}
    ${stat(html`${icon('video')} 확인 대기 영상`, `${vids.length}개`, '', '#videos')}
    ${stat(html`${icon('pen')} 일지 미작성`, `${nolog.length}명`, '', '#nolog')}
  </div>
  <h2 class="sec" id="unchecked">수업 ${showingAll && mine ? html`<small>담당 반이 없어 전체 반을 보여요</small>` : ''}</h2>
  ${ses.length ? html`<div class="list">${ses.map(s => html`<a href="/sessions/${s.id}"><div class="row-m"><b>${s.class_name}</b><span>${s.start_time || ''} 학생 ${s.n_students}명</span></div>
    <div class="row-r">${s.canceled ? html`<span class="chip">휴강</span>` : s.n_students - s.n_checked > 0 ? html`<span class="chip amber">미체크 ${s.n_students - s.n_checked}명</span>` : html`<span class="chip green">완료</span>`}${icon('right')}</div></a>`)}</div>`
    : empty('오늘은 수업이 없습니다', '예정된 수업이 없습니다.')}
  <div class="card" id="videos"><h3>확인 대기 영상</h3>
  ${vids.length ? html`<div class="list mb0">${vids.map(v => html`<a href="/videos/${v.id}"><div class="row-m"><b>${v.name} · ${v.ex}</b><span>${korDateTime(v.created_at)}${v.record != null ? ` · 기록 ${v.record}` : ''}</span></div><div class="row-r">${icon('right')}</div></a>`)}</div>` : empty('확인할 영상이 없습니다')}</div>
  <div class="card" id="nolog"><h3>오늘 일지를 안 쓴 학생</h3>
  ${nolog.length ? html`<div class="chips">${nolog.map(s => html`<a class="chip" href="/students/${s.id}">${s.name}</a>`)}</div>` : empty('오늘 수업 학생이 모두 일지를 썼거나, 오늘 수업이 없습니다')}</div>`);
});
