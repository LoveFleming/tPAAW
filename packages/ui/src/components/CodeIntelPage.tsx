/**
 * CodeIntelPage — 📞 Code Intelligence 頁（宮殿 + 神）
 *
 * 「偉大的資料層需要好的宮殿與神」— 左宮殿右神
 *
 * 四個 sub-tab：
 *   📞 Call Graph — 搜尋函數 → callers/callees 雙欄互跳
 *   🔗 Deps      — 單檔依賴查詢（forward/reverse/externals）
 *   🎯 Impact    — 改前影響分析（輸入檔案 → 受影響範圍）
 *   🩺 Health    — analyze 分數 + gates 發布門檻
 *
 * 右欄：🏛️ Architect AI（coding.architect）— 每個結果區都有「問 AI」按鈕，
 *       帶 graph/deps/impact 證據注入（No answer without evidence）。
 * 取代：RuView（退休）+ ReleaseUnitPanel（退休）— 資料層 release-unit-model 不動。
 */

import React, { useEffect, useMemo, useRef, useState, forwardRef } from "react";
import { useI18n } from "../i18n";
import { useTheme } from "../theme";
import AgentSideChat, { type AgentSideChatHandle } from "./AgentSideChat";
import { useRuModel, type RuFeatureLite } from "./useRuModel";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4097";

type SubTab = "callgraph" | "deps" | "impact" | "health";

// ── 資料形狀（寬鬆防禦）──
interface CgNode { id: string; name: string; file: string; kind?: string }
interface CodeIntel {
  apiMap?: { routes?: { method: string; path: string; file?: string; handler?: string }[] };
  callGraph?: {
    nodes?: CgNode[];
    callersOf?: Record<string, string[]>;
    calleesOf?: Record<string, string[]>;
    stats?: { totalNodes?: number; totalEdges?: number; totalFunctions?: number } | null;
  };
}
interface DepsQuery { file: string; found: boolean; forward?: string[]; reverse?: string[]; externals?: string[] }
interface ImpactResult {
  changed?: number; affectedCount?: number; dependsOn?: number; hotspots?: number;
  affected?: { file: string; depth: number; changeType?: string }[];
}
interface AnalyzeResult { score?: number; grade?: string; risks?: { id: string; severity: string; title: string; detail?: string }[]; signals?: Record<string, any> }
interface GatesResult { overall?: string; gates?: { gate: string; required?: boolean; status: string; detail?: string }[] }

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

interface Props {
  rootPath: string;
  onOpenFile?: (absPath: string) => void;
}

function CodeIntelPageInner({ rootPath, onOpenFile }: Props, ref: React.Ref<AgentSideChatHandle | null>) {
  const { t } = useI18n();
  const themeCtx = useTheme();
  const borderLight = "#f0f0f0";
  const accentText = themeCtx?.info?.accentText || "#0369a1";

  const [tab, setTab] = useState<SubTab>("callgraph");
  const ruFeatures: RuFeatureLite[] = useRuModel(rootPath)?.features || [];
  const [codeIntel, setCodeIntel] = useState<CodeIntel | null>(null);
  const chatRef = useRef<AgentSideChatHandle>(null);
  React.useImperativeHandle(ref, () => ({
    send: (text: string) => { chatRef.current?.send(text); },
  }));

  // ── Call Graph state ──
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<{ name: string; file: string } | null>(null);
  const [featureScope, setFeatureScope] = useState<string>(""); // "" = 全部；F-xxx = 限縮該 feature 的檔案
  const composingRef = useRef(false); // IME 三層保護

  // ── Deps state ──
  const [depsInput, setDepsInput] = useState("");
  const [depsQuery, setDepsQuery] = useState<DepsQuery | null>(null);
  const [depsBusy, setDepsBusy] = useState(false);

  // ── Impact state ──
  const [impactInput, setImpactInput] = useState("");
  const [impactResult, setImpactResult] = useState<ImpactResult | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);
  const impactComposingRef = useRef(false);

  // ── Health state ──
  const [analyze, setAnalyze] = useState<AnalyzeResult | null>(null);
  const [gates, setGates] = useState<GatesResult | null>(null);

  useEffect(() => {
    if (!rootPath) { setCodeIntel(null); return; }
    let cancelled = false;
    fetch(`${API_BASE}/api/ru/code-intel?path=${encodeURIComponent(rootPath)}`)
      .then(r => r.json()).then(d => { if (!cancelled) setCodeIntel(d); })
      .catch(() => { if (!cancelled) setCodeIntel(null); });
    return () => { cancelled = true; };
  }, [rootPath]);

  useEffect(() => {
    if (!rootPath || tab !== "health") return;
    let cancelled = false;
    Promise.all([
      fetch(`${API_BASE}/api/ru/analyze?path=${encodeURIComponent(rootPath)}`).then(r => r.json()).catch(() => null),
      fetch(`${API_BASE}/api/ru/gates?path=${encodeURIComponent(rootPath)}`).then(r => r.json()).catch(() => null),
    ]).then(([a, g]) => {
      if (cancelled) return;
      setAnalyze(a && Array.isArray(a.risks) ? a : null);
      setGates(g && Array.isArray(g.gates) ? g : null);
    });
    return () => { cancelled = true; };
  }, [rootPath, tab]);

  const nodes = codeIntel?.callGraph?.nodes || [];
  const callersOf = codeIntel?.callGraph?.callersOf || {};
  const calleesOf = codeIntel?.callGraph?.calleesOf || {};
  const cgStats = codeIntel?.callGraph?.stats;

  const scopeFiles = useMemo(() => {
    if (!featureScope) return null;
    const f = ruFeatures.find(x => x.id === featureScope);
    return f ? new Set(f.files || []) : null;
  }, [featureScope, ruFeatures]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const inScope = (n: CgNode) => !scopeFiles || scopeFiles.has(n.file || "");
    const list = needle
      ? nodes.filter(n => inScope(n) && (n.name.toLowerCase().includes(needle) || (n.file || "").toLowerCase().includes(needle)))
      : nodes.filter(n => inScope(n) && (callersOf[n.name] || []).length > 0);
    return list.slice(0, 60);
  }, [q, nodes, callersOf, scopeFiles]);

  const callers = selected ? [...new Set(callersOf[selected.name] || [])] : [];
  const callees = selected ? [...new Set(calleesOf[selected.name] || [])] : [];

  const splitRef = (ref: string) => {
    const i = ref.lastIndexOf(":");
    return i > 0 ? { file: ref.slice(0, i), fn: ref.slice(i + 1) } : { file: "", fn: ref };
  };

  const FeatureChips = ({ active, onPick }: { active: string; onPick: (id: string, files: string[]) => void }) => (
    <div className="flex gap-1 overflow-x-auto pb-1" data-testid="ci-feature-chips">
      <button onClick={() => onPick("", [])}
        className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors ${active === "" ? "bg-stone-800 text-white border-stone-800" : "bg-white text-stone-500 border-stone-200 hover:border-stone-400"}`}>
        {t("codeIntel.allFeatures")}
      </button>
      {ruFeatures.map(f => (
        <button key={f.id} onClick={() => onPick(f.id, f.files || [])} title={f.name}
          data-testid={`ci-feature-chip-${f.id}`}
          className={`shrink-0 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border transition-colors ${active === f.id ? "text-white border-transparent" : "bg-white text-stone-500 border-stone-200 hover:border-stone-400"}`}
          style={active === f.id ? { backgroundColor: "#7c3aed" } : undefined}>
          {f.id}
        </button>
      ))}
    </div>
  );

  const FileLink = ({ file, children }: { file: string; children?: React.ReactNode }) => (
    <button onClick={() => onOpenFile?.(`${rootPath}/${file}`)}
      className="text-left hover:underline break-all font-mono" style={{ color: accentText }}
      title={`${rootPath}/${file}`}>{children ?? file}</button>
  );

  const askImpact = () => {
    if (!impactResult) return;
    const lines = (impactResult.affected || []).map(a => `${"  ".repeat(Math.max(0, a.depth - 1))}${a.file}${a.changeType === "delete" ? " [刪除]" : ""}`).join("\n");
    chatRef.current?.send(
      `影響分析結果（我輸入的檔案）：\n${impactInput}\n\n` +
      `受影響檔案（${impactResult.affectedCount} 個）：\n${lines}\n\n` +
      `請以架構師觀點評估：1) 這個改動的風險等級 2) 需要特別小心的串接點 3) 建議的驗證順序`
    );
  };

  const askDeps = () => {
    if (!depsQuery) return;
    chatRef.current?.send(
      `檔案依賴查詢結果：${depsQuery.file}\n` +
      `← 我依賴（forward ${depsQuery.forward?.length || 0}）：${(depsQuery.forward || []).join(", ")}\n` +
      `→ 依賴我（reverse ${depsQuery.reverse?.length || 0}）：${(depsQuery.reverse || []).join(", ")}\n` +
      `🌐 外部套件：${(depsQuery.externals || []).join(", ")}\n\n` +
      `請分析這個檔案在架構中的角色，以及修改它時的注意事項`
    );
  };

  const askCallers = () => {
    if (!selected) return;
    chatRef.current?.send(
      `函數 ${selected.name}()（檔案 ${selected.file}）的調用關係：\n` +
      `← 誰調用它（${callers.length}）：${callers.join(", ")}\n` +
      `→ 它調用（${callees.length}）：${callees.join(", ")}\n\n` +
      `我要修改這個函數：1) 誰會被影響 2) 有什麼風險 3) 建議怎麼安全地改`
    );
  };

  const runDeps = async () => {
    if (!depsInput.trim() || depsBusy) return;
    setDepsBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/ru/dependencies?path=${encodeURIComponent(rootPath)}&file=${encodeURIComponent(depsInput.trim())}&direction=both`);
      const d = await res.json();
      if (d?.query) setDepsQuery(d.query);
    } catch { /* keep old */ } finally { setDepsBusy(false); }
  };

  const runImpact = async () => {
    const files = impactInput.split("\n").map(s => s.trim()).filter(Boolean);
    if (!files.length || impactBusy) return;
    setImpactBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/ru/impact-analysis`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rootPath, files }),
      });
      const d = await res.json().catch(() => null);
      if (d && Array.isArray(d.affected) && typeof d.affectedCount === "number") setImpactResult(d);
    } catch { /* keep old */ } finally { setImpactBusy(false); }
  };

  if (!rootPath) {
    return <div className="flex items-center justify-center h-full text-xs text-stone-400">{t("ruTree.noProject")}</div>;
  }

  const TABS: { key: SubTab; icon: string; label: string }[] = [
    { key: "callgraph", icon: "📞", label: t("codeIntel.tabCallGraph") },
    { key: "deps", icon: "🔗", label: t("codeIntel.tabDeps") },
    { key: "impact", icon: "🎯", label: t("codeIntel.tabImpact") },
    { key: "health", icon: "🩺", label: t("codeIntel.tabHealth") },
  ];

  return (
    <div className="flex-1 flex min-w-0 overflow-hidden" data-testid="code-intel-page">
      {/* 左：宮殿 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* sub-tab bar */}
        <div className="shrink-0 flex items-center gap-1 px-3 py-2 border-b" style={{ borderColor: borderLight }}>
          {TABS.map(({ key, icon, label }) => (
            <button key={key} onClick={() => setTab(key)}
              data-testid={`ci-tab-${key}`}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors ${tab === key ? "bg-stone-800 text-white" : "text-stone-500 hover:bg-stone-100"}`}>
              {icon} {label}
            </button>
          ))}
          {cgStats && tab === "callgraph" && (
            <span className="ml-auto text-[10px] text-stone-400 font-mono">
              {cgStats.totalNodes ?? nodes.length} nodes · {cgStats.totalEdges ?? "?"} edges
            </span>
          )}
        </div>

        {/* content */}
        <div className="flex-1 overflow-y-auto p-4" data-testid={`ci-panel-${tab}`}>
          {/* ═══ 📞 Call Graph ═══ */}
          {tab === "callgraph" && (
            <div className="space-y-3" data-testid="ci-callgraph">
              <div className="text-[10px] text-stone-400 font-bold">{t("codeIntel.featureScope")}</div>
              <FeatureChips active={featureScope} onPick={(id) => setFeatureScope(id)} />
              <div className="flex gap-2">
                <input
                  value={q} onChange={e => setQ(e.target.value)}
                  onCompositionStart={() => { composingRef.current = true; }}
                  onCompositionEnd={() => { composingRef.current = false; }}
                  onKeyDown={e => { if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return; }}
                  placeholder={t("codeIntel.cgSearch")}
                  className="flex-1 text-xs font-mono px-3 py-1.5 rounded-md border bg-white focus:outline-none"
                  style={{ borderColor: borderLight }}
                  data-testid="ci-cg-search"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {/* 搜尋結果 */}
                <div className="rounded-lg border overflow-hidden max-h-[430px] overflow-y-auto" style={{ borderColor: borderLight }}>
                  <div className="px-3 py-1.5 text-[10px] font-bold text-stone-400 bg-stone-50 sticky top-0" style={{ borderBottom: `1px solid ${borderLight}` }}>
                    {t("codeIntel.cgResults")} · {results.length}{q.trim() ? "" : "+"}
                  </div>
                  {results.map(n => (
                    <button key={n.id} onClick={() => setSelected({ name: n.name, file: n.file })}
                      className={`w-full text-left px-3 py-1.5 border-b hover:bg-stone-50 ${selected?.name === n.name ? "bg-stone-100" : ""}`}
                      style={{ borderColor: borderLight }} data-testid="ci-cg-node">
                      <div className="text-[11px] font-mono font-bold text-stone-700">{n.name}<span className="text-stone-300">()</span></div>
                      <div className="text-[9px] text-stone-400 font-mono">{baseName(n.file)}</div>
                    </button>
                  ))}
                  {results.length === 0 && <div className="px-3 py-4 text-[10px] text-stone-300 text-center">{t("codeIntel.cgNoResult")}</div>}
                </div>
                {/* callers/callees */}
                <div className="space-y-3">
                  {!selected ? (
                    <div className="text-[10px] text-stone-300 py-8 text-center">{t("codeIntel.cgPick")}</div>
                  ) : (
                    <>
                      <div className="rounded-lg border px-3 py-2 flex items-start justify-between gap-2" style={{ borderColor: borderLight }}>
                        <div className="min-w-0">
                          <div className="text-xs font-mono font-bold" style={{ color: accentText }}>{selected.name}()</div>
                          {selected.file ? <FileLink file={selected.file}>{selected.file}</FileLink> : null}
                        </div>
                        <button onClick={askCallers} data-testid="ci-cg-ask"
                          className="shrink-0 text-[10px] px-2 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 font-medium">
                          💬 {t("codeIntel.askAi")}
                        </button>
                      </div>
                      {([
                        { title: `← ${t("codeIntel.cgCallers")} · ${callers.length}`, list: callers },
                        { title: `→ ${t("codeIntel.cgCallees")} · ${callees.length}`, list: callees },
                      ]).map(({ title, list }) => (
                        <div key={title} className="rounded-lg border overflow-hidden max-h-[170px] overflow-y-auto" style={{ borderColor: borderLight }}>
                          <div className="px-3 py-1 text-[10px] font-bold text-stone-400 bg-stone-50 sticky top-0" style={{ borderBottom: `1px solid ${borderLight}` }}>{title}</div>
                          {list.map(ref => {
                            const { file, fn } = splitRef(ref);
                            return (
                              <button key={ref} onClick={() => { const hit = nodes.find(n => n.name === fn && (!file || n.file === file)); if (hit) setSelected({ name: hit.name, file: hit.file }); }}
                                className="w-full text-left px-3 py-1 border-b hover:bg-stone-50 flex items-baseline justify-between gap-2" style={{ borderColor: borderLight }}>
                                <span className="text-[10px] font-mono text-stone-600">{fn}()</span>
                                <span className="text-[9px] text-stone-400 font-mono truncate">{baseName(file)}</span>
                              </button>
                            );
                          })}
                          {list.length === 0 && <div className="px-3 py-2 text-[9px] text-stone-300">—</div>}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ═══ 🔗 Deps ═══ */}
          {tab === "deps" && (
            <div className="space-y-3 max-w-3xl" data-testid="ci-deps">
              <div className="text-xs text-stone-500">{t("codeIntel.depsHint")}</div>
              <div className="flex gap-2">
                <input
                  value={depsInput} onChange={e => setDepsInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runDeps(); } }}
                  placeholder="packages/server/src/lib/xxx.mjs"
                  className="flex-1 text-xs font-mono px-3 py-1.5 rounded-md border bg-white focus:outline-none"
                  style={{ borderColor: borderLight }}
                  data-testid="ci-deps-input"
                />
                <button onClick={runDeps} disabled={depsBusy}
                  className="text-xs px-3 py-1.5 rounded-lg bg-stone-800 text-white font-semibold disabled:opacity-40"
                  data-testid="ci-deps-run">
                  {depsBusy ? "…" : t("codeIntel.depsRun")}
                </button>
              </div>
              {depsQuery && (
                <div className="space-y-3" data-testid="ci-deps-result">
                  {!depsQuery.found ? (
                    <div className="text-xs text-amber-600">{t("codeIntel.depsNotFound")}</div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-mono font-bold" style={{ color: accentText }}>{depsQuery.file}</div>
                        <button onClick={askDeps} className="text-[10px] px-2 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 font-medium">
                          💬 {t("codeIntel.askAi")}
                        </button>
                      </div>
                      {([
                        { key: "forward", label: t("codeIntel.depsForward"), list: depsQuery.forward },
                        { key: "reverse", label: t("codeIntel.depsReverse"), list: depsQuery.reverse },
                        { key: "externals", label: t("codeIntel.depsExternals"), list: depsQuery.externals },
                      ]).map(({ key, label, list }) => (
                        <div key={key} className="rounded-lg border overflow-hidden" style={{ borderColor: borderLight }}>
                          <div className="px-3 py-1 text-[10px] font-bold text-stone-400 bg-stone-50" style={{ borderBottom: `1px solid ${borderLight}` }}>{label} · {list?.length || 0}</div>
                          {(list || []).map(f => (
                            <button key={f} onClick={() => { setDepsInput(f); }}
                              className="w-full text-left px-3 py-1 border-b hover:bg-stone-50 text-[10px] font-mono text-stone-600 last:border-0"
                              style={{ borderColor: borderLight }}>
                              {f}
                            </button>
                          ))}
                          {(!list || list.length === 0) && <div className="px-3 py-2 text-[9px] text-stone-300">—</div>}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ═══ 🎯 Impact ═══ */}
          {tab === "impact" && (
            <div className="space-y-3 max-w-3xl" data-testid="ci-impact">
              <div className="text-xs text-stone-500">{t("codeIntel.impactHint")}</div>
              <div className="text-[10px] text-stone-400 font-bold">{t("codeIntel.impactFromFeature")}</div>
              <FeatureChips active="" onPick={(_, files) => { if (files.length) setImpactInput(files.join("\n")); }} />
              <textarea
                value={impactInput} onChange={e => setImpactInput(e.target.value)}
                onCompositionStart={() => { impactComposingRef.current = true; }}
                onCompositionEnd={() => { impactComposingRef.current = false; }}
                onKeyDown={e => {
                  if (impactComposingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runImpact(); }
                }}
                placeholder={"packages/server/src/lib/xxx.mjs\npackages/ui/src/components/Yyy.tsx"}
                rows={4}
                className="w-full text-xs font-mono px-3 py-2 rounded-md border bg-white focus:outline-none resize-y"
                style={{ borderColor: borderLight }}
                data-testid="ci-impact-input"
              />
              <button onClick={runImpact} disabled={impactBusy}
                className="text-xs px-3 py-1.5 rounded-lg bg-stone-800 text-white font-semibold disabled:opacity-40"
                data-testid="ci-impact-run">
                {impactBusy ? "…" : t("codeIntel.impactRun")}
              </button>
              {impactResult && (
                <div className="space-y-2" data-testid="ci-impact-result">
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-[10px] px-2 py-1 rounded-lg bg-stone-100 font-mono">{t("codeIntel.impactChanged")} {impactResult.changed}</span>
                    <span className="text-[10px] px-2 py-1 rounded-lg bg-amber-50 text-amber-700 font-mono">{t("codeIntel.impactAffected")} {impactResult.affectedCount}</span>
                    <span className="text-[10px] px-2 py-1 rounded-lg bg-stone-100 font-mono">{t("codeIntel.impactDependsOn")} {impactResult.dependsOn}</span>
                    <button onClick={askImpact} className="ml-auto text-[10px] px-2 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 font-medium">
                      💬 {t("codeIntel.askAi")}
                    </button>
                  </div>
                  <div className="rounded-lg border overflow-hidden" style={{ borderColor: borderLight }}>
                    {(impactResult.affected || []).map((a, i) => (
                      <button key={`${a.file}-${i}`} onClick={() => onOpenFile?.(`${rootPath}/${a.file}`)}
                        className="w-full text-left px-3 py-1 border-b hover:bg-stone-50 flex items-baseline gap-2 last:border-0"
                        style={{ borderColor: borderLight }}>
                        <span className="text-[9px] text-stone-400 font-mono shrink-0">d{a.depth}</span>
                        <FileLink file={a.file} />
                        {a.changeType === "delete" && <span className="text-[9px] text-red-500 font-bold">DEL</span>}
                      </button>
                    ))}
                    {(impactResult.affected || []).length === 0 && (
                      <div className="px-3 py-2 text-[10px] text-stone-400">{t("codeIntel.impactNone")}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ 🩺 Health ═══ */}
          {tab === "health" && (
            <div className="space-y-4 max-w-3xl" data-testid="ci-health">
              {!analyze ? (
                <div className="text-xs text-stone-400 py-8 text-center">{t("codeIntel.healthLoading")}</div>
              ) : (
                <>
                  <div className="flex gap-3">
                    <div className="px-4 py-3 rounded-lg border text-center" style={{ borderColor: borderLight }}>
                      <div className="text-3xl font-bold" style={{ color: (analyze.score ?? 0) >= 80 ? "#16a34a" : (analyze.score ?? 0) >= 60 ? "#d97706" : "#dc2626" }}>
                        {analyze.score ?? "?"}
                      </div>
                      <div className="text-[10px] text-stone-400 font-bold">Grade {analyze.grade ?? "?"}</div>
                    </div>
                    <div className="flex-1 rounded-lg border p-3 space-y-1" style={{ borderColor: borderLight }}>
                      <div className="text-[10px] font-bold text-stone-400">{t("codeIntel.healthRisks")}</div>
                      {(analyze.risks || []).slice(0, 6).map(r => (
                        <div key={r.id} className="text-xs flex gap-2">
                          <span className={r.severity === "high" ? "text-red-500 font-bold" : r.severity === "medium" ? "text-amber-500 font-bold" : "text-stone-400 font-bold"}>
                            {r.severity.toUpperCase()}
                          </span>
                          <span className="text-stone-600">{r.title}</span>
                        </div>
                      ))}
                      {(analyze.risks || []).length === 0 && <div className="text-[10px] text-stone-300">—</div>}
                    </div>
                  </div>
                  {gates && (
                    <div className="rounded-lg border overflow-hidden" style={{ borderColor: borderLight }}>
                      <div className="px-3 py-1.5 text-[10px] font-bold text-stone-400 bg-stone-50" style={{ borderBottom: `1px solid ${borderLight}` }}>
                        🚧 {t("codeIntel.healthGates")} · overall: {gates.overall}
                      </div>
                      {(gates.gates || []).map(g => (
                        <div key={g.gate} className="px-3 py-1.5 border-b flex items-center gap-2 last:border-0" style={{ borderColor: borderLight }}>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${g.status === "pass" ? "bg-green-100 text-green-700" : g.status === "blocked" || g.status === "fail" ? "bg-red-100 text-red-700" : "bg-stone-100 text-stone-500"}`}>
                            {g.status}
                          </span>
                          <span className="text-xs font-mono text-stone-700">{g.gate}</span>
                          <span className="text-[10px] text-stone-400 truncate">{g.detail}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 右：神 — Architect AI */}
      <div className="shrink-0 border-l hidden xl:flex flex-col" style={{ width: 340, borderColor: borderLight }}>
        <AgentSideChat
          ref={chatRef}
          agentId="architect"
          agentName={t("codeIntel.architectName")}
          agentEmoji="🏛️"
          greeting={t("codeIntel.architectGreeting")}
          cwd={rootPath}
          accent="#7c3aed"
          height="100%"
          placeholder={t("codeIntel.architectPlaceholder")}
          suggestions={[
            { label: t("codeIntel.sug1Label"), prompt: t("codeIntel.sug1Prompt") },
            { label: t("codeIntel.sug2Label"), prompt: t("codeIntel.sug2Prompt") },
          ]}
        />
      </div>
    </div>
  );
}

const CodeIntelPage = forwardRef<AgentSideChatHandle | null, Props>(CodeIntelPageInner);
export default CodeIntelPage;
