# learning 模組工具腳本

## import-cap-vault.py — CAP 會考考古題 → 考卷寶庫 DB

把 `raw/cap-<roc>/` 的官方題本 PDF + `answers.pdf` 匯入 learning.db 的 `exam` / `exam_question`，
並把題本頁面 render 成 `data/exam-papers/cap-<roc>-<key>/pNN.jpg`（vault 原圖對照用）。

- 覆蓋：**104-115 年 × 5 科**（國文／英語(閱讀)／數學／社會／自然）→ 60 份卷、2691 題
- 冪等：同 exam id 先刪再插，可重跑
- 排除：103（answers.pdf 純掃描無文字層）、英語聽力（`english-listening.pdf` 實為 MP3 音檔 zip／0 頁空壳）
- 答案正確性：座標法解析官方「參考答案一覽表」，已與 `math-115-metadata.json` 全數交叉驗證一致

需求：`pip install pymupdf`
用法：
```bash
python3 import-cap-vault.py --dry-run          # 先看筆數
python3 import-cap-vault.py --years 104-115
```
