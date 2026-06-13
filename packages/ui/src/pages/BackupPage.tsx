/**
 * BackupPage — Backup management
 *
 * View backup history, trigger manual backups, restore from backup.
 * Calls paaw-bridge at :4100.
 */

import React, { useEffect, useState, useCallback } from "react";
import { useTheme } from "../theme";

const BRIDGE_URL = "http://127.0.0.1:4100";

interface BackupMeta {
  id: string;
  label: string;
  timestamp: string;
  paths: string[];
  fileCount: number;
  sizeBytes: number;
}

interface BridgeHealth {
  ok: boolean;
  containerRunning: boolean;
  lastBackupAt: string | null;
  backupCount: number;
}

export default function BackupPage() {
  const { info: t } = useTheme();
  const [backups, setBackups] = useState<BackupMeta[]>([]);
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [healthRes, backupRes] = await Promise.all([
        fetch(`${BRIDGE_URL}/health`).then(r => r.json()).catch(() => null),
        fetch(`${BRIDGE_URL}/api/backup`).then(r => r.json()).catch(() => null),
      ]);
      if (healthRes) setHealth(healthRes);
      if (backupRes?.backups) setBackups(backupRes.backups);
    } catch {
      setMessage({ type: "error", text: "Cannot connect to Bridge service (port 4100). Is it running?" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const triggerBackup = async () => {
    setActionLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${BRIDGE_URL}/api/backup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "manual" }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: `Backup complete: ${data.fileCount} files (${(data.sizeBytes / 1024).toFixed(1)}KB)` });
        await loadData();
      } else {
        setMessage({ type: "error", text: data.error || "Backup failed" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const restore = async (backupId: string) => {
    setActionLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${BRIDGE_URL}/api/backup/restore/${backupId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: `Restored ${data.restored} paths from ${backupId}` });
      } else {
        setMessage({ type: "error", text: data.error || "Restore failed" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setActionLoading(false);
      setRestoreTarget(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-stone-400 text-sm">Loading...</div>;
  }

  return (
    <div className="h-full overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
      <div className="max-w-4xl mx-auto p-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-stone-800">🗄️ Backup</h1>
            <p className="text-sm text-stone-500 mt-0.5">自動備份 sandbox 資料到 host</p>
          </div>
          <button
            onClick={triggerBackup}
            disabled={actionLoading}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: actionLoading ? "#a8a29e" : "#78716c" }}
          >
            {actionLoading ? "⏳ Backing up..." : "⚡ Backup Now"}
          </button>
        </div>

        {/* Status card */}
        {health && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-xl border border-stone-200 p-4">
              <div className="text-xs text-stone-400 mb-1">Container</div>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${health.containerRunning ? "bg-green-500" : "bg-red-400"}`} />
                <span className="text-sm font-semibold text-stone-700">
                  {health.containerRunning ? "Running" : "Stopped"}
                </span>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-stone-200 p-4">
              <div className="text-xs text-stone-400 mb-1">Last Backup</div>
              <div className="text-sm font-semibold text-stone-700">
                {health.lastBackupAt ? formatTime(health.lastBackupAt) : "—"}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-stone-200 p-4">
              <div className="text-xs text-stone-400 mb-1">Total Backups</div>
              <div className="text-sm font-semibold text-stone-700">{health.backupCount}</div>
            </div>
          </div>
        )}

        {/* Message */}
        {message && (
          <div className={`px-4 py-3 rounded-lg text-sm ${
            message.type === "success" ? "bg-green-50 text-green-700 border border-green-200" :
            message.type === "error" ? "bg-red-50 text-red-700 border border-red-200" :
            "bg-blue-50 text-blue-700 border border-blue-200"
          }`}>
            {message.text}
          </div>
        )}

        {/* Backup list */}
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-100">
            <h2 className="text-sm font-bold text-stone-700">Backup History</h2>
          </div>
          {backups.length === 0 ? (
            <div className="px-4 py-12 text-center text-stone-400 text-sm">
              <div className="text-3xl mb-2 opacity-50">📦</div>
              No backups yet. Click "Backup Now" to create one.
            </div>
          ) : (
            <div className="divide-y divide-stone-50">
              {backups.slice().reverse().map((backup) => (
                <div key={backup.id} className="px-4 py-3 flex items-center justify-between hover:bg-stone-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                      backup.label === "auto" ? "bg-blue-50 text-blue-600" :
                      backup.label === "initial" ? "bg-purple-50 text-purple-600" :
                      "bg-amber-50 text-amber-600"
                    }`}>
                      {backup.label === "auto" ? "A" : backup.label === "initial" ? "I" : "M"}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-stone-700">
                        {backup.id} <span className="text-stone-400 text-xs">({backup.label})</span>
                      </div>
                      <div className="text-xs text-stone-400">
                        {formatTime(backup.timestamp)} • {backup.fileCount} files • {formatSize(backup.sizeBytes)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      {backup.paths.slice(0, 4).map(p => (
                        <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{p}</span>
                      ))}
                      {backup.paths.length > 4 && (
                        <span className="text-[10px] px-1.5 py-0.5 text-stone-400">+{backup.paths.length - 4}</span>
                      )}
                    </div>
                    {restoreTarget === backup.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => restore(backup.id)}
                          disabled={actionLoading}
                          className="text-xs px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
                        >
                          Confirm Restore
                        </button>
                        <button
                          onClick={() => setRestoreTarget(null)}
                          className="text-xs px-2 py-1 rounded bg-stone-100 text-stone-500 hover:bg-stone-200"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setRestoreTarget(backup.id)}
                        className="text-xs px-2 py-1 rounded text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
                      >
                        ↺ Restore
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
