#!/usr/bin/env python3
"""2026 정시 상담 엑셀 → 앱에 올릴 계산 자료(JSON) 만들기.

엑셀의 학교별 시트(상담 학생 줄)와 수능성적기입(학생 줄) 수식을 그대로 옮기고,
수식이 참조하는 상수(변환표·영어/한국사 점수·실기 배점표 등)만 함께 담는다.
학생 이름·성적 같은 개인 자료는 담지 않는다(표본 줄만).

사용: python3 scripts/j26-extract.py 엑셀.xlsx 결과.json
결과 JSON은 GitHub에 올리지 말고, 앱의 'K:컨설팅 → 2026 정시 → 자료 올리기'로 올린다.
"""
import sys, re, json, warnings
warnings.filterwarnings('ignore')
import openpyxl
from openpyxl.utils import column_index_from_string as ci, get_column_letter as cl

SRC, OUT = sys.argv[1], sys.argv[2]
wf = openpyxl.load_workbook(SRC)                  # 수식
wv = openpyxl.load_workbook(SRC, data_only=True)  # 저장된 값

VS = '수능성적기입'          # 학생 성적 시트 (가상 학생 줄로 계산)
VROW = 37                    # 수식 본보기로 쓸 줄 (표본 '백88' 줄)
NAME = '학생'

TOK = re.compile(r'"(?:[^"]|"")*"|(?:\'(?:[^\']|\'\')+\'|[^\s\'!=(),:;&<>+\-*/^"%$]+)!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?|\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?')

def refs(f, here):
    """수식 안의 참조 [(시트, c1, r1, c2, r2)]. 문자열 안은 건너뜀."""
    out = []
    for m in TOK.finditer(f):
        t = m.group(0)
        if t.startswith('"'): continue
        sheet = here
        if '!' in t:
            s, t = t.rsplit('!', 1)
            sheet = s[1:-1].replace("''", "'") if s.startswith("'") else s
        a, _, b = t.partition(':')
        b = b or a
        pa = re.match(r'\$?([A-Z]+)\$?(\d+)', a); pb = re.match(r'\$?([A-Z]+)\$?(\d+)', b)
        # 함수 이름(예: LOG10) 오인 방지: 바로 뒤가 '(' 이면 건너뜀
        if f[m.end():m.end() + 1] == '(': continue
        out.append((sheet, ci(pa.group(1)), int(pa.group(2)), ci(pb.group(1)), int(pb.group(2))))
    return out

def val(sheet, c, r):
    v = wv[sheet].cell(r, c).value
    if hasattr(v, 'isoformat'): v = v.isoformat()[:10]
    return v

consts = {}   # 시트 → {주소: 값}
def keep(sheet, c, r):
    v = val(sheet, c, r)
    if v is None: return
    consts.setdefault(sheet, {})[f'{cl(c)}{r}'] = v

def dyn_row(sheet, row, drop_literals=True, keep_cols=()):
    """한 줄의 수식(동적 칸). 글자로 적힌 칸은 입력(기본값 없음)으로 본다."""
    out = {}
    for cell in wf[sheet][row]:
        v = cell.value
        if isinstance(v, str) and v.startswith('='):
            out[cell.column_letter] = v[1:]
        elif v is not None and (not drop_literals or cell.column_letter in keep_cols):
            out[cell.column_letter] = {'v': v}
    return out

def close(sheet, row, forms):
    """수식이 참조하는 상수를 모은다 (같은 줄은 동적, 수능성적기입은 가상 학생 줄)."""
    for f in forms.values():
        if not isinstance(f, str): continue
        for (s, c1, r1, c2, r2) in refs(f, sheet):
            if s not in wv.sheetnames:
                continue
            if s == VS and sheet != VS and r1 <= VROW <= r2:
                continue  # 학생 줄 VLOOKUP → 가상 줄
            for r in range(r1, r2 + 1):
                for c in range(c1, c2 + 1):
                    if s == sheet and r == row: continue
                    if s == VS and r == VROW: continue
                    if s == '홈베이스' and (c, r) == (2, 8):
                        consts.setdefault(s, {})['B8'] = NAME; continue
                    keep(s, c, r)

def num(v):
    try: return float(v)
    except (TypeError, ValueError): return None

# ---------- 학생 성적 줄 (수능성적기입) ----------
vs_forms = dyn_row(VS, VROW)
close(VS, VROW, vs_forms)

# 표본 (등급·백분위 표본만, 개인 자료 제외)
samples = []
inp_cols = ['D', 'G', 'H', 'L', 'M', 'R', 'V', 'W', 'AA', 'AB', 'AF', 'AG', 'AK', 'AM', 'AN']
for r in range(8, 50):
    n = wv[VS].cell(r, 3).value
    if not isinstance(n, str) or not re.match(r'^(만점자|\d등급[상중하]?|백\d+)$', n): continue
    samples.append({'name': n, 'inp': {c: wv[VS][f'{c}{r}'].value for c in inp_cols if wv[VS][f'{c}{r}'].value is not None}})

# ---------- 프로그램 목록 (입시요강) ----------
ys = wv['입시요강']; yf = wf['입시요강']
H = {  # 입시요강 열 번호
    'id': 1, 'state': 2, 'gun': 3, 'region': 4, 'name': 5, 'dept': 6, 'founding': 7, 'track': 8, 'cert': 9, 'quota': 10, 'stage': 11,
    'd_apply': 12, 'd_pre': 13, 'd_prac': 14, 'd_itv': 15, 'd_1st': 16, 'd_room': 17, 'd_final': 18, 'c_quota': 19, 'c_app': 20, 'c_rate': 21,
    'r_school': 22, 'p_school': 23, 'r_sun': 24, 'p_sun': 25, 'r_prac': 26, 'p_prac': 27, 'r_itv': 28, 'p_itv': 29, 'r_apt': 30, 'p_apt': 31,
    'r_award': 32, 'p_award': 33, 'hist': 34, 'hist_how': 35, 'idx_ks': 36, 'idx_tam': 37,
    'kor_bonus': 38, 'kor_w': 39, 'kor_p': 40, 'math_sel': 41, 'math_bonus': 42, 'math_w': 43, 'math_p': 44, 'eng_how': 45, 'eng_w': 46, 'eng_p': 47,
    'tam_w': 48, 'tam_p': 49, 'tam_n': 50, 'tam_sel': 51, 'lang2': 52, 'subjects': 53, 'school_subjects': 54, 'changes': 96,
}
home = {}  # 홈베이스: 커트라인
hv = wv['홈베이스']
for r in range(19, hv.max_row + 1):
    i = hv.cell(r, 1).value
    if i is None: continue
    home[float(i)] = {'cut': hv.cell(r, 37).value, 'cut_low': hv.cell(r, 38).value, 'cut_note': hv.cell(r, 39).value,
                      'cut_busan': hv.cell(r, 40).value, 'cut_assoc': hv.cell(r, 41).value, 'cut_other': hv.cell(r, 42).value, 'on_home': True}

programs, sheets, check = [], {}, {}
import os
CHECK = os.environ.get('J26_CHECK')  # 검증용: 엑셀에 저장된 상담 학생 결과값 (자료에는 넣지 않음)
for r in range(8, ys.max_row + 1):
    pid = ys.cell(r, 1).value
    ref = yf.cell(r, 98).value
    if pid is None or not isinstance(ref, str) or not ys.cell(r, 5).value: continue
    m = re.match(r"='?(.+?)'?!G(\d+)$", ref)
    if not m: continue
    sheet, row = m.group(1).replace("''", "'"), int(m.group(2))
    if sheet not in wf.sheetnames: continue
    p = {k: ys.cell(r, c).value for k, c in H.items()}
    for k, v in list(p.items()):
        if hasattr(v, 'isoformat'): p[k] = v.isoformat()[:10]
    p['eng_pts'] = [ys.cell(r, c).value for c in range(72, 81)]
    p['hist_pts'] = [ys.cell(r, c).value for c in range(81, 90)]
    p['events'] = [ys.cell(r, c).value for c in range(90, 96) if ys.cell(r, c).value not in (None, 'ㅡ', '-')]
    p['sheet'], p['row'] = sheet, row
    p.update(home.get(float(pid), {}))
    programs.append(p)
    if sheet in sheets: continue

    ws = wf[sheet]; wsv = wv[sheet]
    # 실기 기록 칸: 위쪽 머리줄에서 '기록'
    hdr = next((rr for rr in range(row - 1, max(1, row - 4), -1) if any(c.value == '기록' for c in ws[rr])), None)
    rec_cols, events = [], []
    if hdr:
        for c in ws[hdr]:
            if c.value == '기록':
                col = c.column
                name = next((ws.cell(rr, col).value for rr in range(hdr - 1, hdr - 3, -1) if ws.cell(rr, col).value), None)
                rec_cols.append(c.column_letter)
                if name and not re.match(r'^실기\d', str(name)):
                    events.append({'name': name, 'rec': c.column_letter, 'pts': cl(col + 1)})
    forms = dyn_row(sheet, row)
    # 실기 기록 칸(개인 기록)은 지우고, 그 밖의 글자 칸은 상수로 둔다
    for c in ws[row]:
        v = c.value
        if v is not None and not (isinstance(v, str) and v.startswith('=')) and c.column_letter not in rec_cols and c.column_letter not in ('B', 'C'):
            forms[c.column_letter] = {'v': v}
    close(sheet, row, forms)
    # 실기 배점표 (배점·남·여 머리줄 아래)
    table = None
    # 배점표 위치: 실기 배점 칸 수식이 가리키는 줄 바로 위 머리줄
    ref_rows = [r1 for e in events if isinstance(forms.get(e['pts']), str) for (s2, c1, r1, c2, r2) in refs(forms[e['pts']], sheet) if s2 == sheet and r1 != row]
    start = (min(ref_rows) - 3) if ref_rows else row + 1
    for rr in range(max(1, start), min(ws.max_row, start + 120) + 1):
        cells = [wsv.cell(rr, c).value for c in range(1, 40)]
        if cells.count('배점') >= 1 and '남' in cells and '여' in cells:
            names = [wsv.cell(rr - 1, c).value for c in range(1, 40)]
            cols = [i + 1 for i, v in enumerate(cells) if v == '배점']
            table = []
            for c0 in cols:
                rows = []
                for r2 in range(rr + 1, rr + 60):
                    a, b, d = wsv.cell(r2, c0).value, wsv.cell(r2, c0 + 1).value, wsv.cell(r2, c0 + 2).value
                    if a is None and b is None and d is None: break
                    rows.append([a, b, d])
                nm = names[c0 - 1]
                if rows and nm and not re.match(r'^실기종목\d', str(nm)):
                    table.append({'name': nm, 'rows': rows})
            break
    sheets[sheet] = {'row': row, 'forms': forms, 'events': events, 'table': table}
    if CHECK: check[sheet] = {k: wsv[f'{k}{row}'].value for k in ('F', 'G', 'H', 'I', 'X', 'Z')}

data = {'version': 1, 'title': '2026학년도 정시', 'vs': {'sheet': VS, 'row': VROW, 'forms': vs_forms},
        'samples': samples, 'programs': programs, 'sheets': sheets, 'consts': consts}
json.dump(data, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'), default=str)
if CHECK:
    stu = os.environ['J26_CHECK']; rr = next(r for r in range(8, 135) if wv[VS].cell(r, 3).value == stu)
    json.dump({'student': {cl(c): wv[VS].cell(rr, c).value for c in range(1, 41)}, 'sheets': check}, open(OUT + '.check.json', 'w'), ensure_ascii=False, default=str)
print(f'programs {len(programs)}, sheets {len(sheets)}, samples {len(samples)}, const cells {sum(len(v) for v in consts.values())}')
