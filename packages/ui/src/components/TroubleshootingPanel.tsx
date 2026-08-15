/**
 * TroubleshootingPanel — 🔧 維運頁
 *
 * 「可維運」— 出事知道怎麼查、怎麼修、怎麼退。
 *
 * 左：服務現況（git 狀態/最後 commits）+ Runbook 清單（點開可讀）
 * 右：Ops AI 助理（讀 runbook + log 幫診斷、生成 runbook）
 *
 * 空狀態：.paaw/ 不存在 → git 狀態照顯示（不依賴知識庫），
 *         runbook 區顯示引導（AI 助理可生成第一版 runbook）。
 */

import React, { useState, useEffect, useCallback } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import AgentSideChat from "./AgentSideChat";

interface OpsStatus {
  initialized: boolean;
  git: {
    isRepo: boolean;
    branch: string | null;
    dirty: boolean;
    dirtyFiles: string[];
    lastCommits: string[];
  };
  runbooks: { id: string; title: string; bytes: number; headings: string[] }[];
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

  return (
    <div className="flex h-full min-h-0">
      {/* ── 左：內容區 ── */}
      <div className="flex-1 min-w-0 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        <div className="px-5 py-3 border-b sticky top-0 bg-white/95 backdrop-blur z-10 flex items-center gap-2" style={{ borderColor: tk.borderLight }}>
          <span className="text-lg">🔧</span>
          <h2 className="text-sm font-bold text-stone-800">{t("ops.title")}</h2>
          {status?.checkedAt && (
            <span className="text-[10px] font-mono text-stone-400 ml-auto">
              {t("ops.checkedAt")} {new Date(status.checkedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button onClick={refresh} className="text-xs px-2 py-1 rounded-lg border hover:bg-stone-50 text-stone-500" style={{ borderColor: tk.borderLight }}>
            🔄 {t("ops.refresh")}
          </button>
        </div>

        {loading && <div className="p-8 text-center text-xs text-stone-400 animate-pulse">{t("common.loading")}</div>}

        {!loading && status && (
          <div className="p-5 space-y-5">
            {/* ═══ 服務現況 ═══ */}
            <section>
              <h3 className="text-xs font-bold text-stone-600 mb-2">📊 {t("ops.status.title")}</h3>
              <div className="border rounded-xl bg-white p-3.5" style={{ borderColor: tk.borderLight }}>
                {status.git.isRepo ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-3 text-xs text-stone-600">
                      <span>🌿 <b className="font-mono">{status.git.branch}</b></span>
                      <span>{status.git.dirty
                        ? <span className="text-amber-600">⚠️ {t("ops.status.dirty")}（{status.git.dirtyFiles.length}）</span>
                        : <span className="text-green-600">✅ {t("ops.status.clean")}</span>}</span>
                      <span>📦 npm scripts: {Object.keys(status.scripts).length}</span>
                    </div>
                    {status.git.dirty && (
                      <pre className="text-[10px] font-mono text-stone-400 bg-stone-50 rounded p-2 max-h-24 overflow-y-auto">{status.git.dirtyFiles.join("\n")}</pre>
                    )}
                    <div>
                      <div className="text-[10px] text-stone-400 mb-1">{t("ops.status.lastCommits")}</div>
                      <pre className="text-[10px] font-mono text-stone-500 leading-relaxed">{status.git.lastCommits.join("\n") || "—"}</pre>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-stone-400">{t("ops.status.notRepo")}</div>
                )}
              </div>
            </section>

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
            <section>
              <h3 className="text-xs font-bold text-stone-600 mb-2 flex items-center gap-1.5">
                📚 {t("ops.runbook.title")}
                {status.runbooks.length > 0 && <span className="px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500 text-[10px]">{status.runbooks.length}</span>}
              </h3>

              {status.runbooks.length === 0 && (
                <div className="border border-dashed rounded-lg p-4 text-center" style={{ borderColor: tk.borderLight }}>
                  <div className="text-xs text-stone-400 mb-1">{t("ops.runbook.empty")}</div>
                  <div className="text-[11px] text-stone-500 leading-relaxed max-w-sm mx-auto">
                    {t("ops.runbook.emptyHint")}
                  </div>
                </div>
              )}

              {status.runbooks.map(rb => (
                <div key={rb.id} className="border rounded-xl mb-2 bg-white overflow-hidden" style={{ borderColor: tk.borderLight }}>
                  <button onClick={() => openRunbook(rb.id)} className="w-full flex items-center gap-2 px-3.5 py-2.5 hover:bg-stone-50 text-left">
                    <span>📒</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-stone-700 truncate">{rb.title}</div>
                      <div className="text-[10px] font-mono text-stone-400">{rb.id} · {(rb.bytes / 1024).toFixed(1)} KB</div>
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
