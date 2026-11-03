import crypto from 'node:crypto';
import { one, run, getSetting, setSetting } from './db.js';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
export function verifyPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(pw, salt, 64);
  const want = Buffer.from(hash, 'hex');
  return want.length === calc.length && crypto.timingSafeEqual(calc, want);
}
export function passwordProblem(pw) {
  if (!pw || pw.length < 8) return '비밀번호는 8자 이상이어야 해요.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '영문과 숫자를 함께 써 주세요.';
  return null;
}

const DAYS = 30;
export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const exp = new Date(Date.now() + DAYS * 864e5).toISOString();
  run('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)', token, userId, exp);
  return token;
}
export function sessionUser(token) {
  if (!token) return null;
  const s = one('SELECT * FROM sessions WHERE token=?', token);
  if (!s) return null;
  if (s.expires_at < new Date().toISOString()) { run('DELETE FROM sessions WHERE token=?', token); return null; }
  return one('SELECT * FROM users WHERE id=?', s.user_id) || null;
}
export function destroySession(token) { if (token) run('DELETE FROM sessions WHERE token=?', token); }
export const COOKIE = 'f10s';
export function sessionCookie(token, secure) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}${secure ? '; Secure' : ''}`;
}
export function clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`; }

// CSRF: 세션 토큰에서 파생한 값(폼 hidden 필드)
const SECRET = process.env.APP_SECRET || getSetting('secret') || (() => { const s = crypto.randomBytes(32).toString('hex'); setSetting('secret', s); return s; })();
export function csrfFor(token) { return crypto.createHmac('sha256', SECRET).update('csrf:' + (token || '')).digest('base64url').slice(0, 32); }
