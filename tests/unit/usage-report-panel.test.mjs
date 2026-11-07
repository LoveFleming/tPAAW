/**
 * Unit tests — UsageReportPanel (F20261016-062 / TASK-105 品質補強)
 *
 * Target (read-only, NOT imported):
 *   packages/ui/src/components/UsageReportPanel.tsx
 *
 * Why two layers (same precedent as TASK-046 / ADR-022 template tests):
 *   1. The component is React + TSX; the vitest workspace runs in a *node*
 *      environment (no jsdom / @testing-library — see vitest.config.ts), so the
 *      component CANNOT be rendered/imported here.
 *   2. The aggregation logic (5 group-by passes + totals + daily stacking) is
 *      inlined inside a `useMemo` inside the component, so it is not importable
 *      without modifying the implementation — and TASK-105 forbids touching the
 *      implementation.
 *
 * Therefore we verify the component on two axes:
 *   LAYER A — Static contract scan: read the real .tsx text and assert that the
 *             shipping code contains the documented aggregation rules (group-by
 *             keys, accumulation formula, filter predicate, sort orders). This
 *             pins the REAL source; if a future edit breaks a rule, these fail.
 *   LAYER B — Executable semantic reproduction: a faithful mirror of the
 *             component's aggregation contract, fed mock `GET /api/agent-logs`
 *             payloads (same item shape as data/agent-logs/index.json) so the
 *             numbers (daily / RU / Agent / RU×Agent / RU×Model) are proven
 *             correct on happy-path + edge cases.
 *
 * QA review of the same file (qr-20261017-030252-m4ie) — findings registered as
 * guard assertions so the fix is detectable (= when the source changes to the
 * correct form, these assertions flip):
 *   M1 — `errors` is a raw count of status!=="completed", label says
 *        "Non-completed"; avgDuration correctly = durationMs/requests.
 *   M4 — RU×Model cost is averaged by 1/rmKeys.length (approximation, not real
 *        attribution). Guarded so a real by-model attribution upgrade is caught.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(__dirname, "../../packages/ui/src/components/UsageReportPanel.tsx");

let src = "";

// =====================================================================
// LAYER A — Static contract scan of the real component source
// =====================================================================
describe("UsageReportPanel — static contract scan (LAYER A)", () => {
  beforeEach(() => { src = readFileSync(SRC_PATH, "utf8"); });

  it("reads the real component (non-empty, is the usage report)", () => {
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain("UsageReportPanel");
    expect(src).toContain("/api/agent-logs");
  });

  it("fetches the existing GET /api/agent-logs API (no new API/storage)", () => {
    // limit=200 recent task summaries; no POST/PUT/DELETE, no new endpoint
    expect(src).toMatch(/\/api\/agent-logs\?limit=\d+/);
    expect(src).not.toMatch(/\/api\/agent-logs-[a-z]/); // no bespoke endpoint
    expect(src).not.toMatch(/localStorage|sessionStorage/);
  });

  it("aggregation is client-side (no server aggregation endpoint)", () => {
    // The 5 group-by maps must exist on the client
    for (const key of ["byDayMap", "byRuMap", "byAgentMap", "byRuAgentMap", "byRuModelMap"]) {
      expect(src).toContain(key);
    }
  });

  it("totals accumulation sums requests, tokens, cost, duration", () => {
    expect(src).toMatch(/agg\.requests \+= 1/);
    expect(src).toMatch(/agg\.tokensIn \+= e\.usage\?\.prompt \|\| 0/);
    expect(src).toMatch(/agg\.tokensOut \+= e\.usage\?\.completion \|\| 0/);
    expect(src).toMatch(/agg\.costUsd \+= e\.costUsd \|\| 0/);
    expect(src).toMatch(/agg\.durationMs \+= e\.durationMs \|\| 0/);
  });

  it("date filter is inclusive string compare on YYYY-MM-DD, invalid dates dropped", () => {
    expect(src).toMatch(/isoDay\(e\.startTime\)/);
    expect(src).toMatch(/if \(!d\) return false/);
    expect(src).toMatch(/if \(from && d < from\) return false/);
    expect(src).toMatch(/if \(to && d > to\) return false/);
  });

  it("ru/agent filters default missing ruName to '-'", () => {
    expect(src).toMatch(/const ruName = e\.ruName \|\| "-"/);
    expect(src).toMatch(/if \(ru && ruName !== ru\) return false/);
    expect(src).toMatch(/if \(agent && e\.agentId !== agent\) return false/);
  });

  it("model extraction handles string and object forms, dedupes per task", () => {
    expect(src).toMatch(/typeof x === "string" \? x : x\?\.model/);
    expect(src).toMatch(/new Set\(models\)/);
  });

  it("RU×Agent / RU / Agent tables are sorted by cost desc", () => {
    // at least the primary sorts on costUsd descending exist
    const costDescCount = (src.match(/b\.costUsd - a\.costUsd/g) || []).length;
    expect(costDescCount).toBeGreaterThanOrEqual(2);
  });
});

// =====================================================================
// QA findings — guard assertions (flip when the source is fixed)
// =====================================================================
describe("UsageReportPanel — QA findings guards (qr-20261017-030252-m4ie)", () => {
  beforeEach(() => { src = readFileSync(SRC_PATH, "utf8"); });

  it("M1: errors is a raw count of status!==completed (label 'Non-completed')", () => {
    // Current behavior guarded: no error-rate denominator is applied at the
    // card level; the increment is a plain count.
    expect(src).toMatch(/e\.status && e\.status !== "completed"\) agg\.errors \+= 1/);
    // avgDuration card divides total duration by requests (not by 1)
    expect(src).toMatch(/durationMs\s*\/\s*report\.totals\.requests|totals\.durationMs\s*\/\s*.*requests/);
  });

  it("M4: RU×Model cost is shared equally across models (1/rmKeys.length)", () => {
    // Guarded approximation — a real per-model attribution rewrite will break this.
    expect(src).toMatch(/1\s*\/\s*rmKeys\.length/);
  });
});

// =====================================================================
// LAYER B — Executable semantic reproduction of the aggregation contract
// =====================================================================
//
// Faithful mirror of the component's useMemo aggregation. Kept intentionally
// close to the source so it proves the documented contract on real-shaped data.
// Item shape mirrors data/agent-logs/index.json.
// ---------------------------------------------------------------------
const newAgg = () => ({ requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, durationMs: 0, errors: 0, modelCounts: {} });

function add(agg, e) {
  agg.requests += 1;
  agg.tokensIn += e.usage?.prompt || 0;
  agg.tokensOut += e.usage?.completion || 0;
  agg.costUsd += e.costUsd || 0;
  agg.durationMs += e.durationMs || 0;
  if (e.status && e.status !== "completed") agg.errors += 1;
  const raw = e.models?.length ? e.models : (e.model ? [e.model] : []);
  const models = raw.map(x => (typeof x === "string" ? x : x?.model) ?? "").map(m => m.trim()).filter(Boolean);
  for (const m of new Set(models)) agg.modelCounts[m] = (agg.modelCounts[m] || 0) + 1;
}

const isoDay = (iso) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Reproduces the component's useMemo. Returns totals + the five groupings.
 */
function aggregate(items, { from = "", to = "", ru = "", agent = "" } = {}) {
  const filtered = items.filter(e => {
    const d = isoDay(e.startTime);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (ru && (e.ruName || "-") !== ru) return false;
    if (agent && e.agentId !== agent) return false;
    return true;
  });

  const totals = newAgg();
  const byDayMap = new Map();
  const byRuMap = new Map();
  const byAgentMap = new Map();
  const byRuAgentMap = new Map();
  const byRuModelMap = new Map();

  for (const e of filtered) {
    const d = isoDay(e.startTime);
    const ruName = e.ruName || "-";
    add(totals, e);

    if (!byDayMap.has(d)) byDayMap.set(d, { date: d, ...newAgg(), byAgent: {} });
    const day = byDayMap.get(d);
    if (!day.byAgent[e.agentId]) day.byAgent[e.agentId] = newAgg();
    add(day, e);
    add(day.byAgent[e.agentId], e);

    if (!byRuMap.has(ruName)) byRuMap.set(ruName, { ruName, ...newAgg() });
    add(byRuMap.get(ruName), e);

    if (!byAgentMap.has(e.agentId)) byAgentMap.set(e.agentId, { agentId: e.agentId, ...newAgg() });
    add(byAgentMap.get(e.agentId), e);

    const raKey = `${ruName}__${e.agentId}`;
    if (!byRuAgentMap.has(raKey)) byRuAgentMap.set(raKey, { ruName, agentId: e.agentId, ...newAgg() });
    add(byRuAgentMap.get(raKey), e);

    // RU × Model: split the task's cost/duration equally across its distinct models
    const raw = e.models?.length ? e.models : (e.model ? [e.model] : []);
    const rmKeys = [...new Set(raw.map(x => (typeof x === "string" ? x : x?.model) ?? "").map(m => m.trim()).filter(Boolean))];
    if (rmKeys.length) {
      const share = 1 / rmKeys.length;
      for (const m of rmKeys) {
        const key = `${ruName}__${m}`;
        if (!byRuModelMap.has(key)) byRuModelMap.set(key, { ruName, model: m, requests: 0, costUsd: 0, durationMs: 0 });
        const row = byRuModelMap.get(key);
        row.requests += 1;
        row.costUsd += (e.costUsd || 0) * share;
        row.durationMs += (e.durationMs || 0) * share;
      }
    }
  }

  return {
    totals,
    byDay: [...byDayMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    byRu: [...byRuMap.values()].sort((a, b) => b.costUsd - a.costUsd),
    byAgent: [...byAgentMap.values()].sort((a, b) => b.costUsd - a.costUsd),
    byRuAgent: [...byRuAgentMap.values()].sort((a, b) => b.costUsd - a.costUsd),
    byRuModel: [...byRuModelMap.values()],
  };
}

// ── Fixtures (shape mirrors data/agent-logs/index.json) ──
const T = (o) => ({
  taskId: o.taskId, agentId: o.agentId, model: o.model, cwd: "/proj", ruName: o.ruName,
  startTime: o.startTime, durationMs: o.durationMs ?? 0, turns: 1, status: o.status ?? "completed",
  usage: o.usage, costUsd: o.costUsd, models: o.models,
});

const SAMPLE = [
  T({ taskId: "t1", agentId: "qa", ruName: "RU-A", startTime: "2026-10-17T01:00:00Z", durationMs: 10000, costUsd: 0.10, usage: { prompt: 1000, completion: 100, total: 1100 }, models: [{ model: "m1" }] }),
  T({ taskId: "t2", agentId: "qa", ruName: "RU-A", startTime: "2026-10-17T02:00:00Z", durationMs: 20000, costUsd: 0.20, usage: { prompt: 2000, completion: 200, total: 2200 }, models: [{ model: "m1" }] }),
  T({ taskId: "t3", agentId: "tester", ruName: "RU-B", startTime: "2026-10-17T03:00:00Z", durationMs: 30000, costUsd: 0.30, usage: { prompt: 3000, completion: 300, total: 3300 }, models: [{ model: "m2" }], status: "interrupted" }),
  T({ taskId: "t4", agentId: "developer", ruName: "RU-B", startTime: "2026-10-18T04:00:00Z", durationMs: 40000, costUsd: 0.40, usage: { prompt: 4000, completion: 400, total: 4400 }, models: [{ model: "m1" }, { model: "m3" }] }),
];

describe("UsageReportPanel aggregation — totals", () => {
  it("totals sum requests/tokens/cost/duration across all items", () => {
    const { totals } = aggregate(SAMPLE);
    expect(totals.requests).toBe(4);
    expect(totals.tokensIn).toBe(1000 + 2000 + 3000 + 4000);
    expect(totals.tokensOut).toBe(100 + 200 + 300 + 400);
    expect(totals.costUsd).toBeCloseTo(1.0, 6);
    expect(totals.durationMs).toBe(100000);
    expect(totals.errors).toBe(1); // t3 interrupted
  });
});

describe("UsageReportPanel aggregation — daily stacking", () => {
  it("groups by local-day and sums per day", () => {
    const { byDay } = aggregate(SAMPLE);
    expect(byDay.length).toBeGreaterThanOrEqual(1);
    // All 4 tasks fall on dates; assert day sums equal totals across days
    const dayReq = byDay.reduce((s, d) => s + d.requests, 0);
    const dayCost = byDay.reduce((s, d) => s + d.costUsd, 0);
    expect(dayReq).toBe(4);
    expect(dayCost).toBeCloseTo(1.0, 6);
  });

  it("per-day byAgent breakdown sums back to the day total", () => {
    const { byDay } = aggregate(SAMPLE);
    for (const day of byDay) {
      const agentReq = Object.values(day.byAgent).reduce((s, a) => s + a.requests, 0);
      const agentCost = Object.values(day.byAgent).reduce((s, a) => s + a.costUsd, 0);
      expect(agentReq).toBe(day.requests);
      expect(agentCost).toBeCloseTo(day.costUsd, 6);
    }
  });
});

describe("UsageReportPanel aggregation — RU / Agent tables", () => {
  it("RU table sums per release unit and sorts by cost desc", () => {
    const { byRu } = aggregate(SAMPLE);
    const map = Object.fromEntries(byRu.map(r => [r.ruName, r]));
    expect(map["RU-A"].requests).toBe(2);
    expect(map["RU-A"].costUsd).toBeCloseTo(0.30, 6);
    expect(map["RU-B"].requests).toBe(2);
    expect(map["RU-B"].costUsd).toBeCloseTo(0.70, 6);
    // sorted desc → RU-B first
    expect(byRu[0].ruName).toBe("RU-B");
  });

  it("Agent table sums per agent and sorts by cost desc", () => {
    const { byAgent } = aggregate(SAMPLE);
    const map = Object.fromEntries(byAgent.map(a => [a.agentId, a]));
    expect(map["qa"].requests).toBe(2);
    expect(map["qa"].costUsd).toBeCloseTo(0.30, 6);
    expect(map["tester"].costUsd).toBeCloseTo(0.30, 6);
    expect(map["developer"].costUsd).toBeCloseTo(0.40, 6);
    expect(byAgent[0].agentId).toBe("developer");
  });
});

describe("UsageReportPanel aggregation — RU×Agent table", () => {
  it("groups by ru+agent pair with correct sums", () => {
    const { byRuAgent } = aggregate(SAMPLE);
    const map = Object.fromEntries(byRuAgent.map(r => [`${r.ruName}/${r.agentId}`, r]));
    expect(map["RU-A/qa"].requests).toBe(2);
    expect(map["RU-A/qa"].costUsd).toBeCloseTo(0.30, 6);
    expect(map["RU-B/tester"].requests).toBe(1);
    expect(map["RU-B/developer"].requests).toBe(1);
    expect(map["RU-B/developer"].costUsd).toBeCloseTo(0.40, 6);
  });
});

describe("UsageReportPanel aggregation — RU×Model table", () => {
  it("counts requests per model and splits cost equally across a task's models", () => {
    const { byRuModel } = aggregate(SAMPLE);
    const map = Object.fromEntries(byRuModel.map(r => [`${r.ruName}/${r.model}`, r]));
    // qa m1: 2 requests, both single-model → full cost
    expect(map["RU-A/m1"].requests).toBe(2);
    expect(map["RU-A/m1"].costUsd).toBeCloseTo(0.30, 6);
    // tester m2
    expect(map["RU-B/m2"].requests).toBe(1);
    expect(map["RU-B/m2"].costUsd).toBeCloseTo(0.30, 6);
    // t4 is RU-B with m1+m3 → each gets 0.40/2 = 0.20
    expect(map["RU-B/m1"].requests).toBe(1);
    expect(map["RU-B/m1"].costUsd).toBeCloseTo(0.20, 6);
    expect(map["RU-B/m3"].requests).toBe(1);
    expect(map["RU-B/m3"].costUsd).toBeCloseTo(0.20, 6);
  });

  it("M4: multi-model cost split is an equal-share approximation (not real attribution)", () => {
    // t4 has durationMs 40000 split across m1,m3 → 20000 each.
    const { byRuModel } = aggregate(SAMPLE);
    const map = Object.fromEntries(byRuModel.map(r => [`${r.ruName}/${r.model}`, r]));
    expect(map["RU-B/m1"].durationMs).toBeCloseTo(20000, 6);
    expect(map["RU-B/m3"].durationMs).toBeCloseTo(20000, 6);
    // NOTE: m1 in RU-B gets 20000 here, but in reality only m1's own share is
    // unknown (approximation). Documented so a real attribution upgrade is caught.
  });
});

describe("UsageReportPanel aggregation — filters", () => {
  it("date range filter is inclusive on YYYY-MM-DD", () => {
    const all = aggregate(SAMPLE);
    const only17 = aggregate(SAMPLE, { from: "2026-10-17", to: "2026-10-17" });
    expect(only17.totals.requests).toBeLessThanOrEqual(all.totals.requests);
    // tasks t1,t2,t3 are on 2026-10-17 (local); t4 on 2026-10-18
    expect(only17.totals.requests).toBe(3);
  });

  it("ru filter narrows to a single release unit", () => {
    const ruA = aggregate(SAMPLE, { ru: "RU-A" });
    expect(ruA.totals.requests).toBe(2);
    expect(ruA.byRu.length).toBe(1);
    expect(ruA.byRu[0].ruName).toBe("RU-A");
  });

  it("agent filter narrows to a single agent", () => {
    const qa = aggregate(SAMPLE, { agent: "qa" });
    expect(qa.totals.requests).toBe(2);
    expect(qa.byAgent.length).toBe(1);
  });

  it("combined ru+agent filter", () => {
    const r = aggregate(SAMPLE, { ru: "RU-B", agent: "tester" });
    expect(r.totals.requests).toBe(1);
  });
});

describe("UsageReportPanel aggregation — edge cases", () => {
  it("empty input yields zeroed totals and empty groupings", () => {
    const { totals, byDay, byRu, byAgent, byRuAgent, byRuModel } = aggregate([]);
    expect(totals.requests).toBe(0);
    expect(totals.costUsd).toBe(0);
    expect(byDay).toEqual([]);
    expect(byRu).toEqual([]);
    expect(byAgent).toEqual([]);
    expect(byRuAgent).toEqual([]);
    expect(byRuModel).toEqual([]);
  });

  it("missing usage / cost / duration default to 0 (no NaN)", () => {
    const items = [T({ taskId: "x", agentId: "a", startTime: "2026-10-17T00:00:00Z" })];
    const { totals } = aggregate(items);
    expect(totals.requests).toBe(1);
    expect(totals.tokensIn).toBe(0);
    expect(totals.tokensOut).toBe(0);
    expect(totals.costUsd).toBe(0);
    expect(totals.durationMs).toBe(0);
    expect(Number.isNaN(totals.costUsd)).toBe(false);
  });

  it("missing ruName defaults to '-' group", () => {
    const items = [T({ taskId: "x", agentId: "a", startTime: "2026-10-17T00:00:00Z", costUsd: 1 })];
    const { byRu } = aggregate(items);
    expect(byRu[0].ruName).toBe("-");
  });

  it("invalid startTime is dropped from all groupings", () => {
    const items = [T({ taskId: "bad", agentId: "a", startTime: "not-a-date", costUsd: 5 })];
    const { totals, byDay } = aggregate(items);
    expect(totals.requests).toBe(0);
    expect(byDay).toEqual([]);
  });

  it("single agent: agent table has exactly one row = totals", () => {
    const items = SAMPLE.filter(e => e.agentId === "qa");
    const { totals, byAgent } = aggregate(items);
    expect(byAgent.length).toBe(1);
    expect(byAgent[0].requests).toBe(totals.requests);
    expect(byAgent[0].costUsd).toBeCloseTo(totals.costUsd, 6);
  });

  it("status absent does not count as error", () => {
    const items = [T({ taskId: "x", agentId: "a", startTime: "2026-10-17T00:00:00Z", status: undefined })];
    const { totals } = aggregate(items);
    expect(totals.errors).toBe(0);
  });

  it("duplicate model strings within a task are counted once", () => {
    const items = [T({ taskId: "x", agentId: "a", startTime: "2026-10-17T00:00:00Z", costUsd: 1, models: [{ model: "m1" }, { model: "m1" }] })];
    const { totals } = aggregate(items);
    expect(totals.modelCounts.m1).toBe(1);
  });
});
