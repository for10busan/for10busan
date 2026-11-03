// 공통 동작: 확인창, 출석 버튼, 자동 저장 폼, 일지 종목 행, 서비스워커
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-confirm]');
  if (f && !confirm(f.dataset.confirm)) e.preventDefault();
});

// 바꾸면 바로 저장되는 폼 (회원 관리, 알림 설정)
document.querySelectorAll('form[data-autosubmit]').forEach(f => {
  f.addEventListener('change', async () => {
    const body = new URLSearchParams(new FormData(f)); body.set('_ajax', '1');
    const r = await fetch(f.action, { method: 'POST', body, headers: { Accept: 'application/json' } });
    toast(r.ok ? '저장했어요' : '저장 실패');
  });
});
function toast(t) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#111;color:#fff;padding:9px 16px;border-radius:999px;font-size:14px;font-weight:600;z-index:99;transition:opacity .3s'; document.body.append(el); }
  el.textContent = t; el.style.opacity = 1; clearTimeout(el._t); el._t = setTimeout(() => (el.style.opacity = 0), 1500);
}
window.toast = toast;

// 출석 체크
if (window.ATT) {
  const LBL = { present: 'present', late: 'late', absent: 'absent', excused: 'excused' };
  const sum = () => {
    const c = { present: 0, late: 0, absent: 0, excused: 0, none: 0 };
    document.querySelectorAll('[data-att]').forEach(el => c[el.dataset.status || 'none']++);
    for (const [k, v] of Object.entries(c)) { const b = document.querySelector(`[data-c=${k}]`); if (b) b.textContent = v; }
    const allBtn = document.querySelector('.sticky-bottom button'); if (allBtn) { allBtn.disabled = !c.none; allBtn.lastChild.textContent = `미체크 ${c.none}명 전체 출석`; }
  };
  const save = async (card, status, memo) => {
    const body = new URLSearchParams({ student_id: card.dataset.att, status, memo: memo ?? (card.querySelector('[data-memo]')?.value || ''), _csrf: ATT.csrf });
    const r = await fetch(ATT.url, { method: 'POST', body, headers: { Accept: 'application/json' } });
    if (!r.ok) toast('저장 실패 — 새로고침 해 주세요');
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('.att-btns button'); if (!b) return;
    const card = b.closest('[data-att]'); const v = b.dataset.v;
    const next = card.dataset.status === v ? '' : v; // 같은 버튼을 다시 누르면 지움
    card.dataset.status = next;
    card.querySelectorAll('.att-btns button').forEach(x => x.classList.toggle('on', x.dataset.v === next));
    const memo = card.querySelector('.att-memo'); memo.hidden = !next || next === 'present';
    sum(); save(card, next);
  });
  document.addEventListener('change', e => { const i = e.target.closest('[data-memo]'); if (i) { const card = i.closest('[data-att]'); save(card, card.dataset.status, i.value).then(() => toast('메모 저장')); } });
  void LBL;
}

// 일지: 종목 행 추가/삭제
const items = document.getElementById('items');
if (items) {
  document.getElementById('addItem').addEventListener('click', () => {
    const row = items.querySelector('.li').cloneNode(true);
    row.querySelectorAll('input').forEach(i => (i.value = '')); row.querySelector('select').selectedIndex = 0;
    items.append(row);
  });
  items.addEventListener('click', e => { if (e.target.closest('[data-del]') && items.children.length > 1) e.target.closest('.li').remove(); });
}

// 앱 설치
let deferred = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; const b = document.getElementById('installBtn'); if (b) { b.hidden = false; b.onclick = () => deferred.prompt(); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
