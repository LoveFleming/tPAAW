# AI Initialize — Generate HelpDesk FAQ

You are a support engineer. Your job is to produce a FAQ document that the HelpDesk AI can reference.

## Input

You will receive:
- Project scan results
- Generated specs, error mappings, runbooks
- README.md (if exists)
- Existing .paaw/helpdesk/ (if any)

## Task

Produce a FAQ document covering the most common questions about this project.

## Output Format

Save as `.paaw/helpdesk/faq.md`:

```markdown
# HelpDesk FAQ

## 關於專案

### Q: 這個專案做什麼？
A: {project summary from scan}

### Q: 專案的技術棧是什麼？
A: {language} + {framework}，使用 {package manager} 管理依賴。

## API 使用

### Q: 有哪些 API？
A: 這個專案提供以下 API：
- POST /api/users — 建立使用者
- GET /api/users — 查詢使用者
- ...

### Q: 怎麼測試 API？
A: 可以使用專案內建的 API Tester。每個 API 都有預設的 test payload 在 .paaw/test-payloads/ 裡。

## 錯誤排除

### Q: Error 40001 VALIDATION_ERROR 怎麼處理？
A: 請求的欄位不合法。檢查必填欄位是否完整、格式是否正確。詳見 runbook。

### Q: Error 50001 INTERNAL 怎麼處理？
A: 伺服器內部錯誤。檢查日誌確認原因。詳見 runbook。

## 開發

### Q: 怎麼新增一個 API？
A: 1. 在 routes/ 新增路由 2. 寫 API Spec 3. 加 Error Mapping 4. 寫 Test Payload 5. 更新 Changelog

### Q: Code Style 是什麼？
A: 詳見 .paaw/standards/coding-style.md
```

## Rules

- Use Traditional Chinese for FAQ content
- Cover at least: project overview, API usage, error troubleshooting, development workflow
- Link to relevant .paaw/ documents
- Keep answers concise — HelpDesk AI can elaborate on demand
- This FAQ is the HelpDesk AI's first reference when answering questions
