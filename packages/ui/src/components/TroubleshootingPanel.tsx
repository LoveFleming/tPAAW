/**
 * TroubleshootingPanel — 🔧 維運頁
 *
 * 「可維運」— 出事知道怎麼查、怎麼修、怎麼退。
 *
 * 左：Runbook 清單（點開可讀）+ 最近 Release（回滾參考）
 * 右：Ops AI 助理（讀 runbook + log 幫診斷、生成 runbook）
 *
 * 「AI 寫 Runbook」：注入 deterministic 證據（git 狀態 + releases + 現有 runbooks +
 * 真 API 清單）→ AI 用真實 API 路徑寫診斷/驗證步驟，不憑空掰 URL。
 * git/服務狀態不佔 UI（git tab 已有）但保留在 AI 證據裡。
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import AgentSideChat, { type AgentSideChatHandle } from "./AgentSideChat";

interface OpsStatus {
  initialized: boolean;
  git: {
    isRepo: boolean;
    branch: string | null;
    dirty: boolean;
    dirtyFiles: string[];
    lastCommits: string[];
  };
  runbooks: { id: string; title: string; bytes: number; mtime?: string; headings: string[] }[];
  scripts: Record<string, string>;
  releases: { id: string; taskId: string; title: string; releasedAt: string; note: string | null }[];
  checkedAt: string;
}

interface Props {
  rootPath: string;
  theme: any;
}

export default function TroubleshootingPanel({ rootPath, theme: tk }: Props) {
  const { t } = useI18n();
  const [status, setStatus] = useState<OpsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [openRb, setOpenRb] = useState<string | null>(null);
  const [rbContent, setRbContent] = useState<string | null>(null);
  const chatRef = useRef<AgentSideChatHandle>(null);

  const refresh = useCallback(async () => {
    if (!rootPath) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-ops/status?path=${encodeURIComponent(rootPath)}`);
      setStatus(await res.json());
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [rootPath]);

  useEffect(() => { refresh(); }, [refresh]);

  const openRunbook = async (id: string) => {
    if (openRb === id) { setOpenRb(null); setRbContent(null); return; }
    setOpenRb(id);
    setRbContent("…");
    try {
      const res = await fetch(`${API_BASE}/api/coding-ops/runbook?id=${encodeURIComponent(id)}&path=${encodeURIComponent(rootPath)}`);
      const data = await res.json();
      setRbContent(data.content || data.error || "");
    } catch (e: any) {
      setRbContent(`❌ ${e?.message || "讀取失敗"}`);
    }
  };

  // ── AI 寫 Runbook：注入 deterministic 證據（含真 API 路徑 — 不憑空掰 URL）──
  const generateRunbook = async () => {
    if (!status) return;
    // API 清單（health-check / 驗證步驟候選）
    let apiList = "";
    try {
      const r = await fetch(`${API_BASE}/api/api-tester/project-apis?root=${encodeURIComponent(rootPath)}`);
      const d = await r.json();
      const apis = (d.routes || d.apis || (Array.isArray(d) ? d : [])).slice?.(0, 20) || [];
      apiList = apis.map((a: any) => `- ${a.method} ${a.path}  (${a.file || "?"})`).join("\n");
    } catch { /* API 清單拿不到就略過 */ }

    const ev = [
      "維運事實（程式產生，deterministic）：",
      `git: ${status.git.isRepo ? `${status.git.branch}${status.git.dirty ? `（⚠ ${status.git.dirtyFiles.length} 未 commit）` : "（clean）"}` : "非 git repo"}`,
      status.git.lastCommits?.length ? `last commits:\n${status.git.lastCommits.slice(0, 3).join("\n")}` : "",
      status.releases.length ? `最近 releases:\n${status.releases.slice(0, 3).map((r) => `- ${r.releasedAt?.slice(0, 10)} ${r.id} ${r.title}`).join("\n")}` : "releases:（尚無 release 記錄）",
      status.runbooks.length
        ? `現有 runbooks（避免重複，格式參考）：\n${status.runbooks.map((rb) => `- ${rb.id} ${rb.title}（${rb.headings.slice(0, 4).join(" / ")}）`).join("\n")}`
        : "現有 runbooks:（沒有 — 這是第一份）",
      apiList ? `驗證用 API（真實路徑，從 API map 來 — 診斷/驗證步驟請用這些）：\n${apiList}` : "",
    ].filter(Boolean).join("\n\n");

    chatRef.current?.send(
      `${ev}\n\n請寫一份 runbook（markdown），用這個 repo 的真實 API 路徑與指令。結構：\n` +
      `# <症況標題>\n## 症狀（怎麼發現）\n## 診斷步驟（curl/指令 — 用上面真實 API）\n## 修復步驟\n## 驗證（API + 預期回應）\n## 回滾（退到哪個 release / git 指令）\n` +
      `寫完後我會存到 .paaw/runbook/。`
    );
  };

  return (
    <div className="flex h-full min-h-0">
      {/* ── 左：內容區 ── */}
      <div className="flex-1 min-w-0 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        <div className="px-5 py-3 border-b sticky top-0 bg-white/95 backdrop-blur z-10 flex items-center gap-2" style={{ borderColor: tk.borderLight }}>
          <span className="text-lg">🔧</span>
          <h2 className="text-sm font-bold text-stone-800">{t("ops.title")}</h2>
          <span className="ml-auto" />
          <button onClick={generateRunbook} disabled={!status}
            className="text-xs px-2.5 py-1 rounded-lg text-white font-bold hover:opacity-90 disabled:opacity-40" style={{ backgroundColor: "#7c3aed" }}
            data-testid="ops-gen-runbook">
            ✍️ {t("ops.genRunbook")}
          </button>
        </div>

        {loading && <div className="p-8 text-center text-xs text-stone-400 animate-pulse">{t("common.loading")}</div>}

        {!loading && status && (
          <div className="p-5 space-y-5">
            {/* ═══ 最近 Release（回滾參考）═══ */}
            {status.releases.length > 0 && (
              <section>
                <h3 className="text-xs font-bold text-stone-600 mb-2">🚀 {t("ops.releases.title")}</h3>
                <div className="space-y-1.5">
                  {status.releases.map(r => (
                    <div key={r.id} className="border rounded-lg px-3 py-2 bg-white text-xs flex items-center gap-2" style={{ borderColor: tk.borderLight }}>
                      <span className="font-mono text-stone-400 text-[10px] shrink-0">{r.releasedAt?.slice(5, 10)}</span>
                      <span className="truncate flex-1 text-stone-700">{r.title}</span>
                      <span className="text-[10px] text-stone-400 shrink-0">{r.id}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ═══ Runbook ═══ */}
            <section data-testid="ops-runbook-section">
              <h3 className="text-xs font-bold text-stone-600 mb-2 flex items-center gap-1.5">
                📚 {t("ops.runbook.title")}
                {status.runbooks.length > 0 && <span className="px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500 text-[10px]">{status.runbooks.length}</span>}
              </h3>

              {status.runbooks.length === 0 && (
                <div className="border border-dashed rounded-lg p-4 text-center" style={{ borderColor: tk.borderLight }} data-testid="ops-runbook-empty">
                  <div className="text-xs text-stone-400 mb-1">{t("ops.runbook.empty")}</div>
                  <div className="text-[11px] text-stone-500 leading-relaxed max-w-sm mx-auto mb-2">
                    {t("ops.runbook.emptyHint")}
                  </div>
                  <button onClick={generateRunbook}
                    className="text-xs px-3 py-1.5 rounded-lg text-white font-bold hover:opacity-90" style={{ backgroundColor: "#7c3aed" }}>
                    ✍️ {t("ops.genRunbook")}
                  </button>
                </div>
              )}

              {status.runbooks.map(rb => (
                <div key={rb.id} className="border rounded-xl mb-2 bg-white overflow-hidden" style={{ borderColor: tk.borderLight }}>
                  <button onClick={() => openRunbook(rb.id)} className="w-full flex items-center gap-2 px-3.5 py-2.5 hover:bg-stone-50 text-left">
                    <span>📒</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-stone-700 truncate">{rb.title}</div>
                      <div className="text-[10px] font-mono text-stone-400">{rb.mtime ? `${rb.mtime.slice(0, 10)} · ` : ""}{(rb.bytes / 1024).toFixed(1)} KB</div>
                    </div>
                    <span className="text-[10px] text-stone-400">{openRb === rb.id ? "▾" : "▸"}</span>
                  </button>
                  {openRb === rb.id && (
                    <div className="border-t px-3.5 py-2.5 max-h-80 overflow-y-auto" style={{ borderColor: tk.borderLight, scrollbarWidth: "thin" }}>
                      <pre className="text-[11px] text-stone-600 whitespace-pre-wrap font-mono leading-relaxed">{rbContent}</pre>
                    </div>
                  )}
                </div>
              ))}
            </section>
          </div>
        )}
      </div>

      {/* ── 右：Ops AI 助理 ── */}
      <div className="w-[320px] shrink-0 hidden md:block">
        <AgentSideChat
          ref={chatRef}
          agentId="ops"
          agentName={t("ops.agentName")}
          agentEmoji="🔧"
          greeting={t("ops.agentGreeting")}
          cwd={rootPath}
          accent={tk.accent}
          height="100%"
          suggestions={[
            { label: t("ops.sug.genRunbook"), prompt: t("ops.sug.genRunbookPrompt") },
            { label: t("ops.sug.diagnose"), prompt: t("ops.sug.diagnosePrompt") },
            { label: t("ops.sug.rollback"), prompt: t("ops.sug.rollbackPrompt") },
          ]}
        />
      </div>
    </div>
  );
}
