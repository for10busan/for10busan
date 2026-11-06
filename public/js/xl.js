// 엑셀 수식 계산기 — 2026 정시 상담 엑셀의 수식을 그대로 계산 (서버·브라우저 공용, 의존성 없음)
// 지원: 숫자·문자·참조·범위·비교·사칙·& / IF·VLOOKUP·SUM·MAX·MIN·AVERAGE·LARGE·SMALL·AND·OR·NOT·ROUND·ROUNDDOWN·ROUNDUP·ABS·IFERROR·INDEX·MATCH·COUNT·COUNTA
export class XlErr { constructor(code) { this.code = code; } toString() { return this.code; } }
const E = c => new XlErr(c);
const isErr = v => v instanceof XlErr;
const ERRS = new Set(['#N/A', '#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#NUM!', '#NULL!']);

export function colNum(s) { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
export function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }

// ---------- 토큰 · 구문 ----------
function tokenize(f) {
  const out = []; let i = 0;
  while (i < f.length) {
    const ch = f[i];
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') { i++; continue; }
    if (ch === '"') { let j = i + 1, s = ''; for (;;) { if (j >= f.length) break; if (f[j] === '"') { if (f[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += f[j++]; } out.push({ t: 'str', v: s }); i = j + 1; continue; }
    if (ch === '#') { const m = f.slice(i).match(/^#(REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!)/); if (m) { out.push({ t: 'err', v: m[0] }); i += m[0].length; if (f[i] === '!') i++; continue; } }
    const two = f.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/^&=<>%'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue; }
    if (ch === '(' || ch === ')' || ch === ',') { out.push({ t: ch }); i++; continue; }
    const rest = f.slice(i);
    const fn = rest.match(/^([A-Z][A-Z0-9.]*)\(/);
    if (fn) { out.push({ t: 'fn', v: fn[1] }); i += fn[1].length; continue; }
    const sh = rest.match(/^(?:'((?:[^']|'')+)'|([^\s'!=(),:;&<>+\-*/^"%]+))!/);
    const cellAt = (str) => str.match(/^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/);
    if (sh) {
      const m = cellAt(rest.slice(sh[0].length));
      if (!m) throw new Error('참조를 읽지 못했어요: ' + rest.slice(0, 30));
      out.push({ t: 'ref', s: sh[1] != null ? sh[1].replace(/''/g, "'") : sh[2], c1: colNum(m[1]), r1: +m[2], c2: colNum(m[3] || m[1]), r2: +(m[4] || m[2]), rng: !!m[3] });
      i += sh[0].length + m[0].length; continue;
    }
    const m = cellAt(rest);
    if (m) { out.push({ t: 'ref', s: null, c1: colNum(m[1]), r1: +m[2], c2: colNum(m[3] || m[1]), r2: +(m[4] || m[2]), rng: !!m[3] }); i += m[0].length; continue; }
    const bo = rest.match(/^(TRUE|FALSE)\b/);
    if (bo) { out.push({ t: 'bool', v: bo[1] === 'TRUE' }); i += bo[1].length; continue; }
    const num = rest.match(/^\d+(\.\d+)?([eE][+-]?\d+)?|^\.\d+/);
    if (num) { out.push({ t: 'num', v: +num[0] }); i += num[0].length; continue; }
    throw new Error('수식을 읽지 못했어요: ' + f.slice(i, i + 20));
  }
  return out;
}
function parse(f) {
  const T = tokenize(f); let p = 0;
  const peek = () => T[p]; const next = () => T[p++];
  const isOp = (...ops) => peek() && peek().t === 'op' && ops.includes(peek().v);
  function cmp() { let a = cat(); while (isOp('=', '<>', '<', '>', '<=', '>=')) { const op = next().v; a = { k: 'bin', op, a, b: cat() }; } return a; }
  function cat() { let a = add(); while (isOp('&')) { next(); a = { k: 'bin', op: '&', a, b: add() }; } return a; }
  function add() { let a = mul(); while (isOp('+', '-')) { const op = next().v; a = { k: 'bin', op, a, b: mul() }; } return a; }
  function mul() { let a = pow(); while (isOp('*', '/')) { const op = next().v; a = { k: 'bin', op, a, b: pow() }; } return a; }
  function pow() { let a = un(); while (isOp('^')) { next(); a = { k: 'bin', op: '^', a, b: un() }; } return a; }
  function un() { if (isOp('-')) { next(); return { k: 'neg', a: un() }; } if (isOp('+')) { next(); return un(); } let a = prim(); while (isOp('%')) { next(); a = { k: 'bin', op: '/', a, b: { k: 'num', v: 100 } }; } return a; }
  function prim() {
    const t = next();
    if (!t) throw new Error('수식이 끝났어요');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'bool') return { k: 'bool', v: t.v };
    if (t.t === 'err') return { k: 'err', v: t.v };
    if (t.t === 'ref') return { k: t.rng ? 'rng' : 'ref', s: t.s, c1: t.c1, r1: t.r1, c2: t.c2, r2: t.r2 };
    if (t.t === '(') { const a = cmp(); if (next()?.t !== ')') throw new Error('괄호'); return a; }
    if (t.t === 'fn') {
      if (next()?.t !== '(') throw new Error('함수');
      const args = [];
      if (peek()?.t === ')') { next(); return { k: 'fn', n: t.v, args }; }
      for (;;) {
        if (peek()?.t === ',' || peek()?.t === ')') args.push({ k: 'blank' }); else args.push(cmp());
        const s = next(); if (s?.t === ')') break; if (s?.t !== ',') throw new Error('함수 인자');
      }
      return { k: 'fn', n: t.v, args };
    }
    throw new Error('알 수 없는 토큰 ' + JSON.stringify(t));
  }
  const ast = cmp(); if (p < T.length) throw new Error('남은 글자: ' + JSON.stringify(T[p]));
  return ast;
}
const astCache = new Map();
export function compile(f) { let a = astCache.get(f); if (!a) { a = parse(f); astCache.set(f, a); } return a; }

// ---------- 값 규칙 (엑셀과 같게) ----------
const toNum = v => { if (isErr(v)) return v; if (v == null || v === '') return v === '' ? E('#VALUE!') : 0; if (typeof v === 'number') return v; if (typeof v === 'boolean') return v ? 1 : 0; const n = Number(String(v).trim()); return String(v).trim() !== '' && Number.isFinite(n) ? n : E('#VALUE!'); };
const toBool = v => { if (isErr(v)) return v; if (v == null) return false; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v !== 0; const s = String(v).toUpperCase(); if (s === 'TRUE') return true; if (s === 'FALSE') return false; return E('#VALUE!'); };
const toStr = v => (v == null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : typeof v === 'number' ? String(+v.toPrecision(15)) : String(v));
function compare(a, b) { // -1 0 1, 엑셀 순서: 숫자 < 문자 < 논리
  if (a == null && b == null) return 0;
  if (a == null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b == null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const rank = v => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) < rank(b) ? -1 : 1;
  if (typeof a === 'string') { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  if (typeof a === 'boolean') return a === b ? 0 : a ? 1 : -1;
  return a < b ? -1 : a > b ? 1 : 0;
}
const eqLookup = (a, b) => { if (a == null || b == null) return false; if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9; if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase(); return a === b; };

// ---------- 계산 ----------
// book: { consts:{시트:{A1:값}}, dyn:{시트:{row, forms:{열: 수식|{v}}}}, inputs:{시트:{열:값}}, vs:{sheet,row} }
export function makeBook({ consts, dyn, vs }) {
  const inputs = {}; const memo = new Map(); const busy = new Set();
  const constVal = (s, c, r) => { const v = consts[s]?.[colName(c) + r]; if (typeof v === 'string' && ERRS.has(v)) return E(v); return v ?? null; };
  function get(s, c, r) {
    const d = dyn[s];
    if (d && r === d.row) {
      const L = colName(c);
      if (inputs[s] && L in inputs[s]) { const v = inputs[s][L]; return v === '' ? null : v; }
      const key = s + '!' + L; if (memo.has(key)) return memo.get(key);
      const f = d.forms[L];
      let v = null;
      if (f == null) v = null;
      else if (typeof f === 'object') v = f.v ?? null;
      else {
        if (busy.has(key)) return E('#REF!');
        busy.add(key);
        try { v = ev(compile(f), s); } catch (e) { v = E('#NAME?'); }
        busy.delete(key);
      }
      if (typeof v === 'string' && ERRS.has(v)) v = E(v);
      memo.set(key, v); return v;
    }
    return constVal(s, c, r);
  }
  function cellsOf(n, here) { const s = n.s ?? here; const out = []; for (let r = n.r1; r <= n.r2; r++) for (let c = n.c1; c <= n.c2; c++) out.push(get(s, c, r)); return out; }
  function argVals(args, here) { // 함수 인자 펼치기: 범위는 숫자만, 직접 값은 숫자로
    const out = [];
    for (const a of args) {
      if (a.k === 'rng' || a.k === 'ref') { for (const v of cellsOf(a, here)) { if (isErr(v)) return v; if (typeof v === 'number') out.push(v); } }
      else { const v = toNum(ev(a, here)); if (isErr(v)) return v; out.push(v); }
    }
    return out;
  }
  function vlookup(args, here) {
    const key = ev(args[0], here); if (isErr(key)) return key;
    const R = args[1]; if (R.k !== 'rng' && R.k !== 'ref') return E('#REF!');
    const k = toNum(ev(args[2], here)); if (isErr(k)) return k;
    const exact = args[3] && args[3].k !== 'blank' ? !toBool(ev(args[3], here)) : false;
    const s = R.s ?? here; const col = R.c1 + Math.trunc(k) - 1;
    if (k < 1 || col > R.c2) return E('#REF!');
    if (vs && s === vs.sheet && here !== vs.sheet && R.r1 <= vs.row && vs.row <= R.r2) { // 학생 성적 줄
      if (key == null || key === '' || key === 0) return E('#N/A');
      const v = get(s, col, vs.row); return v == null ? 0 : v;
    }
    const kk = key == null ? 0 : key; // 빈 칸으로 찾으면 0으로 찾음 (엑셀과 같게)
    let hit = -1;
    if (exact) { for (let r = R.r1; r <= R.r2; r++) if (eqLookup(get(s, R.c1, r), kk)) { hit = r; break; } }
    else { for (let r = R.r1; r <= R.r2; r++) { const v = get(s, R.c1, r); if (v == null) continue; if (compare(v, kk) <= 0 && (typeof v === typeof kk)) hit = r; else if (compare(v, kk) > 0) break; } }
    if (hit < 0) return E('#N/A');
    const v = get(s, col, hit); return v == null ? 0 : v;
  }
  function ev(n, here) {
    switch (n.k) {
      case 'num': case 'str': case 'bool': return n.v;
      case 'err': return E(n.v);
      case 'blank': return null;
      case 'ref': return get(n.s ?? here, n.c1, n.r1);
      case 'rng': return n.r1 === n.r2 && n.c1 === n.c2 ? get(n.s ?? here, n.c1, n.r1) : E('#VALUE!');
      case 'neg': { const v = toNum(ev(n.a, here)); return isErr(v) ? v : -v; }
      case 'bin': {
        const a = ev(n.a, here); if (isErr(a)) return a; const b = ev(n.b, here); if (isErr(b)) return b;
        if (n.op === '&') return toStr(a) + toStr(b);
        if (['=', '<>', '<', '>', '<=', '>='].includes(n.op)) { const c = compare(a, b); return n.op === '=' ? c === 0 : n.op === '<>' ? c !== 0 : n.op === '<' ? c < 0 : n.op === '>' ? c > 0 : n.op === '<=' ? c <= 0 : c >= 0; }
        const x = toNum(a); if (isErr(x)) return x; const y = toNum(b); if (isErr(y)) return y;
        if (n.op === '+') return x + y; if (n.op === '-') return x - y; if (n.op === '*') return x * y;
        if (n.op === '/') return y === 0 ? E('#DIV/0!') : x / y; if (n.op === '^') return Math.pow(x, y);
        return E('#VALUE!');
      }
      case 'fn': return fn(n.n, n.args, here);
    }
    return E('#VALUE!');
  }
  function fn(name, args, here) {
    switch (name) {
      case 'IF': { const c = toBool(ev(args[0], here)); if (isErr(c)) return c; if (c) return args[1] ? (args[1].k === 'blank' ? 0 : ev(args[1], here)) : true; return args[2] ? (args[2].k === 'blank' ? 0 : ev(args[2], here)) : false; }
      case 'IFERROR': { const v = ev(args[0], here); return isErr(v) ? ev(args[1], here) : v; }
      case 'VLOOKUP': return vlookup(args, here);
      case 'SUM': { const v = argVals(args, here); return isErr(v) ? v : v.reduce((a, b) => a + b, 0); }
      case 'MAX': { const v = argVals(args, here); return isErr(v) ? v : v.length ? Math.max(...v) : 0; }
      case 'MIN': { const v = argVals(args, here); return isErr(v) ? v : v.length ? Math.min(...v) : 0; }
      case 'AVERAGE': { const v = argVals(args, here); return isErr(v) ? v : v.length ? v.reduce((a, b) => a + b, 0) / v.length : E('#DIV/0!'); }
      case 'COUNT': { const v = argVals(args, here); return isErr(v) ? v : v.length; }
      case 'COUNTA': { let n = 0; for (const a of args) { if (a.k === 'rng' || a.k === 'ref') n += cellsOf(a, here).filter(v => v != null && v !== '').length; else n++; } return n; }
      case 'LARGE': case 'SMALL': { const v = argVals([args[0]], here); if (isErr(v)) return v; const k = toNum(ev(args[1], here)); if (isErr(k)) return k; const s = [...v].sort((a, b) => (name === 'LARGE' ? b - a : a - b)); return k >= 1 && k <= s.length ? s[Math.ceil(k) - 1] : E('#NUM!'); }
      case 'AND': case 'OR': { const vs2 = []; for (const a of args) { if (a.k === 'rng') { for (const v of cellsOf(a, here)) if (v != null && typeof v !== 'string') vs2.push(toBool(v)); } else vs2.push(toBool(ev(a, here))); } const e = vs2.find(isErr); if (e) return e; return name === 'AND' ? vs2.every(Boolean) : vs2.some(Boolean); }
      case 'NOT': { const v = toBool(ev(args[0], here)); return isErr(v) ? v : !v; }
      case 'ABS': { const v = toNum(ev(args[0], here)); return isErr(v) ? v : Math.abs(v); }
      case 'ROUND': case 'ROUNDDOWN': case 'ROUNDUP': case 'TRUNC': {
        const v = toNum(ev(args[0], here)); if (isErr(v)) return v; const d = args[1] ? toNum(ev(args[1], here)) : 0; if (isErr(d)) return d;
        const m = Math.pow(10, d); const x = v * m; const r = name === 'ROUND' ? Math.sign(x) * Math.round(Math.abs(x) + 1e-9) : name === 'ROUNDUP' ? Math.sign(x) * Math.ceil(Math.abs(x) - 1e-9) : Math.sign(x) * Math.floor(Math.abs(x) + 1e-9);
        return r / m;
      }
      case 'INDEX': { const R = args[0]; const r = toNum(ev(args[1], here)); const c = args[2] ? toNum(ev(args[2], here)) : 1; if (isErr(r) || isErr(c)) return E('#VALUE!'); const v = get(R.s ?? here, R.c1 + c - 1, R.r1 + r - 1); return v == null ? 0 : v; }
      case 'MATCH': { const key = ev(args[0], here); const R = args[1]; const cells = cellsOf(R, here); const t = args[2] ? toNum(ev(args[2], here)) : 1; if (t === 0) { const i = cells.findIndex(v => eqLookup(v, key)); return i < 0 ? E('#N/A') : i + 1; } let hit = -1; cells.forEach((v, i) => { if (v != null && (t > 0 ? compare(v, key) <= 0 : compare(v, key) >= 0)) hit = i; }); return hit < 0 ? E('#N/A') : hit + 1; }
    }
    return E('#NAME?');
  }
  return {
    get, ev,
    set(sheet, vals) { inputs[sheet] = { ...(inputs[sheet] || {}), ...vals }; memo.clear(); },
    clearInputs(sheet) { delete inputs[sheet]; memo.clear(); },
    cell(sheet, addr) { const m = addr.match(/^([A-Z]+)(\d+)$/); return get(sheet, colNum(m[1]), +m[2]); },
  };
}
export const isError = isErr;
export const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
