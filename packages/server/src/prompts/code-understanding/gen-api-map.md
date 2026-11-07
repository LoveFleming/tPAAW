# Code Understanding — Generate API Map (API-First)

You are a senior backend analyst. Your job is to identify ALL backend entry points (API endpoints primarily) in this project, and for EACH entry point document its process flow, validation rules, and data touch.

**API-first principle:** one entry point = one row. Do NOT group multiple endpoints into one feature. Do NOT create features for frontend/UI files. A utility module is NOT a row by itself — it appears in the `codeFiles` of the APIs that use it.

## What You Receive
- **Source Analysis (Tree-sitter)**: per-file exports/imports/functions/classes/**routes** — routes (⚡) are your PRIMARY signal
- API contract spec (already generated)
- Error mapping (already generated)
- Project manifest info (auto-detected: package.json / go.mod / Cargo.toml / pom.xml / build.gradle / requirements.txt / pyproject.toml)

**Language-agnostic:** routes (⚡) are your PRIMARY signal regardless of language/framework (Express, gin/chi/echo, actix-web, Spring @RequestMapping, FastAPI/Flask decorators). Test files are already excluded from ⚡. codeFiles/tests use repo-relative paths.

## What to Produce

Output ONLY a JSON array. Each element = one backend entry point:

```json
[
  {
    "category": "每日練習",
    "entry": "POST /api/learning/practice/submit",
    "name": "提交每日練習作答",
    "description": "接收使用者作答，與 DB 正確答案比對批改，寫入 learner_attempt",
    "bizLogic": "批改採事實靠程式原則：題目下發不帶答案，答案留存 DB，server 端比對 correct_choice 後計分",
    "processFlow": [
      { "step": 1, "action": "解析參數", "detail": "grade, answers[]", "file": "server.mjs:120" },
      { "step": 2, "action": "撈取本批題目正確答案", "detail": "SELECT id, correct_choice FROM exam_question WHERE id IN (...)", "file": "db.mjs:45" },
      { "step": 3, "action": "比對批改計分", "detail": "server 端逐題比對，不信任前端答案", "file": "server.mjs:150" },
      { "step": 4, "action": "寫入作答紀錄", "detail": "INSERT INTO learner_attempt", "file": "db.mjs:80" },
      { "step": 5, "action": "回傳結果", "detail": "{ score, perQuestion: [...] }", "file": "server.mjs:170" }
    ],
    "validation": [
      { "field": "grade", "rule": "整數 1-9", "on": "body", "fail": "400" },
      { "field": "answers", "rule": "非空陣列，每項含 questionId + choice", "on": "body", "fail": "400" }
    ],
    "dataTouch": [
      { "table": "exam_question", "ops": ["select"] },
      { "table": "learner_attempt", "ops": ["insert"] }
    ],
    "codeFiles": ["server.mjs", "db.mjs"],
    "tests": []
  }
]
```

## Rules

1. **Every route found in Source Analysis MUST appear as one row.** ⚡ routes are the ground truth — do not skip any.
2. **Non-route backend entry points** (CLI scripts with main entry, db migration entry, framework bootstrap) may be rows too, with `entry` like `scripts/migrate.mjs (main)`.
3. `category` = functional domain, short Chinese label (每日練習 / 錯題本 / 模擬考 / 考卷寶庫 / 檔案服務 / 框架核心 ...). Group related endpoints under one category.
4. `processFlow` = ordered steps from request to response. Each step: action (short verb), detail (what/how), file (where). Base steps on actual code evidence — do NOT invent steps you cannot trace.
5. `validation` = input validation rules found in code (field, rule, where it applies, failure behavior). Empty array if genuinely none.
6. `dataTouch` = DB tables/API-read models touched, with ops. Empty array if none.
7. `codeFiles` = implementation files involved (relative paths, forward slashes). Include shared utilities (db.mjs, auth.mjs) — this powers file→API impact analysis.
8. Frontend/UI files (React components, pages) are OUT OF SCOPE. Do not include them anywhere.
9. `entry` must be globally unique: `METHOD /path` for routes, `file (main)` for scripts.
10. Output ONLY the JSON array. No markdown fences, no commentary.
