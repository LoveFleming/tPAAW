#!/usr/bin/env python3
"""CAP 會考考古題 → 考卷寶庫（Exam Vault）DB 匯入器 — deterministic。

來源：raw/cap-<roc>/ 的「題本 PDF」+ answers.pdf（官方選擇題參考答案一覽表）

產出：
  1) data/exam-papers/cap-<roc>-<key>/pNN.jpg   原卷頁圖（vault 原圖對照 /api/exam-vault/img）
  2) learning.db 的 exam + exam_question 列
     exam:          source='cap', status='published'（考古題不需人工校對）
     exam_question: correct_answer=官方答案, is_correct=NULL（不是小元寶的作答 → 不進錯題本）

冪等：同 exam id 先 DELETE（exam_question 一併）再 INSERT，可重跑。
只處理 answers.pdf 有文字層的年度（103 為純掃描 → 跳過，需 OCR/vision）。

用法（需 pymupdf）：
  python3 import-cap-vault.py --dry-run
  python3 import-cap-vault.py --years 104-115
"""
import argparse, json, os, re, shutil, sqlite3, sys
from datetime import datetime, timezone

try:
    import pymupdf  # PyMuPDF
except ImportError:
    sys.exit("需要 PyMuPDF：pip install pymupdf")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                      # 模組資料根（data/installed-apps/learning）
RAW = os.path.join(ROOT, "raw")
EXAM_PAPERS = os.path.join(ROOT, "data", "exam-papers")
DB_PATH = os.path.join(ROOT, "data", "learning.db")

# 欄位規格：(key, 答案表欄名, 題本檔名候選, 顯示科名, vault subject id)
# 註：英語「聽力」無題本 PDF（cap-*/english-listening.pdf 實為 MP3 音檔 zip）→ 不匯入聽力
COLS = [
    ("chinese",            "國文", ["chinese.pdf"],                              "國文",       "chinese"),
    ("english-reading",    "閱讀", ["english-reading.pdf", "english.pdf"],       "英語(閱讀)", "english"),
    ("english-listening",  "聽力", ["english-listening.pdf"],                    "英語(聽力)", "english"),
    ("math",               "數學", ["math.pdf"],                                "數學",       "math"),
    ("social",             "社會", ["social.pdf"],                              "社會",       "social"),
    ("science",            "自然", ["science.pdf"],                             "自然",       "science"),
]
LABELS = {c[1]: c[0] for c in COLS}
# 表頭正規化：去括號/空白；「英語」為合併表頭（跨 閱讀/聽力）不當欄位
LABEL_ALIAS = {"國文": "chinese", "閱讀": "english-reading", "聽力": "english-listening",
               "數學": "math", "社會": "social", "自然": "science"}


def parse_answers(pdf_path):
    """回傳 {colkey: {qno: 'A'}}；座標法把答案 token 歸到最近的表頭欄位。"""
    doc = pymupdf.open(pdf_path)
    out = {}
    for page in doc:
        words = page.get_text("words")           # (x0,y0,x1,y1,text,...)
        # 表頭 x 中心
        centers = {}
        for x0, y0, x1, y1, t, *_ in words:
            t = t.strip().strip("()（）").strip()
            ck = LABEL_ALIAS.get(t)
            if ck:
                centers.setdefault(ck, (x0 + x1) / 2)
        if not centers:
            continue
        cols = list(centers.items())
        # 收集題號 / 答案 token（用 y 最近配對，避免同一列被 y 分桶拆開）
        qnos, anss = [], []
        for x0, y0, x1, y1, t, *_ in words:
            t = t.strip()
            if re.fullmatch(r"\d{1,2}", t):
                qnos.append((y0, int(t)))
            elif re.fullmatch(r"[A-Da-d]", t):
                anss.append((x0, y0, t.upper()))
        if not qnos:
            continue
        for x0, y0, ch in anss:
            dy, qno = min(((abs(y0 - qy), qn) for qy, qn in qnos), key=lambda v: v[0])
            if dy > 6:            # 同一列內（列距約 19px）
                continue
            ck = min(cols, key=lambda c: abs(c[1] - x0))[0]
            out.setdefault(ck, {})[qno] = ch
    return out


def _is_pdf(p):
    try:
        d = pymupdf.open(p)
        return d.page_count > 0      # 0 頁 PDF（如聽力空壳）視為不可用
    except Exception:
        return False


def booklet_for(roc, candidates):
    for name in candidates:
        p = os.path.join(RAW, f"cap-{roc}", name)
        if os.path.exists(p) and _is_pdf(p):   # 有些 english-listening.pdf 實為 MP3 音檔 zip
            return p
    return None


def render_pages(pdf_path, out_dir, dpi):
    os.makedirs(out_dir, exist_ok=True)
    doc = pymupdf.open(pdf_path)
    for i, page in enumerate(doc, start=1):
        pix = page.get_pixmap(dpi=dpi)
        pix.save(os.path.join(out_dir, f"p{i:02d}.jpg"), jpg_quality=80)
    return doc.page_count


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default="104-115", help="e.g. 104-115 或 115")
    ap.add_argument("--dpi", type=int, default=110)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", default="", help="只做某 key（除錯用）")
    a = ap.parse_args()

    if "-" in a.years:
        lo, hi = a.years.split("-"); years = range(int(lo), int(hi) + 1)
    else:
        years = [int(a.years)]

    now = datetime.now(timezone.utc).isoformat()
    db = sqlite3.connect(DB_PATH)
    total_e = total_q = 0

    for roc in years:
        ans_pdf = os.path.join(RAW, f"cap-{roc}", "answers.pdf")
        if not os.path.exists(ans_pdf):
            print(f"cap-{roc}: 無 answers.pdf，跳過"); continue
        answers = parse_answers(ans_pdf)
        if not answers:
            print(f"cap-{roc}: answers.pdf 無文字層（掃描檔？），跳過"); continue
        for key, label, cands, zh, subject in COLS:
            if a.only and key != a.only:
                continue
            amap = answers.get(key) or {}
            if not amap:
                continue
            bk = booklet_for(roc, cands)
            if not bk:
                print(f"  cap-{roc}-{key}: 無可讀題本 PDF（或有聲無題本）→ 跳過")
                continue
            eid = f"cap-{roc}-{key}"
            title = f"{roc}年國中教育會考 {zh}"
            print(f"  {eid}: 題本={os.path.basename(bk) if bk else '（缺）'} 題數={len(amap)}")
            total_e += 1
            total_q += len(amap)
            if a.dry_run:
                continue
            pages = 0
            if bk:
                try:
                    pages = render_pages(bk, os.path.join(EXAM_PAPERS, eid), a.dpi)
                except Exception as e:
                    print(f"  ⚠️  {eid}: 題本無法 render（{e}）→ 跳過")
                    continue
            if pages == 0:      # 有些 english-listening.pdf 是 0 頁空壳（內容為音檔）
                print(f"  cap-{roc}-{key}: 題本 0 頁（無內容）→ 跳過")
                shutil.rmtree(os.path.join(EXAM_PAPERS, eid), ignore_errors=True)
                continue
            db.execute("DELETE FROM exam_question WHERE exam_id=?", (eid,))
            db.execute("DELETE FROM exam WHERE id=?", (eid,))
            db.execute(
                "INSERT INTO exam (id,subject,title,exam_date,grade,semester,source,source_url,raw_dir,"
                "page_count,score,status,parse_note,created_at,published_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (eid, subject, title, str(roc + 1911), None, None, "cap", None,
                 f"data/exam-papers/{eid}", pages, None, "published",
                 f"官方參考答案一覽表（{booklet_for(roc, cands) or ''}）", now, now))
            for qno in sorted(amap):
                db.execute(
                    "INSERT INTO exam_question (id,exam_id,qno,page,unit,concept,question_text,"
                    "student_answer,correct_answer,is_correct,error_type,confidence,evidence,"
                    "review_status,review_note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (f"eq-{eid}-{qno}", eid, qno, None, None, None, "",
                     "", amap[qno], None, "", None, "官方參考答案一覽表", "approved", None, now))
        db.commit()

    print(f"\n{'[dry-run] ' if a.dry_run else ''}exam={total_e} question={total_q}")
    if not a.dry_run:
        n = db.execute("SELECT COUNT(*) FROM exam").fetchone()[0]
        m = db.execute("SELECT COUNT(*) FROM exam_question").fetchone()[0]
        print(f"DB 現況：exam={n} exam_question={m}")
    db.close()


if __name__ == "__main__":
    main()
