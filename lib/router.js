import { isStaff } from './util.js';

const routes = [];
// guard: 'public' | 'user'(승인된 모든 사용자) | 'staff' | 'student' | 'parent' | 'any'(로그인만)
export function route(method, pattern, guard, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, guard, handler });
}
export const get = (p, g, h) => route('GET', p, g, h);
export const post = (p, g, h) => route('POST', p, g, h);
export const put = (p, g, h) => route('PUT', p, g, h);

export function match(method, pathname) {
  for (const r of routes) {
    if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
    const m = r.re.exec(pathname);
    if (m) return { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export function allowed(guard, u) {
  if (guard === 'public') return true;
  if (!u) return false;
  if (guard === 'any') return true;
  if (u.status !== 'approved') return false;
  if (guard === 'user') return true;
  if (guard === 'staff') return isStaff(u);
  if (guard === 'student') return u.role === 'student';
  if (guard === 'parent') return u.role === 'parent';
  return false;
}

export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
export const notFound = (m = '찾을 수 없는 페이지입니다') => { throw new HttpError(404, m); };
export const forbidden = (m = '권한이 없습니다') => { throw new HttpError(403, m); };
export const bad = m => { throw new HttpError(400, m); };
