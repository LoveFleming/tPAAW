# Changelog

## 2026-07-16
### added
- LLM API logging — all calls logged to data/llm-logs/ with GET /api/llm-logs, GET /api/llm-logs/stats, DELETE /api/llm-logs



> 由 PAAW AI-Native IDE 自動維護。每次 AI 完成任務後自動追加變更記錄。


### added
- 🔍 Context Debug button to AI agent chat headers

### added
- AI agents can now CRUD project issues (new tool: create/update/delete/list issues)

### added
- Security Console — instant diagnostic panel showing full semgrep scan command

### added
- Startup import check (import-check.mjs) — catches missing exports before runtime

### added
- Bundled local semgrep rules (offline) in data/semgrep-rules/

### added
- .env file support — PAAW_PORT, PAAW_WS_PORT, VITE_PORT now configurable via .env

### added
- Env var fast path for semgrep — SEMGREP_PATH/PYTHON_PATH skip all detection

### fixed
- AI chat now remembers full conversation session (persistent across tab switches)

### fixed
- Greeting message no longer counted as conversation message

### fixed
- Cannot set headers after they are sent — fixed response race condition

### fixed
- Preserve scroll position when switching tabs (keep tool tabs mounted)

### fixed
- Duplicate }); in coding.mjs that caused syntax error

### fixed
- A2A architect now uses coding project path (cwd) for context injection

### fixed
- Inject Feature Map + Code Intelligence + Security Scan into coding AI chat

### fixed
- Semgrep: write JSON output to file instead of stdout — no truncation on Windows

### fixed
- Semgrep: use temp script file to avoid Windows newline/truncation issues

### fixed
- Semgrep: use semgrep.exe directly, local rules first, short commands

### fixed
- PAAW_ROOT path was wrong — 3 levels up instead of 4

### fixed
- Flatten semgrep-rules directory (remove duplicate layer)

### fixed
- Show CU modal on deleted .paaw but don't auto-start — let user decide

### fixed
- Don't auto-popup CU modal if Code Understanding already done

### fixed
- Silence registry PATH read error in semgrep runner

### fixed
- Vite reads .env from repo root, not packages/ui CWD

### fixed
- Security scan Windows double-quote issue — cmd.exe treats quoted commands as string
