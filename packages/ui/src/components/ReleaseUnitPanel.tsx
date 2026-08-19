/**
 * ReleaseUnitPanel — 🧭 Release Unit 工具箱
 *
 * 「AI 開發三防線的儀表板：懂 context → 知影響 → 能驗證」
 *
 * 五區：
 *   1. Health — analyze 分數 + 風險清單
 *   2. Impact — 改前影響分析（textarea 輸入檔案 → 受影響範圍）
 *   3. Deps   — 單檔依賴查詢（forward / reverse / externals）
 *   4. Verify — build/lint/type-check/test 執行 + 上次結果
 *   5. Gates  — 發布門檻狀態
 *
 * 空狀態設計（新 import 的 release unit 沒有 .paaw/）：
 *   不空白不報錯 → 引導初始化（Code Understanding → 補規範 → 工具就緒），
 *   附「打開 EM 大總管」按鈕直接跳轉。
 *
 * IME 紀律：impact textarea 有 Enter 送出 → useRef composition 三層保護。
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import { cn } from "../utils";

interface AnalyzeResult {
  score: number;
  grade: string;
  risks: { id: string; severity: string; title: string; detail?: string; suggestion?: string }[];
  signals: any;
}

interface ImpactResult {
  changed: string[];
  unresolved: string[];
  affected: { file: string; depth: number }[];
  affectedCount: number;
  hotspots: { file: string; dependents: number }[];
}

interface DepsResult {
  query: { file: string; found: boolean; forward?: string[]; reverse?: string[]; externals?: string[] };
}

interface VerifyReport {
  overall: string;
  ran: string[];
  checks: { check: string; ok: boolean; durationMs: number; output?: string }[];
  generatedAt: string;
}

interface GatesResult {
  overall: string;
  gates: { gate: string; required: boolean; status: string; detail?: string }[];
  blocking: string[];
}

interface Props {
  rootPath: string;
  theme: any;
  onOpenEMDashboard?: () => void;
}

const SEV_COLOR: Record<string, string> = { high: "#dc2626", medium: "#d97706", low: "#0ea5e9" };
const gradeColor = (g: string) => g === "A" ? "#16a34a" : g === "B" ? "#84cc16" : g === "C" ? "#d97706" : "#dc2626";

export default function ReleaseUnitPanel({ rootPath, theme: tk, onOpenEMDashboard }: Props) {
  const { t } = useI18n();
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [analyze, setAnalyze] = useState<AnalyzeResult | null>(null);
  const [initBusy, setInitBusy] = useState(false);
  const [loopMode, setLoopMode] = useState<"mini" | "full" | null>(null);

  // Loop mode 切換（PUT 後樂觀更新，失敗回滾）— 與 EM Dashboard 同一 API
  const handleLoopModeChange = useCallback((mode: "mini" | "full") => {
    if (!rootPath || loopMode === mode) return;
    const prev = loopMode;
    setLoopMode(mode); // optimistic
    fetch(`${API_BASE}/api/coding-tasks/project/loop-mode?path=${encodeURIComponent(rootPath)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loopMode: mode }),
    })
      .then(r => r.json())
      .then(d => { if (!d.ok) setLoopMode(prev); })
      .catch(() => setLoopMode(prev));
  }, [rootPath, loopMode]);

  // impact
  const composingRef = useRef(false);
  const [impactInput, setImpactInput] = useState("");
  const [impactResult, setImpactResult] = useState<ImpactResult | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);

  // deps
  const [depsInput, setDepsInput] = useState("");
  const [depsResult, setDepsResult] = useState<DepsResult["query"] | null>(null);

  // verify
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyLast, setVerifyLast] = useState<VerifyReport | null>(null);

  // gates
  const [gates, setGates] = useState<GatesResult | null>(null);

  const refresh = useCallback(async () => {
    if (!rootPath) return;
    try {
      const oRes = await fetch(`${API_BASE}/api/ru/overview?path=${encodeURIComponent(rootPath)}`);
      const o = await oRes.json();
      // 防禦：API 回 error shape（路徑無效/掃描失敗）不得炸 UI — 視為未初始化
      if (!o || o.error || typeof o.initialized !== "boolean") {
        setInitialized(false);
        return;
      }
      setInitialized(!!o.initialized);
      setLoopMode(o.loopMode === "full" ? "full" : "mini");
      if (o.initialized) {
        const [aRes, vRes, gRes] = await Promise.all([
          fetch(`${API_BASE}/api/ru/analyze?path=${encodeURIComponent(rootPath)}`),
          fetch(`${API_BASE}/api/ru/verify?path=${encodeURIComponent(rootPath)}`),
          fetch(`${API_BASE}/api/ru/gates?path=${encodeURIComponent(rootPath)}`),
        ]);
        // 防禦：非預期 shape（{error}、500 HTML parse 失敗）→ 保持 null，render 端顯示載入失敗而非白屏
        const a = await aRes.json().catch(() => null);
        setAnalyze(a && Array.isArray(a.risks) ? a : null);
        const v = await vRes.json().catch(() => null);
        setVerifyLast(v && v.last && Array.isArray(v.last.checks) ? v.last : null);
        const g = await gRes.json().catch(() => null);
        setGates(g && Array.isArray(g.gates) ? g : null);
      }
    } catch {
      setInitialized(false);
    }
  }, [rootPath]);

  useEffect(() => { refresh(); }, [refresh]);

  const runImpact = useCallback(async () => {
    const files = impactInput.split("\n").map(s => s.trim()).filter(Boolean);
    if (!files.length || impactBusy) return;
    setImpactBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/ru/impact-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rootPath, files }),
      });
      const d = await res.json().catch(() => null);
      // 防禦：error shape（affected/affectedCount 缺失）不進 state
      if (d && Array.isArray(d.affected) && typeof d.affectedCount === "number") setImpactResult(d);
    } catch { /* keep old result */ } finally { setImpactBusy(false); }
  }, [rootPath, impactInput, impactBusy]);

  const runDeps = useCallback(async () => {
    if (!depsInput.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/ru/dependencies?path=${encodeURIComponent(rootPath)}&file=${encodeURIComponent(depsInput.trim())}&direction=both`);
      const d = await res.json().catch(() => null);
      setDepsResult(d && d.query && typeof d.query.found === "boolean" ? d.query : null);
    } catch { /* ignore */ }
  }, [rootPath, depsInput]);

  const runVerify = useCallback(async () => {
    if (verifyBusy) return;
    setVerifyBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/ru/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rootPath }),
      });
      const r = await res.json().catch(() => null);
      if (r && r.overall && Array.isArray(r.checks)) setVerifyLast(r);
      // gates 依 verify 結果判定 — 一起刷新（shape 防禦同 refresh）
      const gRes = await fetch(`${API_BASE}/api/ru/gates?path=${encodeURIComponent(rootPath)}`);
      const g = await gRes.json().catch(() => null);
      setGates(g && Array.isArray(g.gates) ? g : null);
    } catch { /* ignore */ } finally { setVerifyBusy(false); }
  }, [rootPath, verifyBusy]);

  const gateBadge = (status: string, required: boolean) => {
    if (status === "pass") return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-50 text-green-700 border border-green-200">✅ pass</span>;
    if (status === "fail") return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">❌ {required ? "fail" : "warn"}</span>;
    if (status === "warn") return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">⚠️ warn</span>;
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-stone-100 text-stone-500 border border-stone-200">{status}</span>;
  };

  return (
    <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
      {/* Header */}
      <div className="px-5 py-3 border-b sticky top-0 bg-white/95 backdrop-blur z-10" style={{ borderColor: tk.borderLight }}>
        <div className="flex items-center gap-2">
          <span className="text-lg">🧭</span>
          <h2 className="text-sm font-bold text-stone-800">{t("ru.title")}</h2>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">/api/ru/*</span>
        </div>
        <p className="text-[11px] text-stone-400 mt-0.5">{t("ru.subtitle")}</p>
      </div>

      {/* 載入中 */}
      {initialized === null && <div className="p-8 text-center text-xs text-stone-400 animate-pulse">{t("ru.loading")}</div>}

      {/* ═══ 空狀態：未初始化（無 .paaw/）— 引導初始化，不空白不報錯 ═══ */}
      {initialized === false && (
        <div className="p-8">
          <div className="max-w-md mx-auto text-center border rounded-xl p-6 bg-stone-50" style={{ borderColor: tk.borderLight }}>
            <div className="text-3xl mb-2">🌱</div>
            <h3 className="text-sm font-bold text-stone-700 mb-1">{t("ru.emptyInit.title")}</h3>
            <p className="text-xs text-stone-500 leading-relaxed mb-4">{t("ru.emptyInit.desc")}</p>
            <div className="text-left bg-white rounded-lg border p-3 text-[11px] text-stone-500 space-y-1.5" style={{ borderColor: tk.borderLight }}>
              <div>1️⃣ {t("ru.emptyInit.step1")}</div>
              <div>2️⃣ {t("ru.emptyInit.step2")}</div>
              <div>3️⃣ {t("ru.emptyInit.step3")}</div>
            </div>
            {/* 一鍵初始化 .paaw（用既有 /api/coding-project/init 建骨架）*/}
            <div className="flex items-center justify-center gap-2 mt-4">
              <button
                onClick={async () => {
                  if (initBusy) return;
                  setInitBusy(true);
                  try {
                    // 用既有 /api/coding-project/init 建立 .paaw/ 骨架（不用另開新端點）
                    await fetch(`${API_BASE}/api/coding-project/init?path=${encodeURIComponent(rootPath)}`, { method: "POST" });
                    await refresh();
                  } catch { /* refresh 會重試 */ } finally { setInitBusy(false); }
                }}
                disabled={initBusy}
                className="text-xs px-4 py-2 rounded-lg text-white disabled:opacity-50"
                style={{ backgroundColor: tk.accent }}
              >
                {initBusy ? t("ru.emptyInit.initializing") : t("ru.emptyInit.initBtn")}
              </button>
              {onOpenEMDashboard && (
                <button onClick={onOpenEMDashboard}
                  className="text-xs px-4 py-2 rounded-lg border text-stone-600 hover:bg-white"
                  style={{ borderColor: tk.borderLight }}>
                  {t("ru.emptyInit.goEM")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ 已初始化：五區工具 ═══ */}
      {initialized === true && (
        <div className="p-5 space-y-6">

          {/* ── 0. 🔁 Loop Mode 切換（開發者自己選 mini/full，决定派工管線深度）── */}
          <section className="border rounded-xl p-3 bg-white" style={{ borderColor: tk.borderLight }}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-stone-600">🔁 {t("ru.loopMode.title")}</h3>
              <span className="text-[10px] text-stone-400">{t("ru.loopMode.hint")}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleLoopModeChange("mini")}
                className={cn("flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors",
                  loopMode === "mini" ? "border-amber-400 bg-amber-50" : "border-stone-200 bg-white hover:bg-stone-50")}
              >
                <span className={cn("w-2 h-2 rounded-full", loopMode === "mini" ? "bg-amber-500" : "bg-stone-300")} />
                <span className={cn("text-sm font-bold", loopMode === "mini" ? "text-amber-700" : "text-stone-500")}>🚀 Mini</span>
                {loopMode === "mini" && <span className="text-[10px] font-bold text-amber-600">ON</span>}
              </button>
              <button
                onClick={() => handleLoopModeChange("full")}
                className={cn("flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors",
                  loopMode === "full" ? "border-blue-400 bg-blue-50" : "border-stone-200 bg-white hover:bg-stone-50")}
              >
                <span className={cn("w-2 h-2 rounded-full", loopMode === "full" ? "bg-blue-500" : "bg-stone-300")} />
                <span className={cn("text-sm font-bold", loopMode === "full" ? "text-blue-700" : "text-stone-500")}>🛡️ Full</span>
                {loopMode === "full" && <span className="text-[10px] font-bold text-blue-600">ON</span>}
              </button>
            </div>
            <p className="text-[10px] text-stone-400 mt-1.5">{loopMode === "mini" ? t("ru.loopMode.miniDesc") : t("ru.loopMode.fullDesc")}</p>
          </section>

          {/* ── 1. Health ── */}
          <section>
            <h3 className="text-xs font-bold text-stone-600 mb-2 flex items-center gap-1.5">
              🫀 {t("ru.health.title")}
              {analyze && (
                <span className="flex items-center gap-1 ml-1">
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: gradeColor(analyze.grade) }}>
                    {analyze.score} · {analyze.grade}
                  </span>
                </span>
              )}
            </h3>
            {analyze && (
              <div className="space-y-1.5">
                {analyze.risks.length === 0 && <div className="text-xs text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{t("ru.health.noRisks")}</div>}
                {analyze.risks.map(r => (
                  <div key={r.id} className="border rounded-lg px-3 py-2 bg-white" style={{ borderColor: tk.borderLight }}>
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: SEV_COLOR[r.severity] || "#a8a29e" }} />
                      <span className="text-xs font-medium text-stone-700">{r.title}</span>
                    </div>
                    {r.detail && <div className="text-[11px] text-stone-400 mt-0.5 ml-3.5">{r.detail}</div>}
                    {r.suggestion && <div className="text-[11px] text-stone-500 mt-0.5 ml-3.5">💡 {r.suggestion}</div>}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── 2. Impact ── */}
          <section>
            <h3 className="text-xs font-bold text-stone-600 mb-2">🎯 {t("ru.impact.title")}</h3>
            <div className="border rounded-lg bg-white overflow-hidden" style={{ borderColor: tk.borderLight }}>
              <textarea
                value={impactInput}
                onChange={e => setImpactInput(e.target.value)}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={() => { composingRef.current = false; }}
                onKeyDown={e => {
                  // IME 三層保護：composingRef（可靠）→ isComposing（fallback）→ keyCode 229（legacy）
                  if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runImpact(); }
                }}
                placeholder={t("ru.impact.placeholder")}
                rows={3}
                className="w-full text-xs px-3 py-2 outline-none resize-none font-mono"
                style={{ borderBottom: `1px solid ${tk.borderLight}` }}
              />
              <div className="flex items-center justify-between px-3 py-1.5 bg-stone-50">
                <span className="text-[10px] text-stone-400 font-mono">Enter ↵ 執行 · Shift+Enter 換行</span>
                <button onClick={runImpact} disabled={impactBusy || !impactInput.trim()}
                  className="text-xs px-3 py-1 rounded text-white disabled:opacity-40" style={{ backgroundColor: tk.accent }}>
                  {impactBusy ? t("ru.impact.running") : t("ru.impact.run")}
                </button>
              </div>
              {impactResult && (
                <div className="px-3 py-2 border-t space-y-2" style={{ borderColor: tk.borderLight }}>
                  {impactResult.unresolved.length > 0 && (
                    <div className="text-[11px] text-red-600">⚠️ {t("ru.impact.unresolved")}: {impactResult.unresolved.join(", ")}</div>
                  )}
                  <div className="text-[11px] font-bold text-stone-600">
                    {t("ru.impact.result")}（{impactResult.affectedCount}）
                  </div>
                  {impactResult.affectedCount === 0 ? (
                    <div className="text-xs text-green-600">{t("ru.impact.none")}</div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto text-[11px] font-mono text-stone-600 space-y-0.5" style={{ scrollbarWidth: "thin" }}>
                      {impactResult.affected.map(a => (
                        <div key={a.file} className="flex gap-2">
                          <span className={a.depth === 1 ? "text-red-500 font-bold shrink-0" : "text-stone-400 shrink-0"}>d{a.depth}</span>
                          <span className="truncate">{a.file}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {impactResult.hotspots?.length ? (
                    <div className="text-[11px] text-stone-500">
                      🔥 {t("ru.impact.hotspots")}: {impactResult.hotspots.slice(0, 3).map(h => `${h.file.split("/").pop()}(${h.dependents})`).join(" · ")}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </section>

          {/* ── 3. Deps ── */}
          <section>
            <h3 className="text-xs font-bold text-stone-600 mb-2">🕸️ {t("ru.deps.title")}</h3>
            <div className="flex gap-2 mb-2">
              <input
                value={depsInput}
                onChange={e => setDepsInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") runDeps(); }}
                placeholder={t("ru.deps.placeholder")}
                className="flex-1 text-xs px-3 py-1.5 border rounded-lg outline-none font-mono bg-white"
                style={{ borderColor: tk.borderLight }}
              />
              <button onClick={runDeps} disabled={!depsInput.trim()}
                className="text-xs px-3 py-1.5 rounded-lg text-white disabled:opacity-40" style={{ backgroundColor: tk.accent }}>
                {t("ru.deps.query")}
              </button>
            </div>
            {depsResult && (
              depsResult.found ? (
                <div className="border rounded-lg bg-white p-3 grid grid-cols-1 md:grid-cols-3 gap-3" style={{ borderColor: tk.borderLight }}>
                  {([["forward", depsResult.forward], ["reverse", depsResult.reverse], ["externals", depsResult.externals]] as const).map(([label, list]) => (
                    <div key={label}>
                      <div className="text-[11px] font-bold text-stone-500 mb-1">{t(`ru.deps.${label}`)}（{list?.length || 0}）</div>
                      <div className="max-h-40 overflow-y-auto text-[11px] font-mono text-stone-600 space-y-0.5" style={{ scrollbarWidth: "thin" }}>
                        {(list || []).map(f => <div key={f} className="truncate" title={f}>{f}</div>)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{t("ru.deps.notFound")}</div>
              )
            )}
          </section>

          {/* ── 4. Verify ── */}
          <section>
            <h3 className="text-xs font-bold text-stone-600 mb-2 flex items-center gap-2">
              🧪 {t("ru.verify.title")}
              <button onClick={runVerify} disabled={verifyBusy}
                className="text-xs px-3 py-1 rounded text-white disabled:opacity-40" style={{ backgroundColor: tk.accent }}>
                {verifyBusy ? t("ru.verify.running") : t("ru.verify.run")}
              </button>
            </h3>
            {!verifyLast ? (
              <div className="text-xs text-stone-400 bg-stone-50 border rounded-lg px-3 py-2" style={{ borderColor: tk.borderLight }}>{t("ru.verify.never")}</div>
            ) : (
              <div className="border rounded-lg bg-white overflow-hidden" style={{ borderColor: tk.borderLight }}>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-50">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${verifyLast.overall === "pass" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                    {verifyLast.overall === "pass" ? "✅ PASS" : "❌ FAIL"}
                  </span>
                  <span className="text-[10px] text-stone-400">{t("ru.verify.last")}: {verifyLast.generatedAt?.replace("T", " ").slice(0, 16)}</span>
                </div>
                {verifyLast.checks.map(c => (
                  <div key={c.check} className="px-3 py-1.5 border-t text-xs" style={{ borderColor: tk.borderLight }}>
                    <div className="flex items-center gap-2">
                      <span>{c.ok ? "✅" : "❌"}</span>
                      <span className="font-mono font-bold text-stone-700">{c.check}</span>
                      <span className="text-[10px] text-stone-400">{Math.round(c.durationMs / 100) / 10}s</span>
                    </div>
                    {!c.ok && c.output && (
                      <pre className="mt-1 text-[10px] text-red-600 bg-red-50 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap" style={{ scrollbarWidth: "thin" }}>{c.output.slice(-1200)}</pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── 5. Gates ── */}
          <section>
            <h3 className="text-xs font-bold text-stone-600 mb-2 flex items-center gap-2">
              🚧 {t("ru.gates.title")}
              <button onClick={() => fetch(`${API_BASE}/api/ru/gates?path=${encodeURIComponent(rootPath)}`).then(r => r.json()).then(g => { if (g && Array.isArray(g.gates)) setGates(g); }).catch(() => {})}
                className="text-[10px] px-2 py-0.5 rounded border text-stone-500 hover:bg-stone-50" style={{ borderColor: tk.borderLight }}>
                {t("ru.gates.refresh")}
              </button>
              {gates && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${gates.overall === "pass" ? "bg-green-100 text-green-700" : gates.overall === "pass-with-warnings" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                  {gates.overall === "pass" ? t("ru.gates.pass") : gates.overall === "pass-with-warnings" ? t("ru.gates.warn") : t("ru.gates.blocked")}
                </span>
              )}
            </h3>
            {gates && (
              <div className="border rounded-lg bg-white divide-y" style={{ borderColor: tk.borderLight }}>
                {gates.gates.map(g => (
                  <div key={g.gate} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="text-xs font-mono font-bold text-stone-700 w-24 shrink-0">{g.gate}</span>
                    {gateBadge(g.status, g.required)}
                    {g.detail && <span className="text-[10px] text-stone-400 truncate">{g.detail}</span>}
                    {g.required && <span className="text-[10px] text-stone-300 ml-auto">required</span>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
