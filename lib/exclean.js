// 시작할 때 한 번: 실기 종목 이름 정리·합치기·빼기 (이미 정리돼 있으면 아무것도 안 함)
import { all, one, run, tx, J } from './db.js';
import { EX_MERGE, EX_DROP } from './admissions.js';

const key = s => String(s || '').replace(/\s/g, '').toLowerCase();
const refTables = () => all("SELECT name FROM sqlite_master WHERE type='table'").map(t => t.name)
  .filter(t => t !== 'exercises' && all(`PRAGMA table_info(${t})`).some(c => c.name === 'exercise_id'));

function remapUni(fromId, toId) {
  for (const u of all('SELECT id, exercises, scoring, prev_scoring, field_notes FROM universities')) {
    const ids = J(u.exercises, []); if (!ids.includes(fromId)) continue;
    const nids = [...new Set(ids.map(i => (i === fromId ? toId : i)).filter(i => i != null))];
    const fix = o => { o = { ...o }; if (fromId in o) { if (toId != null && !(toId in o)) o[toId] = o[fromId]; delete o[fromId]; } return o; };
    run('UPDATE universities SET exercises=?, scoring=?, prev_scoring=?, field_notes=? WHERE id=?', JSON.stringify(nids), JSON.stringify(fix(J(u.scoring))), JSON.stringify(fix(J(u.prev_scoring))), JSON.stringify(fix(J(u.field_notes))), u.id);
  }
  for (const a of all('SELECT id, records FROM applications')) {
    const r = J(a.records); if (!(fromId in r)) continue;
    if (toId != null && r[toId] == null) r[toId] = r[fromId]; delete r[fromId];
    run('UPDATE applications SET records=? WHERE id=?', JSON.stringify(r), a.id);
  }
}
export function cleanExercises() {
  const exs = () => all('SELECT id, name FROM exercises');
  const find = n => exs().find(e => key(e.name) === key(n));
  const changed = [];
  tx(() => {
    for (const [from, to] of Object.entries(EX_MERGE)) {
      const a = find(from); if (!a) continue;
      const b = find(to);
      if (!b) { run('UPDATE exercises SET name=? WHERE id=?', to, a.id); changed.push(`${from} → ${to}`); continue; }
      if (a.id === b.id) continue;
      remapUni(a.id, b.id);
      for (const t of refTables()) { run(`UPDATE OR IGNORE ${t} SET exercise_id=? WHERE exercise_id=?`, b.id, a.id); }
      run('DELETE FROM exercises WHERE id=?', a.id); changed.push(`${from} ⇒ ${to}`);
    }
    for (const d of EX_DROP) {
      const a = find(d); if (!a) continue;
      remapUni(a.id, null); run('DELETE FROM exercises WHERE id=?', a.id); changed.push(`${d} 삭제`);
    }
  });
  // 한국해양대 해양스포츠과학과: 실기는 60m 달리기 + 제자리멀리뛰기 (스캔 인식 오류로 600m로 들어갔던 것 바로잡기)
  tx(() => {
    let e60 = find('60m 달리기');
    if (!e60) e60 = { id: Number(run("INSERT INTO exercises(name,unit,higher_better,kind,is_sample,sort) VALUES('60m 달리기','초',0,'record',0,99)").lastInsertRowid) };
    for (const u of all("SELECT id, exercises, field_notes, memo FROM universities WHERE name='한국해양대학교' AND dept LIKE '%해양스포츠%'")) {
      const ids = J(u.exercises, []); const memo = (u.memo || '').replace(/600m 달리기/g, '60m 달리기');
      if (!ids.includes(e60.id)) { ids.unshift(e60.id); const fn = J(u.field_notes); fn[e60.id] = ['200점', '악천후 시 대체 종목']; run('UPDATE universities SET exercises=?, field_notes=? WHERE id=?', JSON.stringify(ids), JSON.stringify(fn), u.id); changed.push('한국해양대 60m 달리기 복구'); }
      if (memo !== (u.memo || '')) run('UPDATE universities SET memo=? WHERE id=?', memo, u.id);
    }
  });
  // 학교별로 종목을 바로잡음: 부산대는 좌전굴, 성결대는 체전굴
  const swap = (uni, deptLike, fromName, toName) => {
    const a = find(fromName), b = find(toName); if (!a || !b) return;
    for (const u of all('SELECT id, name FROM universities WHERE name=? AND dept LIKE ?', uni, deptLike)) {
      if (!J(one('SELECT exercises FROM universities WHERE id=?', u.id).exercises, []).includes(a.id)) continue;
      remapUni1(u.id, a.id, b.id); changed.push(`${uni} ${fromName} → ${toName}`);
    }
  };
  tx(() => { swap('부산대학교', '%스포츠과학%', '체전굴', '좌전굴'); swap('성결대학교', '%체육교육%', '좌전굴', '체전굴'); });
  // 월별 실기 테스트에서 뺄 종목 (대학 배점표에는 그대로 남음)
  for (const n of ['배면뛰기']) { const e = find(n); if (e && one('SELECT active FROM exercises WHERE id=?', e.id).active) { run('UPDATE exercises SET active=0 WHERE id=?', e.id); changed.push(`${n} 실기 테스트에서 숨김`); } }
  if (changed.length) console.log('종목 정리:', changed.join(', '));
}
function remapUni1(uid, fromId, toId) {
  const u = one('SELECT exercises, scoring, prev_scoring, field_notes FROM universities WHERE id=?', uid);
  const ids = [...new Set(J(u.exercises, []).map(i => (i === fromId ? toId : i)))];
  const fix = o => { o = { ...o }; if (fromId in o) { if (!(toId in o)) o[toId] = o[fromId]; delete o[fromId]; } return o; };
  run('UPDATE universities SET exercises=?, scoring=?, prev_scoring=?, field_notes=? WHERE id=?', JSON.stringify(ids), JSON.stringify(fix(J(u.scoring))), JSON.stringify(fix(J(u.prev_scoring))), JSON.stringify(fix(J(u.field_notes))), uid);
}
