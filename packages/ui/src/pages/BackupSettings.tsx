/**
 * PAAW Backup & Restore 設定頁面
 */

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "../i18n";
import { useTheme } from "../theme";
import API_BASE from "../api";

interface BackupConfig {
  backupDir: string;
  retentionCount: number;
  enabled: boolean;
  scheduleHour: number;
  lastBackupAt: string | null;
}

interface BackupEntry {
  id: string;
  filename: string;
  size: number;
  createdAt: string;
  dirs: string[];
}

export default function BackupSettings() {
  const { t: tt } = useI18n();
  const { info: th } = useTheme();
  const tk = {
    bg: "#fff", bgMuted: "#fafafa", bgHover: th.accentLight || "#f5f5f4",
    border: th.accentBorder || "#e5e5e5", borderLight: "#f0f0f0", borderInput: "#e0e0e0",
    textMuted: "#9ca3af", textPrimary: "#374151", textSecondary: "#6b7280",
    accent: th.accent, accentBg: th.accentBg, accentText: th.accentText,
  };

  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [editDir, setEditDir] = useState("");
  const [editRetention, setEditRetention] = useState(7);
  const [editing, setEditing] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  const api = {
    get: async (p: string) => (await fetch(p)).json(),
    put: async (p: string, b: any) => (await fetch(p, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json(),
    post: async (p: string, b?: any) => (await fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined })).json(),
    del: async (p: string) => (await fetch(p, { method: "DELETE" })).json(),
  };

  const loadConfig = useCallback(async () => {
    const data = await api.get(`${API_BASE}/api/backup/config`);
    setConfig(data.config);
    setEditDir(data.config?.backupDir || "");
    setEditRetention(data.config?.retentionCount || 7);
  }, []);

  const loadBackups = useCallback(async () => {
    const data = await api.get(`${API_BASE}/api/backup/list`);
    setBackups(data.backups || []);
  }, []);

  const msg = (type: "ok" | "err", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  // 手動備份
  const runBackup = async () => {
    setLoading(true);
    try {
      const data = await api.post(`${API_BASE}/api/backup/run`);
      if (data.ok) {
        msg("ok", `✅ 備份完成！${formatSize(data.backup.size)}`);
        await loadBackups();
        await loadConfig();
      } else {
        msg("err", `❌ 備份失敗：${data.error}`);
      }
    } catch (err: any) {
      msg("err", `❌ 備份失敗：${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 儲存設定
  const saveConfig = async () => {
    const data = await api.put(`${API_BASE}/api/backup/config`, {
      backupDir: editDir,
      retentionCount: editRetention,
    });
    if (data.ok) {
      setConfig(data.config);
      setEditing(false);
      msg("ok", tt("backup.settingsSaved"));
    } else {
      msg("err", tt("backup.saveFailed"));
    }
  };

  // 還原
  const doRestore = async (filename: string) => {
    if (!confirm(`確定要從 ${filename} 還原嗎？\n\n⚠️ 現有資料會被覆蓋，系統會先自動建立一份還原前備份。`)) return;
    setRestoring(filename);
    try {
      const data = await api.post(`${API_BASE}/api/backup/restore`, { filename });
      if (data.ok) {
        msg("ok", `✅ 已從 ${filename} 還原完成！`);
        await loadBackups();
      } else {
        msg("err", `❌ 還原失敗：${data.error}`);
      }
    } catch (err: any) {
      msg("err", `❌ 還原失敗：${err.message}`);
    } finally {
      setRestoring(null);
    }
  };

  // 刪除備份
  const deleteBackup = async (filename: string) => {
    if (!confirm(`確定刪除 ${filename}？`)) return;
    const data = await api.del(`${API_BASE}/api/backup/delete?filename=${encodeURIComponent(filename)}`);
    if (data.ok) {
      msg("ok", tt("backup.deleted"));
      await loadBackups();
    } else {
      msg("err", `❌ 刪除失敗：${data.error}`);
    }
  };

  useEffect(() => {
    loadConfig();
    loadBackups();
  }, []);

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  if (!config) return <div className="p-8" style={{ color: tk.textMuted }}>{tt("common.loading")}</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-lg font-bold text-stone-800">💾 備份與還原</h3>
        <p className="text-sm text-stone-500">
          備份 PAAW 所有使用者資料（知識庫、技能、Apps、筆記、聊天記錄、設定等）
        </p>
      </div>

        {/* Message toast */}
        {message && (
          <div className="mb-4 px-4 py-2.5 rounded-lg text-sm font-medium"
            style={{ background: message.type === "ok" ? "#ecfdf5" : "#fef2f2", color: message.type === "ok" ? "#065f46" : "#991b1b" }}>
            {message.text}
          </div>
        )}

        {/* ── 備份設定 ── */}
        <div className="rounded-xl border p-5 mb-4" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold" style={{ color: tk.textPrimary }}>⚙️ 備份設定</h2>
            <button onClick={() => setEditing(!editing)} className="text-sm px-3 py-1 rounded-lg"
              style={{ background: tk.bg, border: `1px solid ${tk.borderInput}`, color: tk.textSecondary }}>
              {editing ? tt("common.cancel") : tt("common.edit")}
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-sm w-28 shrink-0" style={{ color: tk.textSecondary }}>備份目錄</span>
              {editing ? (
                <input value={editDir} onChange={e => setEditDir(e.target.value)}
                  className="flex-1 text-sm px-3 py-1.5 rounded-lg border outline-none"
                  style={{ background: tk.bg, borderColor: tk.borderInput, color: tk.textPrimary }} />
              ) : (
                <span className="text-sm font-mono" style={{ color: tk.textPrimary }}>{config.backupDir}</span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm w-28 shrink-0" style={{ color: tk.textSecondary }}>保留份數</span>
              {editing ? (
                <input type="number" min={1} max={30} value={editRetention} onChange={e => setEditRetention(parseInt(e.target.value) || 7)}
                  className="w-20 text-sm px-3 py-1.5 rounded-lg border outline-none"
                  style={{ background: tk.bg, borderColor: tk.borderInput, color: tk.textPrimary }} />
              ) : (
                <span className="text-sm" style={{ color: tk.textPrimary }}>{config.retentionCount} 份</span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm w-28 shrink-0" style={{ color: tk.textSecondary }}>排程時間</span>
              <span className="text-sm" style={{ color: tk.textPrimary }}>每天 {String(config.scheduleHour).padStart(2, "0")}:00</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm w-28 shrink-0" style={{ color: tk.textSecondary }}>上次備份</span>
              <span className="text-sm" style={{ color: tk.textPrimary }}>
                {config.lastBackupAt ? new Date(config.lastBackupAt).toLocaleString("zh-TW") : tt("backup.noBackup")}
              </span>
            </div>
          </div>

          {editing && (
            <div className="mt-4 flex justify-end">
              <button onClick={saveConfig} className="px-4 py-2 rounded-lg text-white text-sm font-medium"
                style={{ background: tk.accent }}>儲存設定</button>
            </div>
          )}
        </div>

        {/* ── 手動備份 ── */}
        <div className="rounded-xl border p-5 mb-4" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold" style={{ color: tk.textPrimary }}>▶️ 立即備份</h2>
              <p className="text-xs mt-1" style={{ color: tk.textMuted }}>備份所有使用者資料到 {config.backupDir}</p>
            </div>
            <button onClick={runBackup} disabled={loading}
              className="px-5 py-2 rounded-lg text-white text-sm font-medium flex items-center gap-2"
              style={{ background: loading ? tk.bgMuted : tk.accent, color: loading ? tk.textMuted : "#fff", cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? <><span className="ai-spinner">⏳</span> 備份中...</> : "💾 立即備份"}
            </button>
          </div>
        </div>

        {/* ── 備份列表 ── */}
        <div className="rounded-xl border p-5" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
          <h2 className="text-lg font-semibold mb-4" style={{ color: tk.textPrimary }}>📂 備份列表</h2>

          {backups.length === 0 ? (
            <div className="text-center py-8 text-sm" style={{ color: tk.textMuted }}>{tt("backup.noBackup")}</div>
          ) : (
            <div className="space-y-3">
              {backups.map(b => (
                <div key={b.id} className="flex items-center gap-4 p-3 rounded-lg border"
                  style={{ background: tk.bg, borderColor: tk.borderLight }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: tk.textPrimary }}>{b.filename}</div>
                    <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: tk.textMuted }}>
                      <span>{formatSize(b.size)}</span>
                      <span>{new Date(b.createdAt).toLocaleString("zh-TW")}</span>
                      <span>{b.dirs?.length || 0} 個目錄</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => doRestore(b.filename)} disabled={restoring === b.filename}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium"
                      style={{ background: tk.accentBg, color: tk.accentText, border: `1px solid ${tk.borderInput}` }}>
                      {restoring === b.filename ? tt("backup.restoring") : tt("backup.restore")}
                    </button>
                    <button onClick={() => deleteBackup(b.filename)}
                      className="text-xs px-2 py-1.5 rounded-lg"
                      style={{ background: "#fef2f2", color: "#991b1b" }}>
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
    </div>
  );
}
