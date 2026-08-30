// 2026-08-30：disableThinking 咽喉邏輯測試
// 跑法：node packages/server/test/disable-thinking.test.mjs
import { callLLMWithRetry } from "../src/lib/llm-utils.mjs";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}

// Mock：攔 fetch 不真的打 API，回最小 choices 結構
const origFetch = globalThis.fetch;
const seenBodies = [];
globalThis.fetch = async (url, init) => {
  seenBodies.push({ url, body: JSON.parse(init.body) });
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: "test-ok" }, finish_reason: "stop" }], usage: { total_tokens: 10 } }),
  };
};

const ZAI = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const OR = "https://openrouter.ai/api/v1/chat/completions";
const HDRS = { "Content-Type": "application/json", Authorization: "Bearer x" };

console.log("== disableThinking 咽喉邏輯 ==");

// 1. zai + disableThinking → body.thinking injected disabled
await callLLMWithRetry(ZAI, HDRS, { model: "zai/glm-5.1", messages: [{ role: "user", content: "hi" }] }, { disableThinking: true, caller: "t1", maxRetries: 1 });
check("zai + disableThinking → thinking disabled 注入", seenBodies[0].body.thinking?.type === "disabled");

// 2. zai + 沒帶 opt → 不注入（維持預設 thinking on）
await callLLMWithRetry(ZAI, HDRS, { model: "zai/glm-5.1", messages: [{ role: "user", content: "hi" }] }, { caller: "t2", maxRetries: 1 });
check("zai 無 opt → 不動 thinking", seenBodies[1].body.thinking === undefined);

// 3. 非 zai + disableThinking → 不注入（避免污染其他 provider 格式）
await callLLMWithRetry(OR, HDRS, { model: "deepseek/x", messages: [{ role: "user", content: "hi" }] }, { disableThinking: true, caller: "t3", maxRetries: 1 });
check("openrouter + disableThinking → 不注入", seenBodies[2].body.thinking === undefined);

// 4. zai + disableThinking 但 caller 自帶 thinking → 不覆蓋
await callLLMWithRetry(ZAI, HDRS, { model: "zai/glm-5.1", messages: [{ role: "user", content: "hi" }], thinking: { type: "enabled", budget_tokens: 4096 } }, { disableThinking: true, caller: "t4", maxRetries: 1 });
check("caller 自帶 thinking → 不覆蓋", seenBodies[3].body.thinking.type === "enabled");

globalThis.fetch = origFetch;
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
