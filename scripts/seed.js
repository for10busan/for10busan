// 처음 실행할 때 기본 데이터(지점·종목·지표·예시 기준값·대학 목록·원장 계정)를 넣는다.
// node scripts/seed.js --demo  → 테스트용 가상 강사·학생·반·일지·영상까지 넣는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { one, all, run, tx, getSetting, setSetting } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';
import { ALGOS } from '../public/js/pose/analyze.js';
import { today, addDays } from '../lib/util.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// [이름, 단위, 높을수록좋음, 분석코드(영상형) | null]
const EXERCISES = [
  ['제자리멀리뛰기', 'cm', 1, 'standing_long_jump'], ['메디신볼 던지기', 'm', 1, 'medicine_ball'], ['10m 왕복달리기', '초', 0, 'shuttle'],
  ['Z런', '초', 0, 'shuttle'], ['20m 왕복달리기', '초', 0, 'shuttle'], ['배근력', 'kg', 1, 'back_strength'], ['좌전굴', 'cm', 1, 'sit_and_reach'],
  ['서전트 점프', 'cm', 1, 'sargent_jump'], ['윗몸일으키기', '회', 1, 'situps'], ['100m 달리기', '초', 0, null], ['농구', '회', 1, null], ['배구', '회', 1, null],
  ['사이드스텝', '회', 1, null], ['높이뛰기', 'cm', 1, null], ['핸드볼 던지기', 'm', 1, null], ['농구공 던지기', 'm', 1, null], ['에르고미터 1000m', '초', 0, null],
  ['25m 왕복달리기', '초', 0, null], ['50m 달리기', '초', 0, null], ['60m 달리기', '초', 0, null], ['팔굽혀 매달리기', '초', 1, null],
];
const GUIDES = {
  standing_long_jump: { position: '뛰는 방향의 옆(측면)에서 정확히 90°로', distance: '4~5m (출발선과 착지 지점이 모두 화면에 들어오게)', height: '허리 높이 (약 1m), 삼각대로 고정', cautions: ['가능하면 60fps로 찍어 주세요 (도약 순간이 빨라요)', '출발 1초 전부터 착지 후 1초까지 찍어 주세요', '몸에 붙는 옷을 입으면 관절을 더 잘 찾아요'] },
  medicine_ball: { position: '던지는 방향의 옆(측면)에서 정확히 90°로', distance: '3~4m (머리 위로 든 공과 발끝까지 화면에 들어오게)', height: '가슴 높이 (약 1.2m), 삼각대로 고정', cautions: ['가능하면 60fps로 찍어 주세요 (팔이 빨라 30fps면 놓는 순간 각도가 흔들려요)', '준비 자세부터 공이 손을 떠날 때까지 찍어 주세요'] },
  shuttle: { position: '달리는 방향과 수직으로, 코스 가운데 옆에서', distance: '코스 전체가 들어오는 거리 (보통 6~8m)', height: '허리 높이, 고정', cautions: ['카메라를 움직이지 마세요', '출발 전 정지 자세부터 찍어 주세요'] },
  back_strength: { position: '옆(측면)에서 90°로', distance: '2~3m', height: '허리 높이, 고정', cautions: ['측정기와 온몸이 함께 보이게 찍어 주세요'] },
  sit_and_reach: { position: '옆(측면)에서 90°로', distance: '2~3m', height: '앉은 엉덩이 높이 근처, 고정', cautions: ['발끝과 손끝이 모두 보이게 찍어 주세요'] },
  sargent_jump: { position: '옆(측면)에서 90°로', distance: '3~4m (팔을 위로 뻗은 손끝까지)', height: '허리 높이, 고정', cautions: ['가능하면 60fps로 찍어 주세요'] },
  situps: { position: '옆(측면)에서 90°로', distance: '2~3m', height: '매트 높이보다 조금 위, 고정', cautions: ['머리부터 발끝까지 보이게 찍어 주세요'] },
};
// 예시 기준값 (코치진이 확정하기 전 임시 값)
const BENCH = {
  standing_long_jump: { record: { min: 260, max: 300, tol: 5 }, takeoff_angle: { min: 35, max: 45, target: 40, tol: 2.5 }, pre_knee: { min: 90, max: 120, tol: 5 }, pre_trunk: { min: 60, max: 90, tol: 5 }, backswing_arm: { min: 40, max: 80, tol: 5 }, front_swing: { min: 140, max: 180, tol: 5 }, landing_knee: { min: 90, max: 130, tol: 5 }, backswing_lean: { min: 35, max: 60, tol: 5 } },
  medicine_ball: { record: { min: 10, max: 13, tol: 0.1 }, release_arm_angle: { min: 35, max: 45, target: 40, tol: 2.5 }, release_elbow_angle: { min: 160, max: 180, tol: 2.5 }, backswing_hip_angle: { min: 190, max: 215, tol: 2.5 }, backswing_knee_angle: { min: 130, max: 160, tol: 2.5 } },
};
const BENCH_F = { standing_long_jump: { record: { min: 200, max: 240, tol: 5 } }, medicine_ball: { record: { min: 7, max: 9.5, tol: 0.1 } } };
const TPL_MB = {
  release_arm_angle: ['{지표} {측정값} — 기준({기준})보다 {차이} 낮게 던졌어요. 공을 조금 더 위로 밀어 올리듯 놓아 보세요.', null, null, '{지표} {측정값} — 기준({기준})보다 {차이} 높게 던졌어요. 공이 너무 높이 뜨면 거리가 줄어요. 앞으로 뻗어 던지세요.'],
  release_elbow_angle: ['{지표} {측정값} — 팔꿈치가 기준({기준})보다 {차이} 굽었습니다. 팔을 끝까지 쭉 펴면서 던지세요.', null, null, '{지표} {측정값} — 기준({기준})보다 {차이} 큽니다. 팔꿈치를 과하게 젖히지 마세요.'],
  backswing_hip_angle: ['{지표} {측정값} — 기준({기준})보다 {차이} 덜 젖혔어요. 준비 때 몸을 활처럼 조금 더 뒤로 당겨 반동을 만드세요.', null, null, '{지표} {측정값} — 기준({기준})보다 {차이} 더 젖혔어요. 허리를 너무 젖히면 다칠 수 있어요. 복부에 힘을 주고 범위를 줄이세요.'],
  backswing_knee_angle: ['{지표} {측정값} — 무릎을 기준({기준})보다 {차이} 더 깊게 굽혔어요. 살짝만 굽혔다가 빠르게 펴는 편이 힘이 잘 실립니다.', null, null, '{지표} {측정값} — 무릎을 기준({기준})보다 {차이} 덜 굽혔어요. 조금 더 굽혔다가 펴면서 다리 힘을 공에 실어 보세요.'],
};
const CP = {
  standing_long_jump: [['백스윙을 크게', '백스윙 때 팔이 엉덩이 뒤까지 가야 해요', 'backswing_arm', 40, null], ['도약 전 하체 다운', '도약 직전 무릎을 충분히 굽혀 힘을 모아요', 'pre_knee', 90, 120], ['도약각', '앞으로 40° 안팎으로 날아가요', 'takeoff_angle', 35, 45], ['착지 때 무릎 굽히기', '착지 때 무릎을 굽혀 뒤로 넘어지지 않게 해요', 'landing_knee', null, 130]],
  medicine_ball: [['반동 만들기', '준비 때 몸을 활처럼 젖혀요', 'backswing_hip_angle', 190, 215], ['팔 끝까지 펴기', '공을 놓을 때 팔꿈치를 쭉 펴요', 'release_elbow_angle', 160, 180]],
};

export function seedBase() {
  tx(() => {
    if (!one('SELECT 1 FROM branches')) run(`INSERT INTO branches(name,sort) VALUES(?,0)`, process.env.BRANCH_NAME || '부산교육원');
    if (!one('SELECT 1 FROM exercises')) {
      EXERCISES.forEach(([name, unit, hb, code], i) => {
        const id = Number(run('INSERT INTO exercises(name,unit,higher_better,kind,analysis_code,is_sample,sort,guide) VALUES(?,?,?,?,?,1,?,?)', name, unit, hb, code ? 'video' : 'record', code, i, JSON.stringify(GUIDES[code] || {})).lastInsertRowid);
        run(`INSERT INTO metrics(exercise_id,key,name,unit,moment,description,source,sort) VALUES(?,'record','기록',?,'운동일지에 입력한 기록',?,'record',0)`, id, unit, hb ? '높을수록 좋은 기록' : '낮을수록 좋은 기록');
        if (code) ALGOS[code].metrics.forEach(([key, n, u, moment, d], j) => run(`INSERT INTO metrics(exercise_id,key,name,unit,moment,description,source,sort) VALUES(?,?,?,?,?,?,'video',?)`, id, key, n, u, moment, d, j + 1));
        if (BENCH[code] && !['Z런', '20m 왕복달리기'].includes(name)) {
          run(`INSERT INTO benchmark_sets(exercise_id,version,gender,grade,status,is_sample,vals,note) VALUES(?,1,'all','all','published',1,?,?)`, id, JSON.stringify(BENCH[code]), '예시 값 — 코치진 확정 전');
          run(`INSERT INTO benchmark_sets(exercise_id,version,gender,grade,status,is_sample,vals,note) VALUES(?,2,'F','all','published',1,?,?)`, id, JSON.stringify(BENCH_F[code]), '여학생 기록 예시');
        }
        if (code === 'medicine_ball') for (const [k, [low, ok, near, high]] of Object.entries(TPL_MB)) run(`INSERT INTO feedback_templates(exercise_id,metric_key,low,ok,near,high) VALUES(?,?,?,?,?,?)`, id, k, low, ok || '{지표} {측정값} — 기준 범위({기준}) 안입니다. 좋아요!', near || '{지표} {측정값} — 기준({기준})에 거의 가깝습니다 (차이 {차이}, 허용 오차 안).', high);
        (CP[code] || []).forEach(([n, d, mk, a, b], j) => run('INSERT INTO checkpoints(exercise_id,name,description,metric_key,good_min,good_max,sort) VALUES(?,?,?,?,?,?,?)', id, n, d, mk, a, b, j));
      });
    }
    if (!one('SELECT 1 FROM universities')) {
      const ex = Object.fromEntries(all('SELECT id,name FROM exercises').map(e => [e.name, e.id]));
      const lines = fs.readFileSync(path.join(HERE, 'universities.txt'), 'utf8').split('\n').filter(Boolean);
      for (const l of lines) {
        const [name, dept, exs] = l.split('|');
        const ids = (exs || '').split(',').map(s => ex[s.trim()]).filter(Boolean);
        run(`INSERT INTO universities(name,dept,admission,exercises,is_sample) VALUES(?,?,'수시',?,1)`, name, dept || null, JSON.stringify(ids));
      }
      // 기능 확인용 예시 환산표·배점 (실제 모집요강 아님)
      const u = one(`SELECT * FROM universities WHERE name='부산대학교'`);
      if (u) {
        const ids = JSON.parse(u.exercises); const sc = {};
        for (const i of ids) { const e = one('SELECT * FROM exercises WHERE id=?', i); sc[i] = sampleScoring(e); }
        run(`UPDATE universities SET region='부산', school_max=300, practical_max=?, grade_table=?, scoring=?, memo=? WHERE id=?`, ids.length * 100,
          JSON.stringify({ 5: [[1, 300], [2, 294], [3, 285], [4, 270], [5, 250]], 9: [[1, 300], [2, 297], [3, 294], [4, 290], [5, 285], [6, 278], [7, 268], [8, 255], [9, 240]] }), JSON.stringify(sc), '※ 예시 값입니다. 모집요강을 보고 대학 관리에서 고쳐 주세요.', u.id);
        run('INSERT OR IGNORE INTO cutoffs(university_id,year,cutoff,average,competition,memo) VALUES(?,?,?,?,?,?)', u.id, Number(today().slice(0, 4)), 560, 575, 6.1, '예시');
      }
    }
    if (!one(`SELECT 1 FROM users WHERE role='owner'`)) {
      const email = process.env.ADMIN_EMAIL || 'admin@for10.kr';
      const pw = process.env.ADMIN_PASSWORD || 'for10admin1';
      run(`INSERT INTO users(email,password_hash,name,role,status,branch_id,must_change_pw) VALUES(?,?,?,'owner','approved',(SELECT id FROM branches LIMIT 1),?)`, email, hashPassword(pw), process.env.ADMIN_NAME || '원장', 1);
      console.log(`\n  ▶ 원장 계정을 만들었어요: ${email} / ${pw}\n    처음 로그인하면 비밀번호를 바꾸게 됩니다.\n`);
    }
    if (!getSetting('video_retention_days')) setSetting('video_retention_days', 90);
  });
}
function sampleScoring(e) {
  const mk = (best, step, hb) => Array.from({ length: 10 }, (_, k) => [Math.round((hb ? best - k * step : best + k * step) * 100) / 100, 100 - k * 5]);
  const base = { cm: [300, 5], m: [13, 0.4], 초: [8, 0.15], 회: [70, 3], kg: [200, 8] }[e.unit] || [100, 5];
  const f = { cm: 0.8, m: 0.7, 초: 1.12, 회: 0.85, kg: 0.65 }[e.unit] || 1;
  return { M: mk(base[0], base[1], e.higher_better), F: mk(base[0] * f, base[1] * (e.higher_better ? f : 1.1), e.higher_better) };
}

export function ensureSeed() { seedBase(); }

// ---------- 데모 데이터 ----------
export async function seedDemo() {
  if (one(`SELECT 1 FROM users WHERE email='coach@demo.kr'`)) return console.log('데모 데이터가 이미 있어요.');
  const { longJump, medBall } = await import('../test/synth.js');
  const { analyze } = await import('../public/js/pose/analyze.js');
  const br = one('SELECT id FROM branches').id; const pw = hashPassword('demo1234');
  const t = today();
  tx(() => {
    run(`UPDATE users SET name='김원장', must_change_pw=0 WHERE role='owner'`);
    const coach = Number(run(`INSERT INTO users(email,password_hash,name,phone,role,status,branch_id) VALUES('coach@demo.kr',?,'박코치','010-0000-0001','coach','approved',?)`, pw, br).lastInsertRowid);
    const names = [['이준호', 'M', '고3', '부산체육고'], ['최서연', 'F', '고3', '해운대고'], ['정민재', 'M', '고2', '동래고'], ['한지우', 'F', 'N수', ''], ['오태양', 'M', '고3', '금정고'], ['윤하늘', 'F', '고2', '부산여고']];
    const sids = names.map(([n, g, gr, sc], i) => Number(run(`INSERT INTO users(email,password_hash,name,phone,role,status,branch_id,school,grade,gender,birthday,school_grade,grade_system) VALUES(?,?,?,?,'student','approved',?,?,?,?,?,?,5)`,
      i === 0 ? 'student@demo.kr' : `s${i}@demo.kr`, pw, n, `010-1000-000${i}`, br, sc || null, gr, g, `2008-${String((i % 12) + 1).padStart(2, '0')}-${String(5 + i).padStart(2, '0')}`, [2.3, 1.8, 3.1, 2.7, 2.0, 3.4][i]).lastInsertRowid));
    const parent = Number(run(`INSERT INTO users(email,password_hash,name,role,status,branch_id) VALUES('parent@demo.kr',?,'이준호 학부모','parent','approved',?)`, pw, br).lastInsertRowid);
    run(`INSERT INTO parent_links(parent_id,student_id,status) VALUES(?,?,'approved')`, parent, sids[0]);
    run(`INSERT INTO users(email,password_hash,name,role,status,branch_id,school,grade,gender) VALUES('new@demo.kr',?,'신입생','student','pending',?,'부산고','고2','M')`, pw, br);
    const c1 = Number(run(`INSERT INTO classes(name,branch_id,days,start_time,end_time,start_date) VALUES('월수금 저녁반',?,'1,3,5','18:00','21:00',?)`, br, addDays(t, -40)).lastInsertRowid);
    const c2 = Number(run(`INSERT INTO classes(name,branch_id,days,start_time,end_time,start_date) VALUES('화목토 실기반',?,'2,4,6','17:00','20:00',?)`, br, addDays(t, -40)).lastInsertRowid);
    for (const c of [c1, c2]) run('INSERT INTO class_coaches VALUES(?,?)', c, coach);
    sids.forEach((s, i) => { run('INSERT INTO class_students VALUES(?,?)', i % 2 ? c2 : c1, s); if (i < 2) run('INSERT OR IGNORE INTO class_students VALUES(?,?)', i % 2 ? c1 : c2, s); });
  });
  const { ensureSessions } = await import('../lib/services.js');
  ensureSessions(addDays(t, -30), t);
  const ses = all('SELECT * FROM class_sessions WHERE date<? ORDER BY date', t);
  const st = ['present', 'present', 'present', 'present', 'late', 'absent', 'present', 'excused'];
  const studs = all(`SELECT id FROM users WHERE role='student' AND status='approved'`).map(r => r.id);
  const owner = one(`SELECT id FROM users WHERE role='owner'`).id;
  tx(() => {
    let k = 0;
    for (const s of ses) for (const r of all('SELECT user_id FROM class_students WHERE class_id=?', s.class_id)) run('INSERT OR IGNORE INTO attendance(session_id,student_id,status,checked_by) VALUES(?,?,?,?)', s.id, r.user_id, st[(k++ * 7 + r.user_id) % st.length], owner);
    const ex = Object.fromEntries(all('SELECT id,name FROM exercises').map(e => [e.name, e.id]));
    studs.forEach((sid, i) => {
      for (let d = 20; d >= 1; d -= 1 + (i % 3)) {
        const date = addDays(t, -d);
        const lid = Number(run('INSERT OR IGNORE INTO logs(student_id,date,condition,sleep_hours,pain) VALUES(?,?,?,?,?)', sid, date, 3 + ((d + i) % 3), 6 + (d % 3), d % 7 === 0 ? '오른쪽 발목 살짝' : '없음').lastInsertRowid);
        if (!lid) continue;
        run('INSERT INTO log_items(log_id,exercise_id,record,memo) VALUES(?,?,?,?)', lid, ex['제자리멀리뛰기'], Math.round(240 + i * 8 + (20 - d) * 1.5 + (d % 4)), '팔치기 연습');
        run('INSERT INTO log_items(log_id,exercise_id,record,memo) VALUES(?,?,?,?)', lid, ex['10m 왕복달리기'], Math.round((9.6 - i * 0.1 - (20 - d) * 0.02) * 100) / 100, null);
      }
      const ym = t.slice(0, 7);
      run('INSERT OR IGNORE INTO monthly_tests(month,exercise_id,student_id,record) VALUES(?,?,?,?)', ym, ex['제자리멀리뛰기'], sid, 250 + ((i * 13) % 45));
    });
    const lj = longJump(), mb = medBall();
    const addVid = (sid, exName, code, pose, rec, daysAgo) => {
      const vid = Number(run(`INSERT INTO videos(student_id,exercise_id,record,status,created_at,expires_at) VALUES(?,?,?,'done',datetime('now',?),datetime('now','+80 days'))`, sid, ex[exName], rec, `-${daysAgo} days`).lastInsertRowid);
      run('INSERT INTO video_pose(video_id,fps,width,height,frames) VALUES(?,?,?,?,?)', vid, pose.fps, pose.width, pose.height, JSON.stringify(pose.frames));
      const r = analyze(code, pose);
      run(`INSERT INTO video_analyses(video_id,kind,key_frames,metrics,algo) VALUES(?,'auto',?,?,?)`, vid, JSON.stringify(r.keyFrames), JSON.stringify(r.metrics), r.algo);
      run('UPDATE videos SET confidence=? WHERE id=?', r.confidence, vid);
      return vid;
    };
    addVid(studs[0], '제자리멀리뛰기', 'standing_long_jump', lj, 268, 3);
    const v2 = addVid(studs[0], '제자리멀리뛰기', 'standing_long_jump', lj, 274, 1);
    addVid(studs[0], '메디신볼 던지기', 'medicine_ball', mb, 11.2, 0);
    run(`INSERT INTO comments(target_type,target_id,author_id,body) VALUES('video',?,?,?)`, v2, owner, '도약각 좋아요! 착지 때 무릎을 조금 더 굽혀서 뒤로 앉지 않게 해 봅시다.');
    run(`INSERT INTO events(kind,title,start_date,end_date,memo,created_by) VALUES('test',?,?,?,?,?)`, '월말 실기 테스트 (제멀·10m)', addDays(t, 5), addDays(t, 5), '오후 2시 · 운동화 준비', owner);
    run(`INSERT INTO events(kind,title,start_date,end_date,created_by) VALUES('event',?,?,?,?)`, '수시 실기고사 대비 특강', addDays(t, 12), addDays(t, 13), owner);
    const pnu = one(`SELECT id FROM universities WHERE name='부산대학교'`);
    if (pnu) run('INSERT INTO target_universities(student_id,university_id,rank,year) VALUES(?,?,1,?)', studs[0], pnu.id, Number(t.slice(0, 4)) + 1);
    const ks = one(`SELECT id FROM universities WHERE name='경성대학교'`); if (ks) run('INSERT INTO target_universities(student_id,university_id,rank,year) VALUES(?,?,2,?)', studs[0], ks.id, Number(t.slice(0, 4)) + 1);
  });
  console.log('데모 데이터를 넣었어요. 비밀번호는 모두 demo1234 (원장은 처음 만든 비밀번호)\n  강사 coach@demo.kr · 학생 student@demo.kr · 학부모 parent@demo.kr');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seedBase();
  if (process.argv.includes('--demo')) await seedDemo();
}
