/**
 * TestsPage — 🧪 Tests 獨立頁（宮殿 + 神）
 *
 * 左宮殿（三區）：
 *   📊 統計卡 — 總測試檔 / kind 分佈（unit/integration/e2e）/ coverage rate
 *   🔗 對照表 — testToCode：test file ↔ production file（testedFunctions + kind + matchType）
 *   🕳️ 缺口 — coverageGaps：沒有測試的 production 檔（按函數數排序）
 *
 * 右神：🧪 Tester AI（coding.tester）— 每區「問 AI」帶證據注入
 */

import React, { useEffect, useMemo, useRef, useState, forwardRef } from "react";
import { useI18n } from "../i18n";
import { useTheme } from "../theme";
import AgentSideChat, { type AgentSideChatHandle } from "./AgentSideChat";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4097";

const KIND_COLORS: Record<string, string> = {
  unit: "#16a34a", integration: "#2563eb", e2e: "#9333ea", contract: "#d97706",
};

interface TestMatch { productionFile: string; matchType: string; testedFunctions: string[]; confidence?: string }
interface TestToCodeEntry { testFile: string; testType?: string; functionCount?: number; matches: TestMatch[] }
interface GapEntry { file: string; functionCount?: number; exportCount?: number }
interface DetailData {
  summary?: { totalTestFiles?: number; byType?: Record<string, number>; totalMappings?: number; coverageGapFiles?: number; coverageRate?: string; featureTestCoverage?: number };
  testToCode?: TestToCodeEntry[];
  coverageGaps?: GapEntry[];
}

const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

interface Props { rootPath: string; onOpenFile?: (absPath: string) => void }

function TestsPageInner({ rootPath, onOpenFile }: Props, ref: React.Ref<AgentSideChatHandle | null>) {
  const { t } = useI18n();
  const themeCtx = useTheme();
  const borderLight = "#f0f0f0";
  const accentText = themeCtx?.info?.accentText || "#0369a1";

  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [kindFilter, setKindFilter] = useState<string>("__all__");
  const [expanded, setExpanded] = useState<string | null>(null); // testFile
  const chatRef = useRef<AgentSideChatHandle>(null);
  React.useImperativeHandle(ref, () => ({
    send: (text: string) => { chatRef.current?.send(text); },
  }));

  const fetchDetail = React.useCallback(async () => {
    if (!rootPath) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/test-intelligence?path=${encodeURIComponent(rootPath)}&detail=1`);
      const d = await res.json();
      if (d && !d.error) setData(d);
    } catch { /* keep old */ } finally { setLoading(false); }
  }, [rootPath]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const byType = data?.summary?.byType || {};
  const kindChips = useMemo(() => {
    const entries = Object.entries(byType).filter(([, n]) => (n || 0) > 0);
    return entries.sort((a, b) => b[1] - a[1]);
  }, [byType]);

  const rows = useMemo(() => {
    const list = data?.testToCode || [];
    if (kindFilter === "__all__") return list;
    return list.filter(e => (e.testType || "unit") === kindFilter);
  }, [data, kindFilter]);

  const askGaps = () => {
    const gaps = (data?.coverageGaps || []).slice(0, 20)
      .map(g => `${g.file}（${g.functionCount ?? "?"} 函數）`).join("\n");
    chatRef.current?.send(
      `測試缺口分析。以下是沒有測試的 production 檔案（依函數數排序）：\n${gaps}\n\n` +
      `請以測試工程師觀點：1) 挑出最該優先補測的前 5 個（考慮風險 vs 成本）2) 每個建議測什麼情境 3) 排一個補測順序`
    );
  };

  const askMapping = (e: TestToCodeEntry) => {
    const lines = e.matches.map(m => `→ ${m.productionFile} [${m.matchType}${m.confidence ? "/" + m.confidence : ""}] 測到：${m.testedFunctions.join(", ") || "（無交集）"}`).join("\n");
    chatRef.current?.send(
      `測試對照檢查：${e.testFile}（${e.testType || "unit"}）\n${lines}\n\n` +
      `這個 mapping 合理嗎？有沒有「測了但沒測到重點」或誤配的問題？建議補哪些 case？`
    );
  };

  if (!rootPath) {
    return <div className="flex items-center justify-center h-full text-xs text-stone-400">{t("ruTree.noProject")}</div>;
  }

  return (
    <div className="flex-1 flex min-w-0 overflow-hidden" data-testid="tests-page">
      {/* 左：宮殿 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto p-4 space-y-4">
        {/* 統計卡 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2" data-testid="tests-stats">
          <div className="px-3 py-2 rounded-lg border" style={{ borderColor: borderLight }}>
            <div className="text-[10px] text-stone-400 font-medium">{t("tests.totalFiles")}</div>
            <div className="text-lg font-bold text-stone-700">{data?.summary?.totalTestFiles ?? "—"}</div>
          </div>
          <div className="px-3 py-2 rounded-lg border" style={{ borderColor: borderLight }}>
            <div className="text-[10px] text-stone-400 font-medium">{t("tests.mappings")}</div>
            <div className="text-lg font-bold text-stone-700">{data?.summary?.totalMappings ?? "—"}</div>
          </div>
          <div className="px-3 py-2 rounded-lg border" style={{ borderColor: borderLight }}>
            <div className="text-[10px] text-stone-400 font-medium">{t("tests.coverage")}</div>
            <div className="text-lg font-bold text-stone-700">{data?.summary?.coverageRate ?? "—"}</div>
          </div>
          <div className="px-3 py-2 rounded-lg border" style={{ borderColor: borderLight, background: (data?.summary?.coverageGapFiles || 0) > 0 ? "#fffbeb" : undefined }}>
            <div className="text-[10px] text-stone-400 font-medium">{t("tests.gapFiles")}</div>
            <div className={`text-lg font-bold ${(data?.summary?.coverageGapFiles || 0) > 0 ? "text-amber-600" : "text-stone-700"}`}>{data?.summary?.coverageGapFiles ?? "—"}</div>
          </div>
        </div>

        {/* kind 分佈 chips */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <button onClick={() => setKindFilter("__all__")}
            className={`text-[10px] px-2 py-1 rounded-full border font-semibold transition-colors ${kindFilter === "__all__" ? "bg-stone-800 text-white border-stone-800" : "bg-white text-stone-500 border-stone-200 hover:border-stone-400"}`}
            data-testid="tests-kind-all">
            {t("tests.allKinds")} · {(data?.testToCode || []).length}
          </button>
          {kindChips.map(([kind, n]) => (
            <button key={kind} onClick={() => setKindFilter(kind)}
              data-testid={`tests-kind-${kind}`}
              className={`text-[10px] px-2 py-1 rounded-full border font-semibold transition-colors ${kindFilter === kind ? "text-white border-transparent" : "bg-white text-stone-500 border-stone-200 hover:border-stone-400"}`}
              style={kindFilter === kind ? { backgroundColor: KIND_COLORS[kind] || "#78716c" } : undefined}>
              {kind} · {n}
            </button>
          ))}
          {loading && <span className="text-[10px] text-stone-400 animate-pulse">loading…</span>}
        </div>

        {/* 對照表 */}
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: borderLight }} data-testid="tests-mapping">
          <div className="px-3 py-1.5 text-[10px] font-bold text-stone-400 bg-stone-50 flex items-center" style={{ borderBottom: `1px solid ${borderLight}` }}>
            🔗 {t("tests.mappingTitle")} · {rows.length}
          </div>
          {rows.slice(0, 120).map(e => {
            const kind = e.testType || "unit";
            const isOpen = expanded === e.testFile;
            return (
              <div key={e.testFile}>
                <button onClick={() => setExpanded(isOpen ? null : e.testFile)}
                  className="w-full text-left px-3 py-1.5 border-b hover:bg-stone-50 flex items-center gap-2"
                  style={{ borderColor: borderLight }} data-testid="tests-row">
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white shrink-0" style={{ backgroundColor: KIND_COLORS[kind] || "#78716c" }}>{kind}</span>
                  <span className="text-[11px] font-mono text-stone-700 truncate flex-1" title={e.testFile}>{e.testFile}</span>
                  <span className="text-[9px] text-stone-400 shrink-0">→ {e.matches.length} file(s)</span>
                </button>
                {isOpen && (
                  <div className="px-3 py-2 border-b space-y-1.5" style={{ borderColor: borderLight, background: "#fafaf9" }}>
                    {e.matches.map((m, i) => (
                      <div key={`${m.productionFile}-${i}`} className="flex items-start gap-2 flex-wrap">
                        <button onClick={() => onOpenFile?.(`${rootPath}/${m.productionFile}`)}
                          className="text-[10px] font-mono hover:underline break-all" style={{ color: accentText }}>
                          📄 {m.productionFile}
                        </button>
                        <span className="text-[9px] text-stone-400">[{m.matchType}{m.confidence ? `/${m.confidence}` : ""}]</span>
                        {m.testedFunctions.length > 0 && (
                          <span className="text-[9px] text-stone-500 font-mono">{m.testedFunctions.map(f => `${f}()`).join(", ")}</span>
                        )}
                      </div>
                    ))}
                    <button onClick={() => askMapping(e)}
                      className="text-[10px] px-2 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 font-medium"
                      data-testid="tests-ask-mapping">
                      💬 {t("tests.askCheckMapping")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {rows.length === 0 && !loading && (
            <div className="px-3 py-6 text-[10px] text-stone-300 text-center">{t("tests.noTests")}</div>
          )}
        </div>

        {/* 缺口 */}
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: borderLight }} data-testid="tests-gaps">
          <div className="px-3 py-1.5 text-[10px] font-bold text-stone-400 bg-stone-50 flex items-center" style={{ borderBottom: `1px solid ${borderLight}` }}>
            🕳️ {t("tests.gapsTitle")} · {(data?.coverageGaps || []).length}
            <span className="flex-1" />
            {(data?.coverageGaps || []).length > 0 && (
              <button onClick={askGaps} data-testid="tests-ask-gaps"
                className="text-[10px] px-2 py-0.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 font-medium">
                💬 {t("tests.askPrioritize")}
              </button>
            )}
          </div>
          {(data?.coverageGaps || []).slice(0, 40).map(g => (
            <button key={g.file} onClick={() => onOpenFile?.(`${rootPath}/${g.file}`)}
              className="w-full text-left px-3 py-1 border-b hover:bg-stone-50 flex items-center gap-2 last:border-0" style={{ borderColor: borderLight }}>
              <span className="text-[10px] font-mono text-stone-600 truncate flex-1">{g.file}</span>
              <span className="text-[9px] text-stone-400 font-mono shrink-0">ƒ{g.functionCount ?? 0}</span>
            </button>
          ))}
          {(data?.coverageGaps || []).length === 0 && (
            <div className="px-3 py-4 text-[10px] text-stone-300 text-center">{t("tests.noGaps")}</div>
          )}
        </div>
      </div>

      {/* 右：神 — Tester AI */}
      <div className="shrink-0 border-l hidden xl:flex flex-col" style={{ width: 340, borderColor: borderLight }}>
        <AgentSideChat
          ref={chatRef}
          agentId="tester"
          agentName={t("tests.testerName")}
          agentEmoji="🧪"
          greeting={t("tests.testerGreeting")}
          cwd={rootPath}
          accent="#16a34a"
          height="100%"
          placeholder={t("tests.testerPlaceholder")}
          suggestions={[
            { label: t("tests.sug1Label"), prompt: t("tests.sug1Prompt") },
            { label: t("tests.sug2Label"), prompt: t("tests.sug2Prompt") },
          ]}
        />
      </div>
    </div>
  );
}

const TestsPage = forwardRef<AgentSideChatHandle | null, Props>(TestsPageInner);
export default TestsPage;
