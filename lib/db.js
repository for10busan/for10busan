// SQLite (Node 22 built-in). 데이터 파일 위치: DATA_DIR (기본 ./data)
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner','vice','coach','student','parent')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  school TEXT, grade TEXT, gender TEXT, birthday TEXT,
  attend_days TEXT DEFAULT '',
  school_grade REAL, grade_system INTEGER DEFAULT 5,
  must_change_pw INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS consents (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, agreed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  days TEXT NOT NULL DEFAULT '', start_time TEXT, end_time TEXT,
  start_date TEXT NOT NULL, end_date TEXT, memo TEXT, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS class_coaches (
  class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (class_id, user_id)
);
CREATE TABLE IF NOT EXISTS class_students (
  class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (class_id, user_id)
);
CREATE TABLE IF NOT EXISTS class_sessions (
  id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  date TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'regular', canceled INTEGER NOT NULL DEFAULT 0,
  UNIQUE (class_id, date, kind)
);
CREATE TABLE IF NOT EXISTS attendance (
  session_id INTEGER REFERENCES class_sessions(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('present','late','absent','excused')),
  memo TEXT, checked_by INTEGER, updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, student_id)
);
CREATE TABLE IF NOT EXISTS staff_attendance (
  date TEXT NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('present','absent')), reason TEXT,
  updated_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (date, user_id)
);
CREATE TABLE IF NOT EXISTS exercises (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, unit TEXT NOT NULL,
  higher_better INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL DEFAULT 'record' CHECK (kind IN ('record','video')),
  analysis_code TEXT, description TEXT, active INTEGER NOT NULL DEFAULT 1,
  is_sample INTEGER NOT NULL DEFAULT 1, sort INTEGER DEFAULT 0,
  guide TEXT DEFAULT '{}', guide_photos TEXT DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY, exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  key TEXT NOT NULL, name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '°',
  moment TEXT, description TEXT, enabled INTEGER NOT NULL DEFAULT 1, sort INTEGER DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'video' CHECK (source IN ('video','record','manual')),
  higher_better INTEGER, UNIQUE (exercise_id, key)
);
CREATE TABLE IF NOT EXISTS benchmark_sets (
  id INTEGER PRIMARY KEY, exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, gender TEXT NOT NULL DEFAULT 'all', grade TEXT NOT NULL DEFAULT 'all',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  is_sample INTEGER NOT NULL DEFAULT 1, note TEXT, vals TEXT NOT NULL DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS feedback_templates (
  exercise_id INTEGER REFERENCES exercises(id) ON DELETE CASCADE, metric_key TEXT NOT NULL,
  low TEXT, ok TEXT, near TEXT, high TEXT, PRIMARY KEY (exercise_id, metric_key)
);
CREATE TABLE IF NOT EXISTS checkpoints (
  id INTEGER PRIMARY KEY, exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT, metric_key TEXT, good_min REAL, good_max REAL, sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL, condition INTEGER, sleep_hours REAL, pain TEXT, memo TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (student_id, date)
);
CREATE TABLE IF NOT EXISTS log_items (
  id INTEGER PRIMARY KEY, log_id INTEGER NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  exercise_id INTEGER REFERENCES exercises(id) ON DELETE SET NULL, record REAL, memo TEXT,
  extra TEXT DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY, target_type TEXT NOT NULL, target_id INTEGER NOT NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL, body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  record REAL, file TEXT, mime TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','analyzing','done','failed')),
  error TEXT, confidence REAL, reviewed_by INTEGER, reviewed_at TEXT, corrected INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT
);
CREATE TABLE IF NOT EXISTS video_pose (
  video_id INTEGER PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  fps REAL, width INTEGER, height INTEGER, frames TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS video_analyses (
  id INTEGER PRIMARY KEY, video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'auto', author_id INTEGER, key_frames TEXT DEFAULT '{}',
  metrics TEXT DEFAULT '{}', algo TEXT, is_current INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS checkpoint_marks (
  video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
  checkpoint_id INTEGER REFERENCES checkpoints(id) ON DELETE CASCADE,
  value TEXT NOT NULL CHECK (value IN ('good','bad')), author_id INTEGER,
  PRIMARY KEY (video_id, checkpoint_id)
);
CREATE TABLE IF NOT EXISTS parent_links (
  id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (parent_id, student_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT, title TEXT NOT NULL, body TEXT, link TEXT, read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL,
  in_app INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (user_id, type)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'test', title TEXT NOT NULL,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  branch_id INTEGER REFERENCES branches(id) ON DELETE CASCADE, memo TEXT, created_by INTEGER
);
CREATE TABLE IF NOT EXISTS universities (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, dept TEXT, admission TEXT NOT NULL DEFAULT '수시',
  track TEXT, region TEXT, memo TEXT, exercises TEXT NOT NULL DEFAULT '[]',
  school_max REAL, grade_table TEXT DEFAULT '{}', practical_max REAL,
  scoring TEXT DEFAULT '{}', is_sample INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS target_universities (
  student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  university_id INTEGER REFERENCES universities(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL, year INTEGER, PRIMARY KEY (student_id, rank)
);
CREATE TABLE IF NOT EXISTS cutoffs (
  id INTEGER PRIMARY KEY, university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  year INTEGER NOT NULL, cutoff REAL NOT NULL, average REAL, competition REAL, memo TEXT,
  UNIQUE (university_id, year)
);
CREATE TABLE IF NOT EXISTS monthly_tests (
  month TEXT NOT NULL, exercise_id INTEGER REFERENCES exercises(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES users(id) ON DELETE CASCADE, record REAL NOT NULL,
  PRIMARY KEY (month, exercise_id, student_id)
);
CREATE TABLE IF NOT EXISTS mock_exams (
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL, name TEXT NOT NULL, scores TEXT NOT NULL DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_sessions_class_date ON class_sessions(class_id, date);
CREATE INDEX IF NOT EXISTS idx_logs_student ON logs(student_id, date);
CREATE INDEX IF NOT EXISTS idx_videos_student ON videos(student_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);
`;
db.exec(SCHEMA);

// ---------- 마이그레이션: 기존 DB에 새 칸 추가 ----------
function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('users', 'username', 'TEXT');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE) WHERE username IS NOT NULL`);
addColumn('logs', 'reviewed_by', 'INTEGER');
addColumn('logs', 'reviewed_at', 'TEXT');
addColumn('cutoffs', 'final', 'REAL');           // 예비합(최종) 커트라인
// 대학(전형) 상세 정보 — K:컨설팅 학교 시트
for (const [c, d] of [
  ['city', 'TEXT'], ['founding', 'TEXT'], ['track_type', 'TEXT'], ['quota', 'INTEGER'], ['stage', 'TEXT'],
  ['school_ratio', 'REAL'], ['practical_ratio', 'REAL'], ['suneung_ratio', 'REAL'], ['suneung_max', 'REAL'], ['suneung_min', 'TEXT'],
  ['practical_date', 'TEXT'], ['interview_date', 'TEXT'], ['year_weights', 'TEXT'], ['subjects', 'TEXT'], ['subject_weights', 'TEXT'],
  ['subject_scope', 'TEXT'], ['teacher_cert', 'INTEGER DEFAULT 0'], ['has_practical', 'INTEGER DEFAULT 1'], ['changes', 'TEXT'],
  ['field_notes', "TEXT DEFAULT '{}'"], ['step_points', 'REAL'], ['prev_scoring', "TEXT DEFAULT '{}'"], ['prev_year', 'INTEGER'],
]) addColumn('universities', c, d);
db.exec(`
CREATE TABLE IF NOT EXISTS exam_tables (
  year INTEGER NOT NULL, exam TEXT NOT NULL, subject TEXT NOT NULL, rows TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (year, exam, subject)
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  year INTEGER NOT NULL, slot INTEGER NOT NULL, records TEXT DEFAULT '{}', school_score REAL, practical_score REAL, total REAL,
  final INTEGER DEFAULT 0, result TEXT, memo TEXT, updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE (student_id, year, slot)
);`);

// --- 작은 헬퍼 ---
export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
export const J = (s, d = {}) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
export function getSetting(k, d = null) { const r = one('SELECT value FROM settings WHERE key=?', k); return r ? r.value : d; }
export function setSetting(k, v) { run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v)); }
