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
  if (changed.length) console.log('종목 정리:', changed.join(', '));
}
