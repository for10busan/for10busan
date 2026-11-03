// 자세 분석 알고리즘 (브라우저·서버 공용, 의존성 없음)
// 입력 pose: { fps, width, height, frames: [ {t, p:[x,y,v]*17} | null ] }  (x,y는 0~1 정규화)
// 저장하는 관절 17개 (MediaPipe Pose 33개 중)
export const KP_SRC = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
export const KP = { nose: 0, lsh: 1, rsh: 2, lel: 3, rel: 4, lwr: 5, rwr: 6, lhip: 7, rhip: 8, lkn: 9, rkn: 10, lan: 11, ran: 12, lhe: 13, rhe: 14, lft: 15, rft: 16 };
export const BONES = [[1, 2], [1, 3], [3, 5], [2, 4], [4, 6], [1, 7], [2, 8], [7, 8], [7, 9], [9, 11], [8, 10], [10, 12], [11, 13], [13, 15], [11, 15], [12, 14], [14, 16], [12, 16]];

const R2D = 180 / Math.PI;
const r1 = v => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);

// ---------- 기본 기하 ----------
export function angle3(a, b, c) { // b에서의 내각 (0~180)
  if (!a || !b || !c) return null;
  const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
  const n = Math.hypot(...v1) * Math.hypot(...v2); if (!n) return null;
  return Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / n))) * R2D;
}
// 수평(진행 방향 dir) 기준 위쪽 + 각도
export function elev(from, to, dir) { if (!from || !to) return null; return Math.atan2(from[1] - to[1], dir * (to[0] - from[0])) * R2D; }
// 몸통 기울기: 엉덩이→어깨가 수직에서 진행 방향으로 기운 각도 (+앞, -뒤)
export function lean(hip, sh, dir) { if (!hip || !sh) return null; return Math.atan2(dir * (sh[0] - hip[0]), hip[1] - sh[1]) * R2D; }
// 신전 포함 엉덩이 각(0~360): 어깨가 엉덩이-무릎 선보다 뒤로 젖혀지면 180 초과
export function hipExt(sh, hip, kn, dir) {
  const a = angle3(sh, hip, kn); if (a == null) return null;
  const cross = (kn[0] - hip[0]) * (sh[1] - hip[1]) - (kn[1] - hip[1]) * (sh[0] - hip[0]);
  return cross * dir > 0 ? 360 - a : a;
}

// ---------- 전처리 ----------
export function prepare(pose) {
  const W = pose.width || 1, H = pose.height || 1;
  const n = pose.frames.length;
  const raw = pose.frames.map(f => f && f.p ? Array.from({ length: 17 }, (_, i) => [f.p[i * 3] * W, f.p[i * 3 + 1] * H, f.p[i * 3 + 2]]) : null);
  const t = pose.frames.map((f, i) => (f && f.t != null ? f.t : i / (pose.fps || 30)));
  // 쪽 선택: 카메라에 더 잘 보이는 쪽
  const side = ['l', 'r'].map(s => {
    let v = 0, c = 0;
    for (const p of raw) if (p) for (const k of ['sh', 'el', 'wr', 'hip', 'kn', 'an']) { v += p[KP[s + k]][2]; c++; }
    return c ? v / c : 0;
  });
  const S = side[0] >= side[1] ? 'l' : 'r';
  const idx = { sh: KP[S + 'sh'], el: KP[S + 'el'], wr: KP[S + 'wr'], hip: KP[S + 'hip'], kn: KP[S + 'kn'], an: KP[S + 'an'], he: KP[S + 'he'], ft: KP[S + 'ft'] };
  // 관절별 시계열 (신뢰 낮은 점은 비우고 보간 + 이동평균)
  const series = {};
  for (const [k, i] of Object.entries(idx)) {
    const xs = raw.map(p => (p && p[i][2] >= 0.3 ? p[i][0] : null));
    const ys = raw.map(p => (p && p[i][2] >= 0.3 ? p[i][1] : null));
    series[k] = { x: smooth(interp(xs)), y: smooth(interp(ys)), v: raw.map(p => (p ? p[i][2] : 0)) };
  }
  const pt = (k, f) => (f == null || f < 0 || f >= n || series[k].x[f] == null ? null : [series[k].x[f], series[k].y[f]]);
  const torsoL = median(range(n).map(f => dist(pt('sh', f), pt('hip', f))).filter(Boolean)) || H * 0.25;
  const valid = range(n).filter(f => raw[f]);
  return { n, t, raw, S, idx, series, pt, torsoL, valid, fps: pose.fps || 30, W, H };
}
function interp(a) {
  const out = a.slice(); let last = -1;
  for (let i = 0; i < out.length; i++) {
    if (out[i] == null) continue;
    if (last >= 0 && i - last > 1 && i - last <= 15) for (let j = last + 1; j < i; j++) out[j] = out[last] + ((out[i] - out[last]) * (j - last)) / (i - last);
    last = i;
  }
  return out;
}
function smooth(a, w = 2) {
  return a.map((v, i) => { if (v == null) return null; let s = 0, c = 0; for (let j = i - w; j <= i + w; j++) if (a[j] != null) { s += a[j]; c++; } return s / c; });
}
const range = n => Array.from({ length: n }, (_, i) => i);
const dist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : null);
export function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
const argBy = (fs, fn, better) => { let best = null, bv = null; for (const f of fs) { const v = fn(f); if (v == null) continue; if (bv == null || better(v, bv)) { bv = v; best = f; } } return best; };
const argmin = (fs, fn) => argBy(fs, fn, (a, b) => a < b);
const argmax = (fs, fn) => argBy(fs, fn, (a, b) => a > b);
const between = (a, b) => (a == null || b == null ? [] : range(Math.max(0, b - a + 1)).map(i => a + i));
function dirOf(P) {
  const f0 = P.valid[0], f1 = P.valid[P.valid.length - 1];
  const d = (P.series.hip.x[f1] ?? 0) - (P.series.hip.x[f0] ?? 0);
  return d >= 0 ? 1 : -1;
}
const kneeA = (P, f) => angle3(P.pt('hip', f), P.pt('kn', f), P.pt('an', f));
const hipA = (P, f) => angle3(P.pt('sh', f), P.pt('hip', f), P.pt('kn', f));
const shA = (P, f) => angle3(P.pt('hip', f), P.pt('sh', f), P.pt('wr', f));
const elbA = (P, f) => angle3(P.pt('sh', f), P.pt('el', f), P.pt('wr', f));

// ---------- 종목별 알고리즘 ----------
// moments: 핵심 순간 / metrics: 계산 지표 (key, 이름, 단위, 측정 순간, 설명)
export const ALGOS = {
  standing_long_jump: {
    name: '제자리멀리뛰기 분석', version: 'standing_long_jump v1.0',
    moments: [['backswing', '백스윙 탑'], ['takeoff', '도약'], ['landing', '착지']],
    metrics: [
      ['takeoff_angle', '도약각', '°', '도약 순간', '발이 떨어진 직후 엉덩이가 날아가는 방향이 수평과 이루는 각도'],
      ['pre_knee', '도약직전 무릎각', '°', '도약 직전 가장 깊이 앉은 순간', '엉덩이-무릎-발목이 이루는 각도 (작을수록 깊게 앉음)'],
      ['pre_trunk', '도약직전 상체 각도', '°', '도약 직전 가장 깊이 앉은 순간', '어깨-엉덩이-무릎이 이루는 각도'],
      ['backswing_arm', '도약 전 백스윙 각도', '°', '백스윙 탑', '몸통과 팔이 이루는 각도 (팔을 뒤로 얼마나 크게 보냈는지)'],
      ['front_swing', '앞 스윙 각도', '°', '공중', '공중에서 팔을 앞으로 뻗은 최대 각도'],
      ['landing_knee', '착지 시 무릎 각도', '°', '착지', '착지 순간 무릎 각도 (충격 흡수)'],
      ['backswing_lean', '백스윙 탑 상체 숙임', '°', '백스윙 탑', '상체가 수직에서 앞으로 숙여진 각도'],
    ],
    detect(P) {
      const dir = dirOf(P); const { an, hip } = P.series;
      const early = P.valid.slice(0, Math.max(3, Math.floor(P.valid.length * 0.25)));
      const base = median(early.map(f => an.y[f]).filter(v => v != null));
      const thr = P.torsoL * 0.15;
      // 발목이 바닥에서 3프레임 이상 연속으로 떠 있기 시작한 순간 = 도약
      const up = f => an.y[f] != null && base - an.y[f] > thr;
      let takeoff = null;
      for (const f of P.valid) if (up(f) && up(f + 1) && up(f + 2)) { takeoff = Math.max(0, f - 1); break; }
      if (takeoff == null) return { dir };
      let landing = null;
      for (const f of P.valid) if (f > takeoff + 3 && an.y[f] != null && base - an.y[f] < thr * 0.6) { landing = f; break; }
      const win = P.valid.filter(f => f < takeoff && f >= takeoff - Math.round(P.fps * 1.5));
      const backswing = argmin(win, f => { const w = P.pt('wr', f), s = P.pt('sh', f); return w && s ? dir * (w[0] - s[0]) - (s[1] - w[1]) * 0.2 : null; });
      return { dir, backswing, takeoff, landing };
    },
    compute(P, k) {
      const dir = k.dir ?? dirOf(P); const out = {};
      if (k.takeoff != null) {
        const end = Math.min(k.landing != null ? k.landing - 1 : P.n - 1, k.takeoff + 4);
        out.takeoff_angle = elev(P.pt('hip', k.takeoff), P.pt('hip', end), dir);
        const pre = between(k.backswing ?? Math.max(0, k.takeoff - Math.round(P.fps)), k.takeoff);
        const deep = argmin(pre, f => kneeA(P, f));
        out.pre_knee = kneeA(P, deep); out.pre_trunk = hipA(P, deep);
        if (k.landing != null) out.front_swing = Math.max(...between(k.takeoff, k.landing).map(f => shA(P, f) ?? -1));
      }
      if (k.backswing != null) { out.backswing_arm = shA(P, k.backswing); out.backswing_lean = lean(P.pt('hip', k.backswing), P.pt('sh', k.backswing), dir); }
      if (k.landing != null) out.landing_knee = kneeA(P, k.landing);
      if (out.front_swing < 0) delete out.front_swing;
      return out;
    },
  },
  medicine_ball: {
    name: '메디신볼 던지기 분석', version: 'medicine_ball v1.0',
    moments: [['backswing', '준비 (최대 젖힘)'], ['release', '공 놓는 순간']],
    metrics: [
      ['release_arm_angle', '놓는 순간 팔 각도', '°', '공을 놓는 순간', '어깨와 손목을 잇는 선이 수평과 이루는 각도 (공이 날아가는 각도와 비슷)'],
      ['release_elbow_angle', '놓는 순간 팔꿈치 각도', '°', '공을 놓는 순간', '어깨-팔꿈치-손목 각도 (180°에 가까울수록 쭉 폄)'],
      ['backswing_hip_angle', '준비 때 엉덩이 각도', '°', '준비 (최대 젖힘)', '어깨-엉덩이-무릎 각도. 180°보다 크면 몸을 뒤로 젖힌 것'],
      ['backswing_knee_angle', '준비 때 무릎 각도', '°', '준비 (최대 젖힘)', '엉덩이-무릎-발목 각도'],
    ],
    detect(P) {
      const { wr } = P.series; const vx = [];
      for (let f = 1; f < P.n; f++) vx[f] = wr.x[f] != null && wr.x[f - 1] != null ? (wr.x[f] - wr.x[f - 1]) / Math.max(1e-3, P.t[f] - P.t[f - 1]) : null;
      const peak = argmax(range(P.n).slice(1), f => (vx[f] == null ? null : Math.abs(vx[f])));
      if (peak == null) return {};
      const dir = vx[peak] >= 0 ? 1 : -1;
      const win = P.valid.filter(f => f < peak && f >= peak - Math.round(P.fps * 1.5));
      const backswing = argmin(win, f => { const w = P.pt('wr', f), s = P.pt('sh', f); return w && s ? dir * (w[0] - s[0]) : null; });
      return { dir, backswing, release: peak };
    },
    compute(P, k) {
      const dir = k.dir ?? 1; const out = {};
      if (k.release != null) { out.release_arm_angle = elev(P.pt('sh', k.release), P.pt('wr', k.release), dir); out.release_elbow_angle = elbA(P, k.release); }
      if (k.backswing != null) { out.backswing_hip_angle = hipExt(P.pt('sh', k.backswing), P.pt('hip', k.backswing), P.pt('kn', k.backswing), dir); out.backswing_knee_angle = kneeA(P, k.backswing); }
      return out;
    },
  },
  sargent_jump: {
    name: '서전트 점프 분석', version: 'sargent_jump v1.0',
    moments: [['squat', '최저 자세'], ['takeoff', '도약'], ['peak', '최고점'], ['landing', '착지']],
    metrics: [
      ['squat_knee', '도약 전 무릎 각도', '°', '최저 자세', '가장 깊이 앉았을 때 무릎 각도'],
      ['squat_trunk', '도약 전 상체 각도', '°', '최저 자세', '어깨-엉덩이-무릎 각도'],
      ['takeoff_arm', '도약 때 팔 스윙 각도', '°', '도약', '몸통과 팔이 이루는 각도 (팔을 위로 크게 올릴수록 큼)'],
      ['peak_rise', '엉덩이 상승 (몸통 길이 대비)', '%', '최고점', '서 있을 때보다 엉덩이가 올라간 높이 ÷ 몸통 길이'],
      ['landing_knee', '착지 시 무릎 각도', '°', '착지', '착지 순간 무릎 각도'],
    ],
    detect(P) {
      const { hip, an } = P.series;
      const peak = argmin(P.valid, f => hip.y[f]);
      if (peak == null) return {};
      const squat = argmax(P.valid.filter(f => f < peak), f => hip.y[f]);
      const base = median(P.valid.slice(0, Math.max(3, Math.floor(P.valid.length * 0.2))).map(f => an.y[f]).filter(v => v != null));
      const thr = P.torsoL * 0.12;
      let takeoff = null; for (const f of P.valid) if (f > (squat ?? 0) && f <= peak && base - an.y[f] > thr) { takeoff = Math.max(0, f - 1); break; }
      let landing = null; for (const f of P.valid) if (f > peak && base - an.y[f] < thr * 0.6) { landing = f; break; }
      return { dir: dirOf(P), squat, takeoff, peak, landing };
    },
    compute(P, k) {
      const out = {};
      if (k.squat != null) { out.squat_knee = kneeA(P, k.squat); out.squat_trunk = hipA(P, k.squat); }
      if (k.takeoff != null) out.takeoff_arm = shA(P, k.takeoff);
      if (k.peak != null) {
        const stand = median(P.valid.slice(0, Math.max(3, Math.floor(P.valid.length * 0.15))).map(f => P.series.hip.y[f]).filter(v => v != null));
        out.peak_rise = ((stand - P.series.hip.y[k.peak]) / P.torsoL) * 100;
      }
      if (k.landing != null) out.landing_knee = kneeA(P, k.landing);
      return out;
    },
  },
  sit_and_reach: {
    name: '좌전굴 분석', version: 'sit_and_reach v1.0',
    moments: [['reach', '최대로 뻗은 순간']],
    metrics: [
      ['trunk_flex', '상체 숙임 각도', '°', '최대로 뻗은 순간', '어깨-엉덩이-발목 각도 (작을수록 깊이 숙임)'],
      ['knee_straight', '무릎 펴짐 각도', '°', '최대로 뻗은 순간', '엉덩이-무릎-발목 각도 (180°에 가까워야 함)'],
    ],
    detect(P) {
      // 발목 쪽 방향으로 손목이 가장 멀리 간 순간
      const f0 = P.valid[0]; const a = P.pt('an', f0), h = P.pt('hip', f0); const dir = a && h && a[0] < h[0] ? -1 : 1;
      const reach = argmax(P.valid, f => { const w = P.pt('wr', f), hp = P.pt('hip', f); return w && hp ? dir * (w[0] - hp[0]) : null; });
      return { dir, reach };
    },
    compute(P, k) { const out = {}; if (k.reach != null) { out.trunk_flex = angle3(P.pt('sh', k.reach), P.pt('hip', k.reach), P.pt('an', k.reach)); out.knee_straight = kneeA(P, k.reach); } return out; },
  },
  situps: {
    name: '윗몸일으키기 분석', version: 'situps v1.0',
    moments: [['first_up', '첫 번째 올라온 순간']],
    metrics: [
      ['reps', '인식된 횟수', '회', '전체', '상체를 끝까지 올렸다 내린 횟수 (영상 기준)'],
      ['avg_top', '올라왔을 때 평균 엉덩이 각도', '°', '올라온 순간들', '어깨-엉덩이-무릎 각도 평균 (작을수록 끝까지 올라옴)'],
    ],
    detect(P) {
      const a = range(P.n).map(f => hipA(P, f));
      const ups = []; let state = 'down', cur = null;
      for (let f = 0; f < P.n; f++) {
        if (a[f] == null) continue;
        if (state === 'down' && a[f] < 75) { state = 'up'; cur = f; }
        else if (state === 'up') { if (a[f] < a[cur]) cur = f; if (a[f] > 115) { ups.push(cur); state = 'down'; } }
      }
      return { dir: dirOf(P), first_up: ups[0] ?? null, ups };
    },
    compute(P, k) { const ups = k.ups || []; const out = { reps: ups.length }; if (ups.length) out.avg_top = ups.reduce((s, f) => s + (hipA(P, f) || 0), 0) / ups.length; return out; },
  },
  back_strength: {
    name: '배근력 분석', version: 'back_strength v1.0',
    moments: [['pull', '당기는 순간 (최대 폄)']],
    metrics: [
      ['pull_knee', '당길 때 무릎 각도', '°', '당기는 순간', '엉덩이-무릎-발목 각도 (거의 펴져 있어야 함)'],
      ['pull_trunk', '당길 때 상체 각도', '°', '당기는 순간', '수직에서 상체가 숙여진 각도 (약 30° 권장)'],
    ],
    detect(P) {
      const dir = dirOf(P) || 1;
      const pull = argmin(P.valid, f => { const l = lean(P.pt('hip', f), P.pt('sh', f), dir); return l == null ? null : Math.abs(l - 30); });
      return { dir, pull };
    },
    compute(P, k) { const out = {}; if (k.pull != null) { out.pull_knee = kneeA(P, k.pull); out.pull_trunk = Math.abs(lean(P.pt('hip', k.pull), P.pt('sh', k.pull), k.dir || 1)); } return out; },
  },
  shuttle: {
    name: '왕복달리기·Z런 분석 (출발·방향 전환)', version: 'shuttle v1.0',
    moments: [['start', '출발'], ['turn1', '첫 방향 전환'], ['finish', '끝']],
    metrics: [
      ['start_lean', '출발 상체 숙임', '°', '출발 직후', '상체가 수직에서 진행 방향으로 숙여진 각도'],
      ['turns', '방향 전환 횟수', '회', '전체', '영상에서 인식된 방향 전환 횟수'],
      ['avg_turn_time', '평균 방향 전환 시간', '초', '방향 전환', '속도가 줄기 시작해서 다시 붙을 때까지 걸린 시간 평균'],
      ['turn_knee', '전환 때 무릎 각도', '°', '방향 전환', '방향 전환 순간 무릎 각도 평균 (낮은 자세일수록 작음)'],
      ['turn_lean', '전환 때 상체 기울기', '°', '방향 전환', '방향 전환 순간 상체가 수직에서 기운 각도 평균'],
      ['run_time', '움직인 시간', '초', '출발~끝', '출발부터 멈출 때까지 영상상 시간 (참고용)'],
    ],
    detect(P) {
      const { hip } = P.series; const vx = range(P.n).map(f => (f && hip.x[f] != null && hip.x[f - 1] != null ? (hip.x[f] - hip.x[f - 1]) / Math.max(1e-3, P.t[f] - P.t[f - 1]) : null));
      const speed = vx.map(v => (v == null ? null : Math.abs(v)));
      const peak = Math.max(...speed.filter(v => v != null), 0);
      if (!peak) return {};
      const moving = f => speed[f] != null && speed[f] > peak * 0.25;
      const start = range(P.n).find(moving) ?? null;
      const finish = [...range(P.n)].reverse().find(moving) ?? null;
      // 방향 전환: 진행 방향 부호가 바뀌는 지점 (일정 거리 이상 이동한 뒤)
      const turns = []; let lastSign = 0, lastX = null;
      for (let f = start ?? 0; f <= (finish ?? -1); f++) {
        if (vx[f] == null || Math.abs(vx[f]) < peak * 0.15) continue;
        const s = Math.sign(vx[f]);
        if (lastSign && s !== lastSign && lastX != null && Math.abs(hip.x[f] - lastX) > P.torsoL * 0.3) {
          let tf = f; for (let j = f; j > Math.max(0, f - P.fps); j--) if (speed[j] != null && speed[j] < (speed[tf] ?? Infinity)) tf = j;
          turns.push(tf); lastX = hip.x[f];
        }
        if (!lastSign || s !== lastSign) { lastSign = s; if (lastX == null) lastX = hip.x[f]; }
      }
      return { dir: vx[start] >= 0 ? 1 : -1, start, turn1: turns[0] ?? null, finish, turnList: turns, peak };
    },
    compute(P, k) {
      const out = {}; const turns = k.turnList || (k.turn1 != null ? [k.turn1] : []);
      if (k.start != null) { const f = Math.min(P.n - 1, k.start + 3); out.start_lean = lean(P.pt('hip', f), P.pt('sh', f), k.dir || 1); }
      out.turns = turns.length;
      if (turns.length) {
        const { hip } = P.series; const thr = (k.peak || 0) * 0.5;
        const times = turns.map(tf => {
          let a = tf, b = tf;
          const sp = f => (f > 0 && hip.x[f] != null && hip.x[f - 1] != null ? Math.abs(hip.x[f] - hip.x[f - 1]) / Math.max(1e-3, P.t[f] - P.t[f - 1]) : null);
          while (a > 1 && (sp(a) ?? 0) < thr) a--; while (b < P.n - 1 && (sp(b) ?? 0) < thr) b++;
          return P.t[b] - P.t[a];
        });
        out.avg_turn_time = times.reduce((s, x) => s + x, 0) / times.length;
        const kn = turns.map(f => kneeA(P, f)).filter(v => v != null); if (kn.length) out.turn_knee = kn.reduce((s, x) => s + x, 0) / kn.length;
        const ln = turns.map(f => lean(P.pt('hip', f), P.pt('sh', f), 1)).filter(v => v != null).map(Math.abs); if (ln.length) out.turn_lean = ln.reduce((s, x) => s + x, 0) / ln.length;
      }
      if (k.start != null && k.finish != null) out.run_time = P.t[k.finish] - P.t[k.start];
      return out;
    },
  },
};

// 분석 실행: keyFrames를 주면 그 순간 기준으로 지표만 다시 계산
export function analyze(code, pose, keyFrames = null) {
  const A = ALGOS[code]; if (!A) throw new Error('알 수 없는 분석 코드: ' + code);
  const P = prepare(pose);
  if (P.valid.length < 5) return { keyFrames: {}, metrics: {}, confidence: 0, algo: A.version, side: P.S, error: '관절을 거의 찾지 못했어요' };
  const auto = A.detect(P);
  const k = keyFrames ? { ...auto, ...keyFrames } : auto;
  // 수동으로 바꾼 순간이 있으면 목록형 정보(turnList, ups)는 첫 항목만 교체
  if (keyFrames && keyFrames.turn1 != null && auto.turnList) k.turnList = [keyFrames.turn1, ...auto.turnList.slice(1)];
  if (keyFrames && keyFrames.first_up != null && auto.ups) k.ups = [keyFrames.first_up, ...auto.ups.slice(1)];
  const m = A.compute(P, k);
  const metrics = {}; for (const [key, v] of Object.entries(m)) { const x = r1(v); if (x != null) metrics[key] = x; }
  // 신뢰도: 핵심 순간들에서 사용한 관절의 평균 visibility
  const fs = A.moments.map(([key]) => k[key]).filter(f => f != null);
  const use = fs.length ? fs : P.valid;
  let vs = 0, c = 0; for (const f of use) for (const key of ['sh', 'el', 'wr', 'hip', 'kn', 'an']) { vs += P.series[key].v[f] || 0; c++; }
  const kf = {}; for (const [key] of A.moments) if (k[key] != null) kf[key] = k[key];
  if (k.dir != null) kf.dir = k.dir;
  return { keyFrames: kf, metrics, confidence: c ? r1((vs / c) * 100) : 0, algo: A.version, side: P.S };
}
// 화면용: 특정 프레임의 관절 좌표 (정규화)
export function framePoints(pose, f) {
  const fr = pose.frames[f]; if (!fr || !fr.p) return null;
  return Array.from({ length: 17 }, (_, i) => [fr.p[i * 3], fr.p[i * 3 + 1], fr.p[i * 3 + 2]]);
}
