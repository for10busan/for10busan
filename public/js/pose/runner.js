// 브라우저에서 MediaPipe Pose 로 영상의 관절을 프레임마다 찾는다
import { KP_SRC } from './analyze.js';

const MP_VER = '0.10.14';
const CFG = window.MP_CFG || {};
const BASE = CFG.base || `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
const MODEL = CFG.model || 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

let landmarkerP = null;
async function getLandmarker() {
  if (landmarkerP) return landmarkerP;
  landmarkerP = (async () => {
    const { FilesetResolver, PoseLandmarker } = await import(/* webpackIgnore: true */ `${BASE}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
    const opts = d => ({ baseOptions: { modelAssetPath: MODEL, delegate: d }, runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
    try { return await PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch { return await PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
  })();
  return landmarkerP;
}

const seek = (v, t) => new Promise(res => { const on = () => { v.removeEventListener('seeked', on); res(); }; v.addEventListener('seeked', on); v.currentTime = t; });

// src: 영상 주소, onProgress(0~1, 메시지)
export async function extractPose(src, onProgress = () => {}) {
  onProgress(0, 'AI 모델 불러오는 중…');
  const lm = await getLandmarker();
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.src = src;
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('영상을 열 수 없어요 (지원하지 않는 형식일 수 있어요)')); });
  const dur = v.duration;
  if (!Number.isFinite(dur) || dur <= 0) throw new Error('영상 길이를 알 수 없어요');
  const maxFrames = 450;
  const step = Math.max(1 / 30, dur / maxFrames);
  const fps = 1 / step;
  const frames = [];
  let found = 0;
  for (let t = 0, i = 0; t < dur - 1e-3; t += step, i++) {
    await seek(v, Math.min(t, dur - 0.001));
    const r = lm.detectForVideo(v, Math.round(t * 1000) + i); // 타임스탬프는 증가해야 함
    const L = r.landmarks && r.landmarks[0];
    if (L) {
      const p = [];
      for (const k of KP_SRC) { const q = L[k]; p.push(+q.x.toFixed(4), +q.y.toFixed(4), +(q.visibility ?? 1).toFixed(2)); }
      frames.push({ t: +t.toFixed(3), p }); found++;
    } else frames.push(null);
    if (i % 5 === 0) onProgress(t / dur, `관절 찾는 중… ${Math.round((t / dur) * 100)}%`);
  }
  onProgress(1, '분석 결과 계산 중…');
  return { fps: +fps.toFixed(3), width: v.videoWidth, height: v.videoHeight, frames, found };
}
