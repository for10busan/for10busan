// node --test test/  — 자세 분석·판정 로직 단위 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, angle3, hipExt } from '../public/js/pose/analyze.js';
import { longJump, medBall } from './synth.js';

test('각도 계산', () => {
  assert.equal(Math.round(angle3([0, 0], [1, 0], [1, 1])), 90);
  assert.equal(Math.round(angle3([0, 0], [1, 0], [2, 0])), 180);
  // 어깨가 엉덩이-무릎 선보다 뒤(진행 반대)로 젖혀지면 180 초과
  assert.ok(hipExt([-0.3, -1], [0, 0], [0, 1], 1) > 180);
  assert.ok(hipExt([0.3, -1], [0, 0], [0, 1], 1) < 180);
});

test('제자리멀리뛰기: 도약·착지 순간을 1~2프레임 안에 찾는다', () => {
  const pose = longJump(30); // 가상 동작: 1.0초에 도약, 1.5초에 착지
  const r = analyze('standing_long_jump', pose);
  const t = f => pose.frames[f].t;
  assert.ok(Math.abs(t(r.keyFrames.takeoff) - 1.0) <= 2 / 30, `takeoff ${t(r.keyFrames.takeoff)}`);
  assert.ok(Math.abs(t(r.keyFrames.landing) - 1.5) <= 2 / 30, `landing ${t(r.keyFrames.landing)}`);
  assert.ok(r.keyFrames.backswing < r.keyFrames.takeoff);
  assert.ok(r.metrics.takeoff_angle > 20 && r.metrics.takeoff_angle < 60);
  assert.ok(r.confidence > 80);
});

test('보정: 핵심 순간을 바꾸면 지표가 다시 계산된다', () => {
  const pose = longJump(30);
  const a = analyze('standing_long_jump', pose);
  const b = analyze('standing_long_jump', pose, { takeoff: a.keyFrames.takeoff + 2 });
  assert.notEqual(a.metrics.takeoff_angle, b.metrics.takeoff_angle);
  assert.equal(b.keyFrames.landing, a.keyFrames.landing);
});

test('메디신볼: 준비 → 놓는 순간 순서와 엉덩이 신전', () => {
  const r = analyze('medicine_ball', medBall(30));
  assert.ok(r.keyFrames.backswing < r.keyFrames.release);
  assert.ok(r.metrics.backswing_hip_angle > 180, `hip ${r.metrics.backswing_hip_angle}`);
  assert.ok(r.metrics.release_elbow_angle > 120);
});

test('관절이 거의 없으면 실패로 돌려준다', () => {
  const r = analyze('standing_long_jump', { fps: 30, width: 100, height: 100, frames: [null, null, null] });
  assert.ok(r.error);
});
