/**
 * Starter Kits 設定頁面 — REQ-STARTER-KIT-001（2026-10-31 Fleming）
 *
 * 匯入 starter kit（tar.gz 上傳）→ coding app 新建專案可選用。
 * 設計：kit 檔存 <data>/starter-kits/<id>/kit.tar.gz + kit.json metadata。
 */
import { useState, useEffect, useCallback } from "react";
import API_BASE from "../api";
import { uiConfirm } from "../components/ui/uiFeedback";

interface Kit {
  id: string;
  name: string;
  language: string | null;
  description: string | null;
  createdAt: string;
  fileCount: number;
  hasAdapt: boolean;
}

export default function StarterKitsSettings() {
  const [kits, setKits] = useState<Kit[]>([]);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [adaptContent, setAdaptContent] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`${API_BASE}/api/starter-kits`).then(r => r.json()).then(d => setKits(d.kits || [])).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const upload = async () => {
    setError(""); setOk("");
    if (!name.trim() || !file) { setError("請填名稱並選擇 tar.gz 檔"); return; }
    if (!/\.(tar\.gz|tgz)$/i.test(file.name)) { setError("只支援 .tar.gz / .tgz（Linux/macOS 格式）"); return; }
    setUploading(true);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      const r = await fetch(`${API_BASE}/api/starter-kits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), language: language.trim(), description: description.trim(), fileBase64: b64 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
      setOk(`✅ 已匯入「${d.kit.name}」（${d.kit.fileCount} 檔${d.kit.hasAdapt ? "，含 KIT-ADAPT.md" : ""}）— coding app 新建專案即可選用`);
      setName(""); setLanguage(""); setDescription(""); setFile(null);
      (document.getElementById("kit-file-input") as HTMLInputElement | null)?.value && ((document.getElementById("kit-file-input") as HTMLInputElement).value = "");
      load();
    } catch (e: any) {
      setError(e.message || "上傳失敗");
    }
    setUploading(false);
  };

  const remove = async (id: string, kname: string) => {
    if (!(await uiConfirm(`刪除 kit「${kname}」？已用它建立的專案不受影響。`))) return;
    await fetch(`${API_BASE}/api/starter-kits/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (expanded === id) { setExpanded(null); setFiles([]); setAdaptContent(null); }
    load();
  };

  const toggleFiles = async (id: string) => {
    if (expanded === id) { setExpanded(null); setFiles([]); setAdaptContent(null); return; }
    setExpanded(id); setFiles([]); setAdaptContent(null);
    const r = await fetch(`${API_BASE}/api/starter-kits/${encodeURIComponent(id)}/files`).then(x => x.json()).catch(() => null);
    if (r) { setFiles(r.files || []); setAdaptContent(r.adaptContent ?? null); }
  };

  return (
    <div className="max-w-3xl">
      <h2 className="text-lg font-bold text-stone-800 mb-1">📦 Starter Kit</h2>
      <p className="text-xs text-stone-500 mb-4">匯入專案版型（tar.gz）— 匯入後在 coding app「新建專案 → 選擇專案版型」出現。kit 根目錄可放 <code className="px-1 bg-stone-100 rounded">KIT-ADAPT.md</code> 給 AI 的改寫指引。</p>

      {/* 匯入表單 */}
      <div className="bg-white border border-stone-200 rounded-xl p-4 mb-5 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-stone-500 mb-1 block">Kit 名稱 *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Node API Skeleton" className="w-full text-sm px-3 py-2 border rounded-lg bg-stone-50 outline-none focus:border-emerald-400" />
          </div>
          <div>
            <label className="text-xs font-medium text-stone-500 mb-1 block">語言</label>
            <input value={language} onChange={e => setLanguage(e.target.value)} placeholder="node / python / go…" className="w-full text-sm px-3 py-2 border rounded-lg bg-stone-50 outline-none focus:border-emerald-400" />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-stone-500 mb-1 block">描述</label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Express + 基本專案結構的 API 起點" className="w-full text-sm px-3 py-2 border rounded-lg bg-stone-50 outline-none focus:border-emerald-400" />
        </div>
        <div>
          <label className="text-xs font-medium text-stone-500 mb-1 block">tar.gz 檔 *</label>
          <input id="kit-file-input" type="file" accept=".tar.gz,.tgz,application/gzip" onChange={e => setFile(e.target.files?.[0] || null)} className="text-sm" />
          <p className="text-[10px] text-stone-400 mt-1">只支援 gzip tar（Linux/macOS）；zip 請先 <code>tar -czf kit.tar.gz 目錄/</code></p>
        </div>
        {error && <div className="text-xs text-red-500 bg-red-50 rounded px-2 py-1.5">{error}</div>}
        {ok && <div className="text-xs text-emerald-600 bg-emerald-50 rounded px-2 py-1.5">{ok}</div>}
        <button onClick={upload} disabled={uploading} className="text-sm px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
          {uploading ? "匯入中…" : "📤 匯入 Kit"}
        </button>
      </div>

      {/* Kit 清單 */}
      {kits.length === 0 ? (
        <div className="text-sm text-stone-400 bg-stone-50 rounded-xl px-4 py-6 text-center">尚未匯入任何 kit</div>
      ) : (
        <div className="space-y-2">
          {kits.map(k => (
            <div key={k.id} className="bg-white border border-stone-200 rounded-lg">
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="text-lg">📦</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-stone-800">{k.name}</span>
                    {k.language && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">{k.language}</span>}
                    {k.hasAdapt && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">KIT-ADAPT</span>}
                  </div>
                  <p className="text-xs text-stone-500 truncate">{k.description || "（無描述）"} · {k.fileCount} 檔 · {new Date(k.createdAt).toLocaleString()}</p>
                </div>
                <button onClick={() => toggleFiles(k.id)} className="text-xs px-2 py-1 rounded bg-stone-100 hover:bg-stone-200 text-stone-600">{expanded === k.id ? "收起" : "內容"}</button>
                <button onClick={() => remove(k.id, k.name)} className="text-xs px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-600">刪除</button>
              </div>
              {expanded === k.id && (
                <div className="border-t border-stone-100 px-4 py-3 bg-stone-50/50">
                  <div className="text-xs font-mono text-stone-600 max-h-48 overflow-auto">{files.length ? files.map((f, i) => <div key={i}>{f}</div>) : "載入中…"}</div>
                  {adaptContent && (
                    <details className="mt-2">
                      <summary className="text-xs text-emerald-700 cursor-pointer">KIT-ADAPT.md 內容</summary>
                      <pre className="text-[11px] text-stone-600 whitespace-pre-wrap mt-1 max-h-60 overflow-auto">{adaptContent}</pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
