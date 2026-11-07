/**
 * DispatchWizard — 🚀 派工精靈（2026-11-07 Fleming）
 * 一顆按鈕 → modal 選 5 種派工類型 → 動態表單 → 送出：
 *  1. 👤 直接派工（指定 agent + 任務）
 *  2. 📦 EM 工單（cu-scan / security-fix / test-gen / release-prep）
 *  3. 🗺️ EM Plan（只規劃不出工）
 *  4. ⚡ EM Execute（確認 workList 出工；Plan 結果可一鍵帶入）
 *  5. 🔄 自動調度（start / stop）
 */
import { useState } from "react";
import API_BASE from "../api";
import { useI18n } from "../i18n";
import { cn } from "./ui/shared";

type DispatchKind = "direct" | "emjob" | "plan" | "execute" | "auto";

const AGENTS = [
  { id: "coding.developer", label: "💻 Developer 開發" },
  { id: "coding.qa", label: "🧪 QA 品管" },
  { id: "coding.tester", label: "🔬 Tester 測試" },
  { id: "coding.architect", label: "📐 Architect 架構" },
  { id: "coding.helpdesk", label: "🛟 Helpdesk 支援" },
  { id: "coding.doc-writer", label: "📝 Doc-writer 文件" },
  { id: "coding.rm", label: "🎖️ RM Release" },
  { id: "coding.ops", label: "🔧 Ops 維運" },
];

const JOBS = [
  { id: "cu-scan", label: "🔍 CU 掃描", desc: "Code Understanding 新鮮度檢查" },
  { id: "security-fix", label: "🛡️ 安全修復", desc: "semgrep findings 開修復單" },
  { id: "test-gen", label: "🧪 測試生成", desc: "缺測試的 API/feature 開單" },
  { id: "release-prep", label: "📦 Release 準備", desc: "Release 現況盤點" },
];

interface Props {
  rootPath: string;
  theme: { bg: string; bgMuted: string; borderLight: string; accent: string; accentBg: string; text: string; accentBorder?: string };
  onClose: () => void;
}

export default function DispatchWizard({ rootPath, theme: tk, onClose }: Props) {
  const { t } = useI18n();
  const [kind, setKind] = useState<DispatchKind>("direct");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");

  // 直接派工
  const [agentId, setAgentId] = useState("coding.developer");
  const [task, setTask] = useState("");
  const [priority, setPriority] = useState("medium");

  // EM 工單
  const [job, setJob] = useState("cu-scan");
  const [maxTickets, setMaxTickets] = useState(5);
  const [jobAction, setJobAction] = useState<"preview" | "run">("preview");

  // EM Plan / Execute
  const [since, setSince] = useState("");
  const [workListJson, setWorkListJson] = useState("");
  const [situationReport, setSituationReport] = useState("");

  const KINDS: { id: DispatchKind; label: string; emoji: string }[] = [
    { id: "direct", label: t("dw.kDirect"), emoji: "👤" },
    { id: "emjob", label: t("dw.kEmjob"), emoji: "📦" },
    { id: "plan", label: t("dw.kPlan"), emoji: "🗺️" },
    { id: "execute", label: t("dw.kExecute"), emoji: "⚡" },
    { id: "auto", label: t("dw.kAuto"), emoji: "🔄" },
  ];

  async function submit() {
    setBusy(true); setResult("");
    try {
      if (kind === "direct") {
        if (!task.trim()) { setResult("❌ 請填任務描述"); setBusy(false); return; }
        // 2026-11-07 修：dispatch 是 SSE 串流，不能 await r.json()（會卡死）→ 邊讀邊回報
        try {
          const r = await fetch(`${API_BASE}/api/coding-crew/dispatch`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentId, task, cwd: rootPath, priority }),
          });
          if (!r.ok || !r.body) {
            const d = await r.json().catch(() => ({}));
            setResult(`❌ ${d.error || r.status}`); setBusy(false); return;
          }
          setResult("✅ 已派工，串流執行中…");
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
              try {
                const d = JSON.parse(line.slice(6));
                if (d.error) { setResult(`❌ ${d.error}`); finished = true; }
                else if (d.event === "done" || d.done) { finished = true; setResult("✅ 已派工並執行完成（詳情見派工報告）"); }
              } catch {}
            }
          }
          if (!finished) setResult("✅ 已派工（連線結束，詳情見派工報告）");
        } catch (err: any) { setResult(`❌ ${err.message}`); }
      } else if (kind === "emjob") {
        const r = await fetch(`${API_BASE}/api/coding-crew/em-job`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: rootPath, job, action: jobAction, maxTickets }),
        });
        const d = await r.json().catch(() => ({}));
        if (d.error) { setResult(`❌ ${d.error}`); }
        else {
          const lines = (d.tickets || []).map((x: any, i: number) => `${i + 1}. [${x.priority || "medium"}/${x.type || "dev"}] ${String(x.title).slice(0, 70)}`);
          setResult(`${d.emoji || ""} **${d.label || job}** ${(d.findingsCount ?? 0)} findings（${((d.durationMs || 0) / 1000).toFixed(0)}s）\n${d.summary || ""}\n${d.message || ""}${lines.length ? `\n${lines.join("\n")}` : ""}`);
        }
      } else if (kind === "plan") {
        const r = await fetch(`${API_BASE}/api/coding-crew/em-plan`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: rootPath, ...(since ? { since } : {}) }),
        });
        const d = await r.json().catch(() => ({}));
        if (d.error) { setResult(`❌ ${d.error}`); }
        else {
          const wl = d.workList || d.plan?.workList || [];
          setWorkListJson(JSON.stringify(wl, null, 2));
          setSituationReport(d.situationReport || d.plan?.situationReport || "");
          setResult(`🗺️ Plan 完成：${wl.length} 項工作。已帶入「⚡ EM Execute」分頁，切過去即可出工。`);
        }
      } else if (kind === "execute") {
        let workList: any[] = [];
        try { workList = JSON.parse(workListJson || "[]"); } catch { setResult("❌ workList JSON 格式錯誤"); setBusy(false); return; }
        if (!workList.length) { setResult("❌ workList 是空的（先跑 🗺️ EM Plan）"); setBusy(false); return; }
        const r = await fetch(`${API_BASE}/api/coding-crew/em-execute`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: rootPath, workList, situationReport }),
        });
        const d = await r.json().catch(() => ({}));
        setResult(d.error ? `❌ ${d.error}` : "⚡ 已出工（進度見 🎖️ EM 自動調度面板 / 派工報告）");
      } else if (kind === "auto") {
        const r = await fetch(`${API_BASE}/api/coding-auto-dispatch/stop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: rootPath }) });
        await r.json().catch(() => ({}));
        const r2 = await fetch(`${API_BASE}/api/coding-auto-dispatch/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: rootPath }) });
        const d2 = await r2.json().catch(() => ({}));
        setResult(d2.error ? `❌ ${d2.error}` : "🔄 自動調度已啟動（先 stop 清殭屍再 start）");
      }
    } catch (err: any) {
      setResult(`❌ ${err.message}`);
    }
    setBusy(false);
  }

  const field = "w-full text-sm rounded-lg px-2 py-1.5 border";

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-[560px] max-w-[92vw] max-h-[86vh] overflow-auto rounded-xl shadow-2xl" style={{ backgroundColor: tk.bg, border: `1px solid ${tk.borderLight}` }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: tk.borderLight }}>
          <div className="flex items-center gap-2">
            <span className="text-lg">🚀</span>
            <span className="text-sm font-bold" style={{ color: tk.text }}>{t("dw.title")}</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ backgroundColor: tk.bgMuted, color: tk.text }}>{rootPath?.split("/").pop()}</span>
          </div>
          <button onClick={onClose} className="text-xs px-2 py-1 rounded-lg border hover:bg-stone-50" style={{ borderColor: tk.borderLight }}>✕</button>
        </div>

        {/* 類型卡片 */}
        <div className="grid grid-cols-5 gap-1.5 px-4 py-3">
          {KINDS.map(k => (
            <button key={k.id} onClick={() => { setKind(k.id); setResult(""); }}
              className={cn("rounded-lg border px-1 py-2 text-center transition-colors")}
              style={kind === k.id
                ? { borderColor: tk.accent, backgroundColor: tk.accentBg, color: tk.text }
                : { borderColor: tk.borderLight, backgroundColor: tk.bgMuted, color: tk.text }}>
              <div className="text-xl">{k.emoji}</div>
              <div className="text-[11px] mt-0.5 leading-tight">{k.label}</div>
            </button>
          ))}
        </div>

        {/* 動態表單 */}
        <div className="px-4 pb-2 space-y-2.5">
          {kind === "direct" && (<>
            <div>
              <label className="text-[11px] font-medium">{t("dw.agent")}</label>
              <select value={agentId} onChange={e => setAgentId(e.target.value)} className={field} style={{ backgroundColor: tk.bg, borderColor: tk.borderLight, color: tk.text }}>
                {AGENTS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium">{t("dw.task")}</label>
              <textarea value={task} onChange={e => setTask(e.target.value)} rows={4} className={field} style={{ backgroundColor: tk.bg, borderColor: tk.borderLight, color: tk.text }}
                placeholder={t("dw.taskPh")} />
            </div>
            <div>
              <label className="text-[11px] font-medium">{t("dw.priority")}</label>
              <select value={priority} onChange={e => setPriority(e.target.value)} className={field} style={{ backgroundColor: tk.bg, borderColor: tk.borderLight, color: tk.text }}>
                <option value="high">🔴 high</option><option value="medium">🟡 medium</option><option value="low">🟢 low</option>
              </select>
            </div>
          </>)}

          {kind === "emjob" && (<>
            <div className="grid grid-cols-2 gap-1.5">
              {JOBS.map(j => (
                <button key={j.id} onClick={() => setJob(j.id)}
                  className="rounded-lg border px-2 py-2 text-left"
                  style={job === j.id ? { borderColor: tk.accent, backgroundColor: tk.accentBg } : { borderColor: tk.borderLight, backgroundColor: tk.bgMuted }}>
                  <div className="text-xs font-semibold" style={{ color: tk.text }}>{j.label}</div>
                  <div className="text-[10px]" style={{ color: tk.text }}>{j.desc}</div>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-[11px] font-medium">{t("dw.maxTickets")}</label>
                <input type="number" min={1} max={10} value={maxTickets} onChange={e => setMaxTickets(Number(e.target.value))} className={field} style={{ backgroundColor: tk.bg, borderColor: tk.borderLight, color: tk.text }} />
              </div>
              <div>
                <label className="text-[11px] font-medium">{t("dw.mode")}</label>
                <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: tk.borderLight }}>
                  {(["preview", "run"] as const).map(m => (
                    <button key={m} onClick={() => setJobAction(m)} className="text-xs px-3 py-1.5"
                      style={jobAction === m ? { backgroundColor: tk.accent, color: "#fff" } : { backgroundColor: tk.bgMuted, color: tk.text }}>
                      {m === "preview" ? t("dw.preview") : t("dw.run")}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>)}

          {kind === "plan" && (<>
            <div>
              <label className="text-[11px] font-medium">{t("dw.since")}</label>
              <input value={since} onChange={e => setSince(e.target.value)} className={field} style={{ backgroundColor: tk.bg, borderColor: tk.borderLight, color: tk.text }} placeholder="2026-11-01（留空 = 全部）" />
            </div>
            <p className="text-[11px]" style={{ color: tk.text }}>{t("dw.planHint")}</p>
          </>)}

          {kind === "execute" && (<>
            <div>
              <label className="text-[11px] font-medium">{t("dw.workList")}</label>
              <textarea value={workListJson} onChange={e => setWorkListJson(e.target.value)} rows={8} className={cn(field, "font-mono text-xs")} style={{ backgroundColor: tk.bg, borderColor: tk.borderLight, color: tk.text }} placeholder='[{"agent":"coding.developer","task":"..."}]' />
            </div>
            <div>
              <label className="text-[11px] font-medium">{t("dw.situation")}</label>
              <input value={situationReport} onChange={e => setSituationReport(e.target.value)} className={field} style={{ backgroundColor: tk.bg, borderColor: tk.borderLight, color: tk.text }} />
            </div>
          </>)}

          {kind === "auto" && (
            <p className="text-[11px] leading-relaxed" style={{ color: tk.text }}>{t("dw.autoHint")}</p>
          )}
        </div>

        {/* 結果 */}
        {result && (
          <div className="mx-4 mb-2 rounded-lg p-2.5 text-xs whitespace-pre-wrap font-mono" style={{ backgroundColor: tk.bgMuted, border: `1px solid ${tk.borderLight}`, color: tk.text }}>{result}</div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t" style={{ borderColor: tk.borderLight }}>
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg border" style={{ borderColor: tk.borderLight, color: tk.text }}>{t("dw.cancel")}</button>
          <button onClick={submit} disabled={busy}
            className={cn("text-xs px-4 py-1.5 rounded-lg font-semibold", busy && "opacity-50")}
            style={{ backgroundColor: tk.accent, color: "#fff" }}>
            {busy ? "…" : `🚀 ${t("dw.go")}`}
          </button>
        </div>
      </div>
    </div>
  );
}
