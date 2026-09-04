/**
 * FeatureCockpit — Feature 全景頁（從 RuView 抽出，RuView 退休後唯一倖存者）
 *
 * 點 feature 卡片 → 全景：Header F-id+Fresh sha / Purpose+AI 深入理解 /
 * Entry Points 調用鏈 / Code Structure / Tests kind badges / Changes+gap chips
 * 雙模式：standalone（onBack 返回鈕）/ embedded（FeatureMap detail 用）
 */

import { useState, useEffect } from "react";
import API_BASE from "../api";

const METHOD_COLOR: Record<string, string> = {
  GET: "#16a34a", POST: "#2563eb", PUT: "#d97706", PATCH: "#9333ea",
  DELETE: "#dc2626", HEAD: "#64748b", OPTIONS: "#64748b", ANY: "#78716c",
};



interface RuTestEntry { file: string; kind?: string | null }

interface RuFeature {
  id: string; name: string; status?: string; description?: string;
  fileCount?: number; files?: string[]; apiCount?: number; apis?: string[];
  testCount?: number; tests?: RuTestEntry[]; changeCount?: number;
  lastChangeAt?: string | null; knowledgeGaps?: string[];
}

function joinPath(root: string, rel: string): string {
  const r = (root || "").replace(/[\\/]+$/, "");
  return `${r}/${rel}`;
}
function baseName(p: string): string { return p.split(/[\\/]/).slice(-2).join("/"); }
function shortDate(iso?: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1].slice(2)}/${m[2]}/${m[3]} ${m[4]}:${m[5]}` : iso.slice(0, 11);
}

const KIND_COLOR: Record<string, string> = { unit: "#64748b", integration: "#7c3aed", contract: "#d97706", e2e: "#059669" };
const COMMIT_KIND_COLOR: Record<string, string> = { feat: "#2563eb", fix: "#dc2626", refactor: "#9333ea", test: "#059669", docs: "#64748b", chore: "#78716c" };

function KindBadge({ kind }: { kind?: string | null }) {
  if (!kind) return <span className="text-[9px] text-stone-300">—</span>;
  return (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white font-mono" style={{ backgroundColor: KIND_COLOR[kind] || "#a8a29e" }} data-testid={`kind-${kind}`}>
      {kind}
    </span>
  );
}

function CallChainTree({ chain, t, borderLight }: { chain: { function: string; depth: number; file?: string; resolved?: boolean }[]; t: any; borderLight: string }) {
  return (
    <div className="font-mono text-xs leading-relaxed border-l-2 pl-2" style={{ borderColor: borderLight }} data-testid="ru-callchain">
      {chain.map((c: any, j: number) => (
        <div key={j} style={{ paddingLeft: (c.depth || 0) * 12 }} className={c.resolved ? "text-stone-600" : "text-stone-300"}>
          {"· ".repeat(Math.min(c.depth || 0, 1))}{c.function}()
        </div>
      ))}
    </div>
  );
}

export function FeatureCockpit({ feature, model, callChainMap, t, accent, borderLight, accentText, FileLink, onBack }: any) {
  const f = feature as RuFeature;
  const [showAi, setShowAi] = useState(false);
  const [aiMd, setAiMd] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false); // 2026-09-05：變更歷史明細展開
  // 此 feature 的變更明細（RU model changes 表 — deterministic，git log 來的）
  const featureChanges = ((model?.changes || []) as any[])
    .filter(c => Array.isArray(c.featureIds) && c.featureIds.includes(f.id))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const rootPath = model?.root || "";
  // aiUnderstanding 懶載（僅 standalone 模式 — embedded 時 FeatureDetail 有現成 AI 區）
  useEffect(() => {
    if (!onBack || !showAi || aiMd !== null || !rootPath) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/coding-features?path=${encodeURIComponent(rootPath)}`);
        if (!res.ok) return;
        const d = await res.json();
        const hit = (d.features || []).find((x: any) => x.id === f.id);
        if (!cancelled) setAiMd(hit?.aiUnderstanding || "");
      } catch { if (!cancelled) setAiMd(""); }
    })();
    return () => { cancelled = true; };
  }, [showAi, aiMd, f.id, rootPath, onBack]);

  const kindCounts = (f.tests || []).reduce((acc: Record<string, number>, tf) => {
    const k = tf.kind || "unknown";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  // CALL PATH 統計：feature 的 routes 所有鏈的 distinct functions / files
  const chainFns = new Set<string>();
  const chainFiles = new Set<string>();
  for (const api of f.apis || []) {
    const chain = callChainMap?.get(api);
    if (chain) for (const c of chain) {
      chainFns.add(c.function);
      if (c.file) chainFiles.add(c.file);
    }
  }
  const sha = (model?.headSha || "").slice(0, 7);

  return (
    <div className="space-y-3" data-testid={`ru-cockpit-${f.id}`}>
      {/* Header + Purpose（standalone 模式；embedded 由 FeatureDetail header 提供） */}
      {onBack && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={onBack} data-testid="ru-cockpit-back" className="text-xs px-2 py-0.5 rounded border bg-white hover:bg-stone-50" style={{ borderColor: borderLight }}>← {t("ru.view.backToList")}</button>
            <span className="text-xs font-mono font-bold" style={{ color: accentText }}>{f.id}</span>
            <span className="text-base font-bold text-stone-800">{f.name}</span>
            {f.status === "active" && <span className="text-xs text-emerald-500 font-bold">● active</span>}
            <span className="ml-auto text-xs font-mono text-stone-400">{t("ru.view.modelFresh")} @ {sha || "?"}</span>
          </div>

          <div className="rounded-lg border bg-white px-3 py-2" style={{ borderColor: accent }}>
            <div className="text-[11px] font-bold text-stone-400 mb-0.5">🎯 {t("ru.view.purpose")}</div>
            <p className="text-sm text-stone-600 leading-relaxed">{f.description || "—"}</p>
            <button onClick={() => setShowAi(v => !v)} className="text-xs mt-1 text-stone-400 hover:text-stone-600 underline">
              {showAi ? "▾" : "▸"} {t("ru.view.aiUnderstanding")}
            </button>
            {showAi && (
              aiMd === null
                ? <div className="text-xs text-stone-300 mt-1">{t("ru.view.intelLoading")}</div>
                : aiMd
                  ? <pre className="text-xs text-stone-500 whitespace-pre-wrap mt-1 max-h-72 overflow-y-auto font-mono leading-relaxed">{aiMd}</pre>
                  : <div className="text-xs text-stone-300 mt-1">{t("ru.view.noAiUnderstanding")}</div>
            )}
          </div>
        </>
      )}

      {/* Entry Points + Call Path */}
      <div className="rounded-lg border bg-white overflow-hidden" style={{ borderColor: borderLight }}>
        <div className="px-3 py-1.5 text-sm font-bold text-stone-400 bg-stone-50 flex items-center gap-2 flex-wrap" style={{ borderBottom: `1px solid ${borderLight}` }}>
          <span>⚡ {t("ru.view.entryPoints")} · {(f.apis || []).length}</span>
          {chainFns.size > 0 && <span className="font-normal">{t("ru.view.callPath")}：{chainFns.size} fns · {chainFiles.size} files</span>}
          {!onBack && <span className="ml-auto font-mono font-normal">{t("ru.view.modelFresh")} @ {sha || "?"}</span>}
        </div>
        {(f.apis || []).slice(0, 30).map((api: string) => {
          const chain = callChainMap?.get(api);
          return <EntryRow key={api} api={api} chain={chain} t={t} borderLight={borderLight} />;
        })}
        {!(f.apis || []).length && <div className="px-3 py-2 text-sm text-stone-300">—</div>}
      </div>

      {/* Code + Tests 兩欄 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border bg-white overflow-hidden" style={{ borderColor: borderLight }}>
          <div className="px-3 py-1.5 text-sm font-bold text-stone-400 bg-stone-50" style={{ borderBottom: `1px solid ${borderLight}` }}>📁 {t("ru.view.codeStructure")} · {(f.files || []).length}</div>
          <div className="px-3 py-2 space-y-0.5 max-h-64 overflow-y-auto">
            {(f.files || []).map((file: string) => <div key={file}><FileLink file={file}>{file}</FileLink></div>)}
            {!(f.files || []).length && <span className="text-sm text-stone-300">—</span>}
          </div>
        </div>
        <div className="rounded-lg border bg-white overflow-hidden" style={{ borderColor: borderLight }}>
          <div className="px-3 py-1.5 text-sm font-bold text-stone-400 bg-stone-50 flex items-center gap-2" style={{ borderBottom: `1px solid ${borderLight}` }}>
            <span>🧪 {t("ruTree.tests")} · {f.testCount ?? 0}</span>
            <span className="ml-auto flex gap-1.5">
              {Object.entries(kindCounts).map(([k, n]) => (
                <span key={k} className="flex items-center gap-0.5 font-normal"><KindBadge kind={k} />{n}</span>
              ))}
            </span>
          </div>
          <div className="px-3 py-2 space-y-0.5 max-h-64 overflow-y-auto">
            {(f.tests || []).map((tf: RuTestEntry) => (
              <div key={tf.file} className="flex items-center gap-1.5">
                <KindBadge kind={tf.kind} />
                <FileLink file={tf.file} />
              </div>
            ))}
            {!(f.tests || []).length && <div className="text-sm text-amber-500">⚠ {t("ruTree.noTests")}</div>}
          </div>
        </div>
      </div>

      {/* Changes */}
      <div className="rounded-lg border bg-white px-3 py-2 flex items-center gap-3 flex-wrap" style={{ borderColor: borderLight }}>
        <span className="text-sm font-bold text-stone-400">🕘 {t("ruTree.changeHistory")}</span>
        {(f.changeCount ?? 0) > 0 ? (
          <button onClick={() => setShowChanges(v => !v)}
            className={`text-xs px-1.5 py-0.5 rounded border font-bold flex items-center gap-1 ${showChanges ? "bg-stone-700 text-white border-stone-700" : "bg-white text-stone-500 border-stone-200 hover:border-stone-400"}`}
            title="展開變更明細">
            <span className="text-[15px] font-bold text-stone-600">{f.changeCount ?? 0}</span>
            <span>▼</span>
          </button>
        ) : (
          <span className="text-[15px] text-stone-600 font-bold">{f.changeCount ?? 0}</span>
        )}
        {f.lastChangeAt && <span className="text-xs text-stone-400 font-mono">{f.lastChangeAt.slice(0, 10)}</span>}
        <span className="ml-auto flex gap-1.5">
          {(f.knowledgeGaps || []).includes("no-tests") && <span className="text-xs text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded">gap: no-tests</span>}
          {(f.knowledgeGaps || []).includes("no-runbook") && <span className="text-xs text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded">gap: no-runbook</span>}
        </span>
      </div>
      {/* 變更明細（2026-09-05：點數字展開 — RU model changes 表，deterministic）*/}
      {showChanges && (
        <div className="rounded-lg border bg-white overflow-hidden" style={{ borderColor: borderLight }} data-testid="ru-change-detail">
          <div className="px-3 py-2 space-y-1 max-h-72 overflow-y-auto">
            {featureChanges.slice(0, 20).map((c: any) => (
              <div key={c.hash} className="flex items-start gap-2 text-xs py-0.5" style={{ borderBottom: `1px dashed ${borderLight}` }}>
                <span className="font-mono text-stone-400 shrink-0 w-[64px]" title={c.hash}>{(c.hash || "").slice(0, 7)}</span>
                <span className="font-mono text-stone-400 shrink-0 w-[92px]">{(c.date || "").slice(0, 10)}</span>
                <span className="font-bold px-1.5 py-0.5 rounded text-white shrink-0 text-[10px] font-mono" style={{ backgroundColor: COMMIT_KIND_COLOR[c.kind] || "#a8a29e" }}>{c.kind || "chore"}</span>
                <span className="text-stone-700 break-all min-w-0">{c.subject}</span>
                <span className="ml-auto text-stone-400 shrink-0 font-mono">{c.files ?? 0}f</span>
              </div>
            ))}
            {featureChanges.length > 20 && <div className="text-xs text-stone-400 text-center py-1">… 共 {featureChanges.length} 筆，僅顯示最近 20 筆</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function EntryRow({ api, chain, t, borderLight }: any) {
  const [open, setOpen] = useState(false);
  const [method, ...rest] = api.split(" ");
  return (
    <div className="border-b last:border-b-0" style={{ borderColor: borderLight }}>
      <div className="flex items-center gap-2 px-3 py-1.5">
        {chain && (
          <button onClick={() => setOpen(v => !v)}
            className={`text-xs px-1 rounded border shrink-0 ${open ? "bg-stone-700 text-white border-stone-700" : "bg-white text-stone-400 border-stone-200 hover:border-stone-400"}`}
            title={t("ru.view.callChain")}>▼</button>
        )}
        <span className="text-xs font-bold px-1.5 py-0.5 rounded text-white shrink-0" style={{ backgroundColor: METHOD_COLOR[method?.toUpperCase()] || "#6b7280" }}>{method}</span>
        <span className="text-[15px] font-mono text-stone-700 break-all">{rest.join(" ")}</span>
      </div>
      {open && chain && <div className="px-3 pb-2"><CallChainTree chain={chain} t={t} borderLight={borderLight} /></div>}
    </div>
  );
}
