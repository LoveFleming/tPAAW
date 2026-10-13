/**
 * InspectionPanel — 📈 Grafana 巡檢（deterministic：server 打 API 掃描，零 LLM）
 * 設定（baseUrl / token / TLS）→ 一鍵巡檢 → 逐項結果 + 報告落檔（_global 櫃）
 */
import React, { useCallback, useEffect, useState } from "react";
import MarkdownText from "@paaw-ui/components/MarkdownText";

type Cfg = { baseUrl?: string; token?: string; verifyTls?: boolean; datasourceHealth?: boolean };
type Check = { id: string; label: string; level: "ok" | "warn" | "error"; detail: string };
type Summary = { status: string; errors: number; warns: number; ok: number; total: number; at: string; baseUrl: string };
type InspectResult = { ok: boolean; error?: string; summary?: Summary; checks?: Check[]; markdown?: string; reportPath?: string };

export default function InspectionPanel() {
  const [cfg, setCfg] = useState<Cfg>({ baseUrl: "", token: "", verifyTls: true, datasourceHealth: true });
  const [configured, setConfigured] = useState(false);
  const [history, setHistory] = useState<{ file: string; at: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<InspectResult | null>(null);
  const [viewing, setViewing] = useState<{ file: string; content: string } | null>(null);
  const [showCfg, setShowCfg] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await fetch("/api/sre/grafana").then(r => r.json());
      setCfg(c => ({ ...c, baseUrl: d.config?.baseUrl || "", token: d.config?.token || "", verifyTls: d.config?.verifyTls !== false, datasourceHealth: d.config?.datasourceHealth !== false }));
      setConfigured(!!d.configured);
      setHistory(d.history || []);
      if (!d.configured) setShowCfg(true);
    } catch (e) { setMsg(`⚠️ 讀取設定失敗：${e}`); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true); setMsg("");
    try {
      const r = await fetch("/api/sre/grafana", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      }).then(r => r.json());
      if (r.error) setMsg(`❌ ${r.error}`);
      else { setMsg("✅ 已儲存"); setConfigured(!!r.config?.baseUrl); setShowCfg(false); }
    } finally { setSaving(false); }
  };

  const inspect = async () => {
    setBusy(true); setMsg(""); setResult(null); setViewing(null);
    try {
      const r = await fetch("/api/sre/grafana/inspect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }).then(r => r.json());
      setResult(r);
      if (r.error) setMsg(`❌ ${r.error}`);
      else setMsg(`✅ 巡檢完成 — ${r.summary?.status}（${r.reportPath || "報告未落檔"}）`);
      load();
    } catch (e) { setMsg(`❌ 巡檢失敗：${e}`); }
    finally { setBusy(false); }
  };

  const openReport = async (file: string) => {
    try {
      const d = await fetch(`/api/sre/grafana/report?file=${encodeURIComponent(file)}`).then(r => r.json());
      if (d.error) { setMsg(`❌ ${d.error}`); return; }
      setViewing({ file, content: d.content });
    } catch (e) { setMsg(`❌ 讀取報告失敗：${e}`); }
  };

  const badge = (lv: string) => lv === "error" ? "❌" : lv === "warn" ? "⚠️" : "✅";

  return (
    <div className="h-full overflow-y-auto bg-white p-6" style={{ scrollbarWidth: "thin" }}>
      <div className="max-w-4xl mx-auto">
        {/* header */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <div className="text-sm font-bold text-stone-800">📈 Grafana 巡檢</div>
          <span className="text-[11px] text-stone-400">程式打 API 掃描（健康 / 資料源 / 面板 / 告警），零 LLM — 事實靠程式</span>
          <div className="flex-1" />
          <button onClick={() => setShowCfg(v => !v)} className="text-xs rounded-lg border border-stone-300 px-3 py-1 hover:bg-stone-50">
            ⚙️ {showCfg ? "收起設定" : "設定連線"}
          </button>
          <button onClick={inspect} disabled={busy || !configured} className="text-xs rounded-lg bg-stone-800 text-white px-3 py-1.5 font-semibold disabled:opacity-40 hover:bg-stone-700">
            {busy ? "巡檢中…" : "▶️ 跑巡檢"}
          </button>
        </div>

        {msg && <div className="text-xs text-stone-600 mb-3">{msg}</div>}

        {/* 設定 */}
        {showCfg && (
          <div className="rounded-xl border border-stone-200 p-4 mb-4 space-y-2.5 bg-stone-50">
            <div className="text-[11px] text-stone-500">Grafana base URL（例：https://grafana.example.com）與 API token（Settings → Service accounts → Add token）。token 只存在本機 <span className="font-mono">data/installed-apps/sre/config/grafana.json</span>。</div>
            <input value={cfg.baseUrl || ""} onChange={e => setCfg(c => ({ ...c, baseUrl: e.target.value }))} className="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-mono" placeholder="https://grafana.example.com" />
            <input value={cfg.token || ""} onChange={e => setCfg(c => ({ ...c, token: e.target.value }))} className="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm font-mono" placeholder="glsa_xxxxxxxx（API token，可留空若匿名可讀）" />
            <div className="flex gap-4 text-xs text-stone-600">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={cfg.verifyTls !== false} onChange={e => setCfg(c => ({ ...c, verifyTls: e.target.checked }))} />驗證 TLS 憑證（自簽憑證請取消）</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={cfg.datasourceHealth !== false} onChange={e => setCfg(c => ({ ...c, datasourceHealth: e.target.checked }))} />逐個資料源健康檢查</label>
            </div>
            <button onClick={save} disabled={saving} className="rounded-lg bg-stone-800 text-white px-4 py-1.5 text-sm font-semibold disabled:opacity-40">{saving ? "儲存中…" : "儲存設定"}</button>
          </div>
        )}

        {/* 結果 */}
        {result?.ok && result.summary && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-lg">{result.summary.status}</span>
              <span className="text-xs text-stone-500">{result.summary.baseUrl}</span>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600">✅ {result.summary.ok}</span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">⚠️ {result.summary.warns}</span>
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] text-red-700">❌ {result.summary.errors}</span>
            </div>
            <div className="space-y-1">
              {(result.checks || []).map(c => (
                <div key={c.id} className="flex items-start gap-2 rounded-lg border border-stone-200 px-3 py-1.5">
                  <span className="text-xs shrink-0">{badge(c.level)}</span>
                  <span className="text-xs font-medium text-stone-700 shrink-0">{c.label}</span>
                  <span className="text-xs text-stone-500 truncate">{c.detail}</span>
                </div>
              ))}
            </div>
            {result.reportPath && <div className="text-[11px] text-stone-400 mt-2">📄 報告已落檔：<span className="font-mono">{result.reportPath}</span></div>}
          </div>
        )}

        {viewing && (
          <div className="rounded-xl border border-stone-200 p-4 mb-4">
            <div className="flex items-center mb-2">
              <div className="text-xs font-bold text-stone-700 font-mono">{viewing.file}</div>
              <div className="flex-1" />
              <button onClick={() => setViewing(null)} className="text-stone-400 hover:text-stone-700 text-lg leading-none">✕</button>
            </div>
            <MarkdownText>{viewing.content}</MarkdownText>
          </div>
        )}

        {/* 歷史 */}
        <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-1">歷史巡檢報告</div>
        {history.length === 0 && <div className="text-sm text-stone-400">尚無報告 — 設定好連線後按「▶️ 跑巡檢」</div>}
        <div className="space-y-1">
          {history.map(h => (
            <button key={h.file} onClick={() => openReport(h.file)} className="w-full text-left text-xs rounded-lg border border-stone-200 px-3 py-1.5 hover:bg-stone-50 font-mono text-stone-600">
              📄 {h.file}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
