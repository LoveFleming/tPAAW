# Skill

## Purpose

自動檢查 CI/CD pipeline 狀態，失敗時診斷原因並建議修復方案。

## Inputs

| 參數 | 型別 | 必填 | 說明 |
|------|------|------|------|
| pipeline_id | string | ✅ | GitLab/GitHub pipeline ID |
| severity | enum<"warn","error"> | ❌ | 最低回報等級，預設 error |

## Deterministic Script

### Tool Access

- `gitlab_api` (read-only)
- `github_api` (read-only)
- `slack_notify` (post-message)

### Execution Steps

1. 查詢 pipeline 狀態 (`GET /pipelines/:id`)
2. 如果 failed → 取取 failed job logs
3. 分析錯誤類型（compile / test / deploy）
4. 查找最近成功 build 的 diff
5. 生成修復建議

### Business Rules

- 同一 pipeline 5 分鐘內不重複檢查
- severity=warn 時也回報 warning jobs
- 修復建議最多 3 個

### Error Handling

- API timeout → 通知 on-call，不 crash
- Logs 太大 → 截取最後 200 行
- 權限不足 → 降級為「狀態通知 only」

## Guardrails

- ❌ 不可自動 merge 或 approve PR
- ❌ 不可修改 pipeline 設定
- ✅ 只能 read + notify

## Output Contract

```json
{
  "pipeline_id": "string",
  "status": "success | failed | warning",
  "failed_jobs": [{ "name": "string", "stage": "string", "error_type": "string" }],
  "suggestions": ["string"],
  "checked_at": "ISO-8601"
}
```

## Validation

- pipeline_id 必須是合法 UUID
- suggestions 数量 ≤ 3
- output 必須符合 Output Contract schema
