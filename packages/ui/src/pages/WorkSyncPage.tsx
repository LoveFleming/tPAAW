/**
 * WorkSyncPage — Work Sync (Review Gate)
 *
 * Review changes from sandbox, approve or reject before they go live.
 * Calls paaw-bridge at :4100.
 */

import React, { useEffect, useState, useCallback } from "react";
import { useTheme } from "../theme";

const BRIDGE_URL = "http://127.0.0.1:4100";

interface SyncChange {
  path: string;
  type: "added" | "modified" | "removed";
  diff?: string;
}

interface SyncRequest {
  id: string;
  subPath: string;
  label: string;
  changes: SyncChange[];
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

const SYNC_PATHS = [
  { value: "skills", label: "Skills", icon: "⚡" },
  { value: "apps", label: "Apps", icon: "🚀" },
  { value: "workflows", label: "Workflows", icon: "🔄" },
  { value: "system", label: "System", icon: "⚙️" },
];

export default function WorkSyncPage() {
  const { info: t } = useTheme();
  const [pending, setPending] = useState<SyncRequest[]>([]);
  const [history, setHistory] = useState<SyncRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedReq, setSelectedReq] = useState<string | null>(null);
  const [diffDetail, setDiffDetail] = useState<SyncRequest | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [syncPath, setSyncPath] = useState("skills");

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`${BRIDGE_URL}/api/sync/pending`).then(r => r.json()).catch(() => ({ requests: [] }));
      setPending(res.requests || []);
    } catch {
      setMessage({ type: "error", text: "Cannot connect to Bridge service (port 4100)" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const createRequest = async () => {
    setActionLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${BRIDGE_URL}/api/sync/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subPath: syncPath, label: `${syncPath} review` }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.changes.length === 0) {
          setMessage({ type: "success", text: `No changes in ${syncPath}/ — sandbox and backup are in sync` });
        } else {
          setMessage({ type: "info" as any, text: `Found ${data.changes.length} changes in ${syncPath}/` });
          await loadData();
        }
      } else {
        setMessage({ type: "error", text: data.error || "Failed to create sync request" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const viewDiff = async (id: string) => {
    try {
      const res = await fetch(`${BRIDGE_URL}/api/sync/diff/${id}`);
      const data = await res.json();
      if (res.ok) {
        setDiffDetail(data);
        setSelectedReq(id);
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    }
  };

  const approve = async (id: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`${BRIDGE_URL}/api/sync/approve/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewedBy: "fleming" }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: `✓ Approved: ${data.changes?.length || 0} files synced to backup` });
        setDiffDetail(null);
        setSelectedReq(null);
        await loadData();
      } else {
        setMessage({ type: "error", text: data.error });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const reject = async (id: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`${BRIDGE_URL}/api/sync/reject/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewedBy: "fleming", reason: "manual reject" }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "✗ Rejected — changes discarded" });
        setDiffDetail(null);
        setSelectedReq(null);
        await loadData();
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const changeColor = (type: string) => {
    switch (type) {
      case "added": return "text-green-600 bg-green-50 border-green-200";
      case "modified": return "text-amber-600 bg-amber-50 border-amber-200";
      case "removed": return "text-red-600 bg-red-50 border-red-200";
      default: return "text-stone-600 bg-stone-50 border-stone-200";
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-stone-400 text-sm">Loading...</div>;
  }

  return (
    <div className="h-full overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
      <div className="max-w-4xl mx-auto p-6 space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-stone-800">🔄 Work Sync</h1>
          <p className="text-sm text-stone-500 mt-0.5">Review sandbox 變更，approve 後才寫入備份</p>
        </div>

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

        {/* Create sync request */}
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <h2 className="text-sm font-bold text-stone-700 mb-3">Check for Changes</h2>
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              {SYNC_PATHS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setSyncPath(p.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    syncPath === p.value
                      ? "bg-stone-700 text-white"
                      : "bg-stone-50 text-stone-500 hover:bg-stone-100"
                  }`}
                >
                  {p.icon} {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={createRequest}
              disabled={actionLoading}
              className="ml-auto px-4 py-1.5 rounded-lg text-sm font-medium text-white bg-stone-700 hover:bg-stone-800 disabled:opacity-50 transition-colors"
            >
              {actionLoading ? "⏳ Checking..." : "🔍 Check Changes"}
            </button>
          </div>
        </div>

        {/* Pending requests */}
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
            <h2 className="text-sm font-bold text-stone-700">Pending Review</h2>
            {pending.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                {pending.length} pending
              </span>
            )}
          </div>
          {pending.length === 0 ? (
            <div className="px-4 py-10 text-center text-stone-400 text-sm">
              <div className="text-3xl mb-2 opacity-50">✅</div>
              No pending changes. Click "Check Changes" to scan.
            </div>
          ) : (
            <div className="divide-y divide-stone-50">
              {pending.map(req => (
                <div key={req.id} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-stone-700">{req.label}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{req.subPath}/</span>
                    </div>
                    <span className="text-xs text-stone-400">{formatTime(req.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    {req.changes.slice(0, 8).map((c, i) => (
                      <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded border ${changeColor(c.type)}`}>
                        {c.type === "added" ? "+" : c.type === "modified" ? "~" : "-"} {c.path.split("/").pop()}
                      </span>
                    ))}
                    {req.changes.length > 8 && (
                      <span className="text-[10px] text-stone-400">+{req.changes.length - 8} more</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => viewDiff(req.id)}
                      className="text-xs px-2 py-1 rounded bg-stone-100 text-stone-600 hover:bg-stone-200 transition-colors"
                    >
                      📄 View Diff ({req.changes.length})
                    </button>
                  </div>

                  {/* Diff detail panel */}
                  {selectedReq === req.id && diffDetail && (
                    <div className="mt-3 border border-stone-200 rounded-lg overflow-hidden bg-stone-50">
                      <div className="px-3 py-2 border-b border-stone-200 bg-white flex items-center justify-between">
                        <span className="text-xs font-bold text-stone-600">Diff Detail — {diffDetail.id}</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => approve(req.id)}
                            disabled={actionLoading}
                            className="text-xs px-3 py-1 rounded bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 transition-colors font-medium"
                          >
                            ✓ Approve
                          </button>
                          <button
                            onClick={() => reject(req.id)}
                            disabled={actionLoading}
                            className="text-xs px-3 py-1 rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors font-medium"
                          >
                            ✗ Reject
                          </button>
                          <button
                            onClick={() => { setSelectedReq(null); setDiffDetail(null); }}
                            className="text-xs px-2 py-1 rounded text-stone-400 hover:bg-stone-100"
                          >
                            Close
                          </button>
                        </div>
                      </div>
                      <div className="max-h-96 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                        {diffDetail.changes.map((change, i) => (
                          <div key={i} className="border-b border-stone-100 last:border-b-0">
                            <div className="px-3 py-1.5 flex items-center gap-2 bg-white">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${changeColor(change.type)}`}>
                                {change.type}
                              </span>
                              <span className="text-xs font-mono text-stone-600">{change.path}</span>
                            </div>
                            {change.diff && (
                              <pre className="px-3 py-2 text-[11px] font-mono text-stone-500 overflow-x-auto bg-stone-50"
                                style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                                {change.diff.slice(0, 3000)}
                                {change.diff.length > 3000 && "\n... (truncated)"}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
