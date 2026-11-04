// 학교 시트: 학생별 실기 기록 → 점수·총점·여유 계산 (저장하지 않음)
(() => {
  const D = window.CMP; if (!D) return;
  const tb = document.querySelector('#cmp tbody');
  const f1 = v => (v == null || !isFinite(v) ? '—' : String(Math.round(v * 10) / 10));
  const score = (id, g, rec) => {
    const t = (D.scoring[id] || {})[g] || []; if (rec == null || rec === '' || !t.length) return null;
    const hb = D.ex[id].hb; let best = 0; for (const [th, p] of t) if (hb ? rec >= th : rec <= th) best = Math.max(best, p); return best;
  };
  const maxOf = (id, g) => { const t = (D.scoring[id] || {})[g] || []; return t.length ? Math.max(...t.map(r => r[1])) : null; };
  const margin = (tot, cut) => { if (cut == null || tot == null) return '—'; const m = tot - cut; const g = D.step ? ` · ${f1(m / D.step)}감` : ''; return `<b style="color:${m >= 0 ? '#16a34a' : '#c81018'}">${m >= 0 ? '+' : ''}${f1(m)}</b><span style="color:#7a808a">${g}</span>`; };
  const row = (r, sample) => {
    const tr = document.createElement('tr'); tr.dataset.g = r.gender || 'M';
    const cells = D.ids.map(id => sample ? `<td>만점 · <b>${f1(maxOf(id, 'M'))}</b></td>` : `<td><input type="number" step="any" data-id="${id}" value="${r.rec[id] ?? ''}" style="width:70px;height:32px"> <b data-s="${id}">—</b></td>`).join('');
    tr.innerHTML = `<td>${sample ? `표본 ${r.t}등급` : `<b>${r.name}</b>`}</td><td>${f1(r.school)}</td><td>${sample ? '—' : `<select data-g style="width:62px;height:32px;padding:0 6px"><option value="M"${r.gender === 'M' ? ' selected' : ''}>남</option><option value="F"${r.gender === 'F' ? ' selected' : ''}>여</option></select>`}</td>${cells}<td data-p>—</td><td data-t>—</td>${D.cut ? '<td data-m1>—</td><td data-m2>—</td>' : ''}<td>${sample ? '' : '<button type="button" class="btn xs gray" data-x>빼기</button>'}</td>`;
    const calc = () => {
      const g = sample ? 'M' : tr.querySelector('[data-g]').value; let p = 0, any = false;
      for (const id of D.ids) { const s = sample ? maxOf(id, 'M') : score(id, g, tr.querySelector(`[data-id="${id}"]`).value === '' ? null : Number(tr.querySelector(`[data-id="${id}"]`).value)); if (!sample) tr.querySelector(`[data-s="${id}"]`).textContent = f1(s); if (s != null) { p += s; any = true; } }
      const tot = r.school == null && !any ? null : (r.school || 0) + (any ? p : 0);
      tr.querySelector('[data-p]').textContent = any ? f1(p) : '—'; tr.querySelector('[data-t]').innerHTML = `<b>${f1(tot)}</b>`;
      if (D.cut) { tr.querySelector('[data-m1]').innerHTML = margin(r.school == null ? null : tot, D.cut[0]); tr.querySelector('[data-m2]').innerHTML = margin(r.school == null ? null : tot, D.cut[1]); }
    };
    tr.addEventListener('input', calc); tr.addEventListener('change', calc);
    tr.addEventListener('click', e => { if (e.target.closest('[data-x]')) { const u = new URL(location.href); u.searchParams.set('st', (u.searchParams.get('st') || '').split(',').filter(x => x && x !== String(r.id)).join(',')); location.href = u; } });
    tb.append(tr); calc();
  };
  D.rows.forEach(r => row(r, false));
  D.sample.forEach(r => row(r, true));
})();
