/**
 * JanitorPanel — 磁碟清理設定 + janitor.log 檢視 + 立即執行（2026-09-06 Fleming 要求）
 *
 * 資料：GET/PUT /api/janitor、POST /api/janitor/run
 * 掛載：CodingIDE Terminal tab（🧹 清理 view）
 *
 * 固定文案（不可關）：LLM / agent 執行記錄永不刪（成本核算資產 — RuCostSection 資料源）
 */
import React, { useState, useEffect, useCallback } from "react";
import { useI18n } from "../i18n";
import API_BASE from "../api";

interface JanitorConfig {
  enabled: boolean;
  semgrepKeep: number;
  appConsoleKeep: number;
  appConsoleMaxMb: number;
  versionsKeep: number;
  uploadsDays: number;
}

interface RunReport {
  ranAt: string; enabled: boolean;
  semgrepDeleted: number; appConsoleDeleted: number; appConsoleTruncated: number;
  legacyDeleted: number; tmpCleared: number; versionsDeleted: number; uploadsDeleted: number;
}

const NUM_FIELDS: { key: keyof JanitorConfig; labelKey: string; hint?: string }[] = [
  { key: "semgrepKeep", labelKey: "janitor.segrepKeep" },
  { key: "appConsoleKeep", labelKey: "janitor.appConsoleKeep" },
  { key: "appConsoleMaxMb", labelKey: "janitor.appConsoleMaxMb" },
  { key: "versionsKeep", labelKey: "janitor.versionsKeep" },
  { key: "uploadsDays", labelKey: "janitor.uploadsDays" },
];

export default function JanitorPanel({ theme: tk }: { theme: any }) {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<JanitorConfig | null>(null);
  const [logTail, setLogTail] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<RunReport | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/janitor`);
      const d = await r.json();
      if (d?.ok) { setCfg(d.config); setLogTail(d.logTail || []); }
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/api/janitor`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      const d = await r.json();
      if (d?.ok) { setCfg(d.config); setDirty(false); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1500); }
    } catch {} finally { setSaving(false); }
  };

  const runNow = async () => {
    setRunning(true); setReport(null);
    try {
      const r = await fetch(`${API_BASE}/api/janitor/run`, { method: "POST" });
      const d = await r.json();
      if (d?.ok) { setReport(d.report); setLogTail(d.logTail || []); }
    } catch {} finally { setRunning(false); }
  };

  if (!cfg) {
    return <div className="h-full flex items-center justify-center text-sm" style={{ color: "#a8a29e" }}>{t("janitor.loading")}</div>;
  }

  const inputCls = "w-20 px-2 py-1 text-sm rounded-lg border bg-transparent outline-none focus:ring-1";
  const labelCls = "flex items-center justify-between gap-3 py-1.5";

  return (
    <div className="h-full overflow-y-auto p-5 space-y-5" style={{ scrollbarWidth: "thin" }}>
      {/* 啟用開關 */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold" style={{ color: tk.text }}>{t("janitor.title")}</div>
          <div className="text-xs mt-0.5" style={{ color: "#a8a29e" }}>{t("janitor.desc")}</div>
        </div>
        <button
          onClick={() => { setCfg({ ...cfg, enabled: !cfg.enabled }); setDirty(true); }}
          className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0"
          style={{ backgroundColor: cfg.enabled ? "#8b5cf6" : "#d6d3d1" }}
          title={cfg.enabled ? t("janitor.enabledOn") : t("janitor.enabledOff")}
        >
          <span className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
            style={{ transform: cfg.enabled ? "translateX(24px)" : "translateX(4px)" }} />
        </button>
      </div>

      {/* 永不刪除的固定說明 */}
      <div className="rounded-xl border px-3 py-2.5 text-xs leading-relaxed"
        style={{ borderColor: "#8b5cf655", backgroundColor: "#8b5cf611", color: "#6d28d9" }}>
        🔒 {t("janitor.neverDelete")}
      </div>

      {/* 數字設定 */}
      <div className="rounded-xl border p-3 space-y-0.5" style={{ borderColor: tk.borderLight }}>
        {NUM_FIELDS.map(({ key, labelKey }) => (
          <div key={key} className={labelCls}>
            <span className="text-sm" style={{ color: tk.text }}>{t(labelKey)}</span>
            <input
              type="number" min={0} value={String(cfg[key])}
              disabled={!cfg.enabled}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 0) { setCfg({ ...cfg, [key]: n } as JanitorConfig); setDirty(true); }
              }}
              className={inputCls}
              style={{ borderColor: tk.borderLight, color: tk.text, opacity: cfg.enabled ? 1 : 0.4 }}
            />
          </div>
        ))}
        <div className="flex items-center justify-end gap-2 pt-2">
          {savedFlash && <span className="text-xs" style={{ color: "#059669" }}>✓ {t("janitor.saved")}</span>}
          <button onClick={save} disabled={!dirty || saving}
            className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40"
            style={{ backgroundColor: dirty ? "#8b5cf6" : "#e7e5e4", color: dirty ? "#fff" : "#78716c" }}>
            {saving ? "…" : t("janitor.save")}
          </button>
        </div>
      </div>

      {/* 立即執行 */}
      <div className="flex items-center gap-3">
        <button onClick={runNow} disabled={running || !cfg.enabled}
          className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40"
          style={{ border: `1px solid ${tk.borderLight}`, color: tk.text }}>
          {running ? `⏳ ${t("janitor.running")}` : `🧹 ${t("janitor.runNow")}`}
        </button>
        {report && (() => {
          const n = report.semgrepDeleted + report.appConsoleDeleted + report.versionsDeleted
            + report.legacyDeleted + report.tmpCleared + report.uploadsDeleted;
          return (
            <span className="text-xs" style={{ color: "#059669" }}>
              ✓ {n} {t("janitor.deletedItems")}
            </span>
          );
        })()}
      </div>

      {/* janitor.log */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-xs font-semibold" style={{ color: "#a8a29e" }}>{t("janitor.logTitle")}</div>
          <button onClick={load} className="text-xs" style={{ color: "#8b5cf6" }}>↻ {t("janitor.refresh")}</button>
        </div>
        <div className="rounded-xl border p-3 font-mono text-[11px] leading-relaxed overflow-x-auto max-h-64 overflow-y-auto"
          style={{ borderColor: tk.borderLight, backgroundColor: "#1c1917", color: "#d6d3d1", scrollbarWidth: "thin" }}>
          {logTail.length === 0 ? <span style={{ color: "#78716c" }}>（{t("janitor.noLog")}）</span>
            : logTail.map((ln, i) => <div key={i}>{ln}</div>)}
        </div>
      </div>
    </div>
  );
}
