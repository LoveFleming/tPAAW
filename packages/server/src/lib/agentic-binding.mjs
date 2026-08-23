/**
 * Agentic Binding — 把 Agentic Platform 的 workflow 註冊為 PAAW 聊天工具
 *
 * 流程：
 * 1. 讀 data/config/agentic-bindings.json
 * 2. 每個 binding 產生一個 tool definition + handler
 * 3. handler 呼叫 Agentic Platform API (POST /api/workflows/:id/run)
 * 4. 回傳 runId + 初始狀態給聊天視窗
 *
 * 林雨晴 system prompt 會自動出現這些工具，
 * 使用者說「訂下午茶」→ AI 自然語言匹配 → call tool → workflow 啟動
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { toolRegistry } from "./tool-registry.mjs";

let _bindings = null;

function _loadBindings(configDir) {
  const configFile = join(configDir, "agentic-bindings.json");
  // 缺檔/壞檔回空 — 不自動寫預設（ensure-default pattern 已拔）
  try {
    if (!existsSync(configFile)) return {};
    return JSON.parse(readFileSync(configFile, "utf-8")) || {};
  } catch {
    return {};
  }
}

function _buildToolDef(binding) {
  const triggerHint = binding.triggers?.length
    ? `（觸發場景：${binding.triggers.join("、")}）`
    : "";

  return {
    type: "function",
    function: {
      name: binding.toolName,
      description: `${binding.description}${triggerHint}

參數說明：
- menu: 菜單內容（文字，可多行）
- participants: 參與者名字列表（JSON 陣列）
- deadline: 截止時間（例如 "10 分鐘"、"下午 3 點"）
- roomId: 目標聊天室 ID（預設：${binding.defaults?.roomId || "rainy-afternoon-tea"}）

呼叫後會立刻啟動 agentic workflow，回傳 runId 和狀態。`,
      parameters: {
        type: "object",
        properties: {
          menu: {
            type: "string",
            description: "菜單內容，可以多行文字。例如：珍奶 $65\\n紅茶 $40",
          },
          participants: {
            type: "array",
            items: { type: "string" },
            description: `參與者名字。預設：${JSON.stringify(binding.defaults?.participants || [])}`,
          },
          deadline: {
            type: "string",
            description: `截止時間描述。預設：${binding.defaults?.deadline || "10 分鐘"}`,
          },
          roomId: {
            type: "string",
            description: `目標聊天室 ID。預設：${binding.defaults?.roomId || "rainy-afternoon-tea"}`,
          },
        },
        required: ["menu"],
      },
    },
  };
}

function _buildHandler(binding) {
  const baseUrl = binding.agenticPlatformUrl || "http://localhost:4200";
  const defaults = binding.defaults || {};

  return async (args, ctx) => {
    const input = {
      title: args.title || defaults.title || "下午茶訂購",
      menu: args.menu || "",
      roomId: args.roomId || defaults.roomId || "rainy-afternoon-tea",
      targetChatId: args.roomId || defaults.roomId || "rainy-afternoon-tea",
      participants: args.participants || defaults.participants || [],
      deadline: args.deadline || defaults.deadline || "10 分鐘",
      organizer: args.organizer || ctx?.agentId || "assistant",
    };

    console.log(`[agentic-binding] Launching workflow '${binding.workflowId}' → ${baseUrl}`);
    console.log(`[agentic-binding] Input: ${JSON.stringify(input).slice(0, 200)}`);

    try {
      const resp = await fetch(`${baseUrl}/api/workflows/${binding.workflowId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });

      const data = await resp.json();

      if (data.error) {
        return { error: true, message: `Agentic Platform error: ${data.error}` };
      }

      return {
        ok: true,
        runId: data.runId,
        workflowId: data.workflowId,
        status: data.status,
        message: `✅ 已啟動「${binding.defaults?.title || binding.workflowId}」workflow！\nRun ID: ${data.runId}\n\nAI 代理人現在開始自主執行：發菜單、收訂單、催人、結單。`,
        pollingUrl: `${baseUrl}/api/runs/${data.runId}`,
      };
    } catch (err) {
      console.error(`[agentic-binding] Failed to launch workflow:`, err.message);
      return {
        error: true,
        message: `無法啟動 workflow：${err.message}\n請確認 Agentic Platform 是否在 ${baseUrl} 運行。`,
      };
    }
  };
}

/**
 * 初始化所有 agentic bindings — 註冊到 toolRegistry
 */
export function initAgenticBindings(configDir) {
  try {
    _bindings = _loadBindings(configDir);
  } catch (err) {
    console.error("[agentic-binding] Failed to load config:", err.message);
    return;
  }

  let count = 0;
  for (const [id, binding] of Object.entries(_bindings)) {
    if (!binding.enabled) continue;
    if (toolRegistry.has(binding.toolName)) {
      console.log(`[agentic-binding] Tool '${binding.toolName}' already registered, skipping`);
      continue;
    }

    const def = _buildToolDef(binding);
    const handler = _buildHandler(binding);

    toolRegistry.register({
      name: binding.toolName,
      definition: def,
      source: "agentic-binding",
      handler,
    });
    count++;
    console.log(`[agentic-binding] Registered tool '${binding.toolName}' → workflow '${binding.workflowId}'`);
  }

  if (count > 0) {
    console.log(`[agentic-binding] ✅ ${count} agentic workflow tools registered`);
  }
}

/**
 * 取得所有 binding 設定（供 API 用）
 */
export function getBindings() {
  return _bindings || {};
}

/**
 * 重新載入設定（存檔後呼叫）
 */
export function reloadBindings(configDir) {
  toolRegistry.unregisterBySource("agentic-binding");
  initAgenticBindings(configDir);
}
