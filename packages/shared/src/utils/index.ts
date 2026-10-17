/**
 * PAAW Shared Utils
 */

// ── ID Generation ───────────────────────────────────────

export function generateId(prefix: string = ""): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return prefix ? `${prefix}_${ts}${rand}` : `${ts}${rand}`;
}

// ── Template Engine (for workflow {{ref}} vars) ─────────

export function resolveTemplate(
  template: string,
  vars: Record<string, any>
): string {
  return template.replace(/\{\{(\w[\w.]*)\}\}/g, (_, path) => {
    const parts = path.split(".");
    let value: any = vars;
    for (const part of parts) {
      if (value == null) return "";
      // 2026-10-02：原型污染防護（semgrep prototype-pollution-loop）— 路徑段不得指向原型鏈
      if (part === "__proto__" || part === "constructor" || part === "prototype") return "";
      value = value[part]; // nosemgrep: prototype-pollution-loop — part 已過濾原型鏈屬性
    }
    return value != null ? String(value) : "";
  });
}

function resolveTemplateValue(value: any, vars: Record<string, any>): any {
  if (typeof value === "string") {
    return resolveTemplate(value, vars);
  }
  // 2026-10-17：陣列必須保持陣列（逐項處理），否則會被誤當 object 轉成 {"0":..} 物件。
  // 這對 {{ref}} 模板解析是正確性問題 — 見 TASK-116 review（F20261016-073）。
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplateValue(item, vars));
  }
  if (typeof value === "object" && value !== null) {
    return resolveTemplateObj(value, vars);
  }
  return value;
}

export function resolveTemplateObj(
  obj: Record<string, any>,
  vars: Record<string, any>
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = resolveTemplateValue(value, vars);
  }
  return result;
}

// ── Validation Helper ───────────────────────────────────

export function validateRequired(
  input: Record<string, any>,
  required: string[]
): string | null {
  for (const field of required) {
    if (input[field] === undefined || input[field] === null || input[field] === "") {
      return `Missing required field: ${field}`;
    }
  }
  return null;
}

// ── Timing Helper ───────────────────────────────────────

export async function measureMs<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  const ms = Math.round(performance.now() - start);
  return { result, ms };
}

// ── Date Helpers ────────────────────────────────────────

export function nowISO(): string {
  return new Date().toISOString();
}

export function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}
