// 테스트용 가상 동작 생성기 (측면, +x 방향)
const D = Math.PI / 180;
// 자세 → 17개 관절 (픽셀) → 정규화 frame
export function body({ hx, hy, trunk = 0, hipFlex = 0, knee = 180, shoulder = 0, elbow = 180, ankleOnGround = null }, W = 1280, H = 720) {
  const T = 160, TH = 120, SH = 110, AR = 90, FA = 85;
  // trunk: 수직에서 앞(+x)으로 숙인 각도
  const sh = [hx + T * Math.sin(trunk * D), hy - T * Math.cos(trunk * D)];
  // 허벅지: 수직 아래에서 앞으로 hipFlex 만큼
  const kn = [hx + TH * Math.sin(hipFlex * D), hy + TH * Math.cos(hipFlex * D)];
  // 정강이: 무릎각(knee) — 허벅지 방향에서 뒤로 꺾임
  const thighDir = Math.atan2(kn[1] - hy, kn[0] - hx);
  const shinDir = thighDir + (180 - knee) * D; // 시계 방향 회전(뒤로)
  let an = [kn[0] + SH * Math.cos(shinDir), kn[1] + SH * Math.sin(shinDir)];
  // 팔: shoulder = 몸통 아래 방향 기준 앞으로 회전 각도(0=아래로 늘어뜨림, 180=머리 위)
  const downDir = Math.atan2(hy - sh[1], hx - sh[0]);
  const armDir = downDir - shoulder * D;
  const el = [sh[0] + AR * Math.cos(armDir), sh[1] + AR * Math.sin(armDir)];
  const faDir = armDir - (180 - elbow) * D;
  const wr = [el[0] + FA * Math.cos(faDir), el[1] + FA * Math.sin(faDir)];
  const he = [an[0] - 12, an[1] + 8], ft = [an[0] + 22, an[1] + 10];
  const L = { 0: [sh[0] + 10, sh[1] - 45], 11: sh, 13: el, 15: wr, 23: [hx, hy], 25: kn, 27: an, 29: he, 31: ft };
  const R = { 12: [sh[0] - 3, sh[1]], 14: [el[0] - 3, el[1]], 16: [wr[0] - 3, wr[1]], 24: [hx - 3, hy], 26: [kn[0] - 3, kn[1]], 28: [an[0] - 3, an[1]], 30: [he[0] - 3, he[1]], 32: [ft[0] - 3, ft[1]] };
  const all = { ...L, ...R };
  const SRC = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
  const p = [];
  for (const i of SRC) { const v = all[i]; p.push(+(v[0] / W).toFixed(4), +(v[1] / H).toFixed(4), i % 2 === 1 || i === 0 ? 0.95 : 0.6); }
  return p;
}
const lerp = (a, b, u) => a + (b - a) * Math.max(0, Math.min(1, u));
export function longJump(fps = 30) {
  const frames = []; const groundY = 600; const N = Math.round(2.4 * fps);
  for (let i = 0; i < N; i++) {
    const t = i / fps; let s;
    if (t < 0.4) s = { hx: 300, knee: 175, hipFlex: 5, trunk: 5, shoulder: 10 };
    else if (t < 0.9) { const u = (t - 0.4) / 0.5; s = { hx: 300, knee: lerp(175, 100, u), hipFlex: lerp(5, 70, u), trunk: lerp(5, 50, u), shoulder: lerp(10, -60, u) }; } // 백스윙: 팔 뒤로
    else if (t < 1.0) { const u = (t - 0.9) / 0.1; s = { hx: 300 + 40 * u, knee: lerp(100, 170, u), hipFlex: lerp(70, 10, u), trunk: lerp(50, 35, u), shoulder: lerp(-60, 120, u) }; }
    else if (t < 1.5) { const u = (t - 1.0) / 0.5; s = { hx: 340 + 380 * u, knee: lerp(170, 120, u), hipFlex: lerp(10, 80, u), trunk: lerp(35, 30, u), shoulder: lerp(120, 150, u), air: Math.sin(Math.PI * u) }; }
    else { const u = (t - 1.5) / 0.3; s = { hx: 720 + 20 * Math.min(1, u), knee: lerp(120, 95, u), hipFlex: lerp(80, 85, u), trunk: lerp(30, 40, u), shoulder: lerp(150, 60, u) }; }
    // 발이 바닥에 닿도록 엉덩이 높이 계산
    const tmp = body({ ...s, hx: s.hx, hy: 0 });
    const ankleY = tmp[11 * 3 + 1] * 720; // 발목(인덱스 11)
    let hy = groundY - ankleY;
    if (s.air) hy -= 130 * s.air;
    frames.push({ t: +t.toFixed(3), p: body({ ...s, hy }) });
  }
  return { fps, width: 1280, height: 720, frames };
}
export function medBall(fps = 30) {
  const frames = []; const N = Math.round(2 * fps);
  for (let i = 0; i < N; i++) {
    const t = i / fps; let s;
    if (t < 0.4) s = { trunk: 0, shoulder: 170, elbow: 150, knee: 170 };
    else if (t < 1.0) { const u = (t - 0.4) / 0.6; s = { trunk: lerp(0, -25, u), shoulder: lerp(170, 200, u), elbow: lerp(150, 120, u), knee: lerp(170, 145, u) }; }
    else if (t < 1.15) { const u = (t - 1.0) / 0.15; s = { trunk: lerp(-25, 15, u), shoulder: lerp(200, 130, u), elbow: lerp(120, 172, u), knee: lerp(145, 175, u) }; }
    else { const u = (t - 1.15) / 0.5; s = { trunk: lerp(15, 25, u), shoulder: lerp(130, 100, u), elbow: 175, knee: 175 }; }
    frames.push({ t: +t.toFixed(3), p: body({ hx: 500, hy: 380, hipFlex: 0, ...s }) });
  }
  return { fps, width: 1280, height: 720, frames };
}
