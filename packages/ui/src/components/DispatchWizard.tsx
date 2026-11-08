/**
 * DispatchWizard — 🚀 派工工作目錄（Job Catalog 版，2026-11-08 Fleming）
 *
 * 大改：不再 hardcode「機制分類」（direct/emjob/plan/execute/auto），
 * 改吃 server 端 dispatch-catalog（目標場景卡）：
 *   - 卡片 = EM 能幫你做什麼（完成 open tasks / 開 review 委員會 / 安全閉環 / 測試補洞 / release / 直接派一人）
 *   - 每張卡展開：流程（flow）+ 注意事項（preconditions）+ 參數表單（catalog params schema）
 *   - 送出走 entrypoint.kind：em-job / auto-start / dispatch(SSE) / review-run(SSE)
 *   - 之後 server 加新工作（user manual / UI 照相 / vision…）→ catalog 加 manifest，這裡自動長出來
 */
import { useEffect, useState } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import { cn } from "./ui/shared";

interface ParamDef {
  id: string; label: string; type: "text" | "textarea" | "number" | "select";
  required?: boolean; placeholder?: string; default?: any;
  options?: string[]; optionLabels?: string[]; min?: number; max?: number;
}
interface JobDef {
  id: string; emoji: string; label: string; desc: string;
  flow: string[]; preconditions: string;
  entrypoint: { kind: "em-job" | "auto-start" | "dispatch" | "review-run"; url: string; job?: string };
  params: ParamDef[];
}
interface AgentOpt { id: string; label: string }

interface Props {
  rootPath: string;
  theme: { bg: string; bgMuted: string; borderLight: string; accent: string; accentBg: string; text: string; accentBorder?: string };
  onClose: () => void;
}

export default function DispatchWizard({ rootPath, theme: tk, onClose }: Props) {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<JobDef[]>([]);
  const [agents, setAgents] = useState<AgentOpt[]>([]);
  const [loadError, setLoadError] = useState("");
  const [jobId, setJobId] = useState("");
  const [values, setValues] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  // 載入 catalog
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/coding-crew/dispatch-catalog`);
        const d = await r.json().catch(() => ({}));
        if (d.error) { setLoadError(d.error); return; }
        const js: JobDef[] = d.jobs || [];
        setJobs(js);
        setAgents(d.directAgents || []);
        if (js.length) selectJob(js[0], d.directAgents || []);
      } catch (err: any) { setLoadError(err.message); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const job = jobs.find(j => j.id === jobId) || null;

  function selectJob(j: JobDef, agentList?: AgentOpt[]) {
    setJobId(j.id); setResult("");
    const v: Record<string, any> = {};
    for (const p of j.params || []) {
      if (p.default !== undefined) v[p.id] = p.default;
      else if (p.type === "number") v[p.id] = 5;
      else if (p.type === "select") v[p.id] = p.options?.[0];
      else v[p.id] = "";
    }
    // 直接派工的 agent 選項 label 由 catalog agents 帶（options=id 清單）
    (j.params || []).forEach(p => { if (p.id === "agentId" && !p.optionLabels?.length && agentList?.length) p.optionLabels = agentList.map(a => a.label); });
    setValues(v);
  }

  const setVal = (id: string, val: any) => setValues(prev => ({ ...prev, [id]: val }));

  // ── SSE 讀取共用（dispatch / review-run）──
  async function readSSE(r: Response, onEvent: (d: any) => boolean | void) {
    if (!r.ok || !r.body) {
      const d = await r.json().catch(() => ({}));
      setResult(`❌ ${d.error || r.status}`); return;
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = ""; let finished = false;
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const events = buf.split("\n\n"); buf = events.pop() || "";
      for (const ev of events) {
        const line = ev.split("\n").find(l => l.startsWith("data: "));
        if (!line) continue;
        try { const d = JSON.parse(line.slice(6)); if (onEvent(d) === true) finished = true; } catch {}
      }
    }
  }

  async function submit() {
    if (!job) return;
    // required 檢查
    for (const p of job.params || []) {
      if (p.required && !String(values[p.id] || "").trim()) { setResult(`❌ ${p.label} 未填`); return; }
    }
    setBusy(true); setResult("⏳ " + t("dw.launching"));
    const ep = job.entrypoint;
    try {
      if (ep.kind === "em-job") {
        const r = await fetch(`${API_BASE}${ep.url}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: rootPath, job: ep.job, action: values.action || "run", maxTickets: Number(values.maxTickets) || 5 }),
        });
        const d = await r.json().catch(() => ({}));
        if (d.error) { setResult(`❌ ${d.error}`); }
        else {
          const lines = (d.tickets || []).map((x: any, i: number) => `${i + 1}. [${x.priority || "medium"}/${x.type || "dev"}] ${String(x.title).slice(0, 70)}`);
          setResult(`${d.emoji || ""} **${d.label || ep.job}** ${(d.findingsCount ?? 0)} findings（${((d.durationMs || 0) / 1000).toFixed(0)}s）\n${d.summary || ""}\n${d.message || ""}${lines.length ? `\n${lines.join("\n")}` : ""}`);
        }
      } else if (ep.kind === "auto-start") {
        const r = await fetch(`${API_BASE}${ep.url}?path=${encodeURIComponent(rootPath)}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values.taskId ? { taskId: values.taskId.trim().toUpperCase() } : {}),
        });
        const d = await r.json().catch(() => ({}));
        setResult(d.error ? `❌ ${d.error}` : "⚡ 已啟動 task-driven 閉環（進度見 🎖️ EM Dashboard 狀態列 / 派工報告）");
      } else if (ep.kind === "dispatch") {
        setResult("⏳ 已派工，串流執行中…");
        const r = await fetch(`${API_BASE}${ep.url}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: values.agentId, task: values.task, priority: values.priority, cwd: rootPath }),
        });
        await readSSE(r, (d) => {
          if (d.error) { setResult(`❌ ${d.error}`); return true; }
          if (d.event === "done" || d.done) { setResult("✅ 已派工並執行完成（詳情見派工報告）"); return true; }
        });
      } else if (ep.kind === "review-run") {
        const logs: string[] = [];
        const r = await fetch(`${API_BASE}${ep.url}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: rootPath, ref: values.ref || undefined, path: values.path || undefined }),
        });
        await readSSE(r, (d) => {
          if (d.error) { setResult(`❌ ${d.error}`); return true; }
          if (d.event === "progress") { logs.push(d.message); setResult(`🏛️ 審查中…\n${logs.slice(-4).join("\n")}`); }
          if (d.event === "done") { setResult(`🏛️ ${t("dw.rvDone")}（${d.decision || "?"}）\n\n${d.result || ""}`); return true; }
        });
      }
    } catch (err: any) { setResult(`❌ ${err.message}`); }
    setBusy(false);
  }

  const field = "w-full text-sm rounded-lg px-2 py-1.5 border";
  const inputStyle = { backgroundColor: tk.bg, borderColor: tk.borderLight, color: tk.text as string };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-[600px] max-w-[92vw] max-h-[86vh] overflow-auto rounded-xl shadow-2xl" style={{ backgroundColor: tk.bg, border: `1px solid ${tk.borderLight}` }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: tk.borderLight }}>
          <div className="flex items-center gap-2">
            <span className="text-lg">🚀</span>
            <span className="text-sm font-bold" style={{ color: tk.text }}>{t("dw.title")}</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ backgroundColor: tk.bgMuted, color: tk.text }}>{rootPath?.split("/").pop()}</span>
          </div>
          <button onClick={onClose} className="text-xs px-2 py-1 rounded-lg border hover:bg-stone-50" style={{ borderColor: tk.borderLight }}>✕</button>
        </div>

        {loadError ? (
          <div className="px-4 py-6 text-xs" style={{ color: tk.text }}>❌ {t("dw.catLoadFail")}：{loadError}</div>
        ) : !job ? (
          <div className="px-4 py-6 text-xs" style={{ color: tk.text }}>⏳ {t("dw.catLoading")}…</div>
        ) : (
          <>
            {/* 工作場景卡（catalog 驅動） */}
            <div className="px-4 py-3">
              <div className="text-[11px] font-semibold mb-1.5" style={{ color: tk.text }}>{t("dw.pickJob")}</div>
              <div className="grid grid-cols-3 gap-1.5">
                {jobs.map(j => (
                  <button key={j.id} onClick={() => selectJob(j, agents)}
                    className="rounded-lg border px-2 py-2 text-left transition-colors"
                    style={j.id === jobId
                      ? { borderColor: tk.accent, backgroundColor: tk.accentBg }
                      : { borderColor: tk.borderLight, backgroundColor: tk.bgMuted }}>
                    <div className="text-sm font-semibold leading-tight" style={{ color: tk.text }}>{j.emoji} {j.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 選中工作：說明 + 流程 + 條件 */}
            <div className="px-4 pb-2 space-y-2.5">
              <p className="text-[11px] leading-relaxed" style={{ color: tk.text }}>{job.desc}</p>

              {/* 流程 */}
              <div>
                <div className="text-[11px] font-medium mb-1" style={{ color: tk.text }}>{t("dw.flow")}</div>
                <div className="flex flex-wrap items-center gap-1">
                  {job.flow.map((s, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: tk.bgMuted, border: `1px solid ${tk.borderLight}`, color: tk.text }}>{i + 1}. {s}</span>
                      {i < job.flow.length - 1 && <span className="text-[10px]" style={{ color: tk.text }}>→</span>}
                    </span>
                  ))}
                </div>
              </div>

              {job.preconditions && <p className="text-[10px]" style={{ color: tk.text }}>ℹ️ {job.preconditions}</p>}

              {/* 參數表單（catalog schema 驅動） */}
              {(job.params || []).map(p => (
                <div key={p.id}>
                  <label className="text-[11px] font-medium" style={{ color: tk.text }}>{p.label}{p.required ? " *" : ""}</label>
                  {p.type === "textarea" ? (
                    <textarea value={values[p.id] || ""} onChange={e => setVal(p.id, e.target.value)} rows={4} className={field} style={inputStyle} placeholder={p.placeholder || ""} />
                  ) : p.type === "select" ? (
                    <select value={values[p.id] || p.options?.[0]} onChange={e => setVal(p.id, e.target.value)} className={field} style={inputStyle}>
                      {(p.options || []).map((o, i) => <option key={o} value={o}>{p.optionLabels?.[i] || o}</option>)}
                    </select>
                  ) : p.type === "number" ? (
                    <input type="number" min={p.min} max={p.max} value={values[p.id] ?? p.default ?? 5} onChange={e => setVal(p.id, Number(e.target.value))} className={field} style={inputStyle} />
                  ) : (
                    <input value={values[p.id] || ""} onChange={e => setVal(p.id, e.target.value)} className={field} style={inputStyle} placeholder={p.placeholder || ""} />
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* 結果 */}
        {result && (
          <div className="mx-4 mb-2 rounded-lg p-2.5 text-xs whitespace-pre-wrap font-mono max-h-56 overflow-auto" style={{ backgroundColor: tk.bgMuted, border: `1px solid ${tk.borderLight}`, color: tk.text }}>{result}</div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t" style={{ borderColor: tk.borderLight }}>
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg border" style={{ borderColor: tk.borderLight, color: tk.text }}>{t("dw.cancel")}</button>
          <button onClick={submit} disabled={busy || !job}
            className={cn("text-xs px-4 py-1.5 rounded-lg font-semibold", (busy || !job) && "opacity-50")}
            style={{ backgroundColor: tk.accent, color: "#fff" }}>
            {busy ? "…" : `🚀 ${t("dw.go")}`}
          </button>
        </div>
      </div>
    </div>
  );
}
