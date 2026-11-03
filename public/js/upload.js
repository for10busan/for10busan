// 영상 업로드: 기록 행 만들기 → 파일 전송(진행률) → 결과 화면으로 이동 (거기서 자동 분석)
const f = document.getElementById('upForm');
if (f) f.addEventListener('submit', async e => {
  e.preventDefault();
  const file = f.file.files[0]; if (!file) return;
  const btn = f.querySelector('button'), bar = f.querySelector('.progress'), msg = document.getElementById('upMsg');
  if (file.size > 300 * 1048576) { msg.textContent = '영상이 너무 커요 (300MB 이하). 짧게 잘라 주세요.'; return; }
  btn.disabled = true; bar.hidden = false;
  try {
    const r = await fetch('/api/videos', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': UP.csrf, Accept: 'application/json' }, body: JSON.stringify({ exercise_id: f.dataset.ex, record: f.record.value, mime: file.type }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error);
    await new Promise((res, rej) => {
      const x = new XMLHttpRequest(); x.open('PUT', `/api/videos/${j.id}/file`);
      x.setRequestHeader('Content-Type', file.type || 'video/mp4'); x.setRequestHeader('X-CSRF', UP.csrf); x.setRequestHeader('Accept', 'application/json');
      x.upload.onprogress = ev => { if (ev.lengthComputable) { bar.firstElementChild.style.width = (ev.loaded / ev.total) * 100 + '%'; msg.textContent = `올리는 중… ${Math.round((ev.loaded / ev.total) * 100)}%`; } };
      x.onload = () => (x.status < 300 ? res() : rej(new Error((JSON.parse(x.responseText || '{}').error) || '업로드 실패')));
      x.onerror = () => rej(new Error('네트워크 오류'));
      x.send(file);
    });
    msg.textContent = '업로드 완료! 분석 화면으로 이동해요…';
    location.href = `/videos/${j.id}`;
  } catch (err) { msg.textContent = '실패: ' + err.message; btn.disabled = false; }
});
