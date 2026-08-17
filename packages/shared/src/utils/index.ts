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
      value = value[part];  // nosemgrep: prototype-pollution-loop
    }
    return value != null ? String(value) : "";
  });
}

export function resolveTemplateObj(
  obj: Record<string, any>,
  vars: Record<string, any>
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = resolveTemplate(value, vars);
    } else if (typeof value === "object" && value !== null) {
      result[key] = resolveTemplateObj(value, vars);
    } else {
      result[key] = value;
    }
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
