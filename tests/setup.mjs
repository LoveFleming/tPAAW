// vitest setupFiles — 所有測試共用（2026-10-19 污染事件後新增）
// 事件：retrofit 測試經 provider/llm-utils/agent-loop 的 _llmLog 把 3000+ 筆
// 假 LLM call（test-model / fallback-m / m-override）寫進正式 log/logs/llm/，
// 污染 LLM API Log 報表。測試一律寫隔離 tmp 目錄，正式區永不落地。
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.PAAW_LLM_LOG_DIR) {
  process.env.PAAW_LLM_LOG_DIR = mkdtempSync(join(tmpdir(), "paaw-test-llm-logs-"));
}
