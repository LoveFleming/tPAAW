/**
 * BrowserPanel — 內建瀏覽器面板（IDE Browser tab）
 *
 * 顯示 agent 目前操作的頁面：網址列（手動導航）+ 狀態 + 最新截圖。
 * 資料來源：GET /api/browser/status + /api/browser/screenshot + POST /api/browser/navigate
 * 對標 Claude Cowork 內建瀏覽器（2026-08-26）：human 可即時旁觀 agent 瀏覽，也可手動接管。
 */
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";

interface BrowserStatus {
  ready: boolean;
  available: boolean | null;
  error: string | null;
  url: string | null;
  title: string | null;
  lastActionAt: number | null;
  lastScreenshot: { path: string; ts: number } | null;
  installHint: string | null;
}

export function BrowserPanel({ API_BASE }: { API_BASE: string }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [navigating, setNavigating] = useState(false);
  const [navError, setNavError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/browser/status`);
        const data = await res.json();
        if (!alive) return;
        setStatus(data);
        setConnected(true);
      } catch {
        if (alive) setConnected(false);
      }
    };
    poll();
    timerRef.current = setInterval(poll, 2500);
    return () => { alive = false; if (timerRef.current) clearInterval(timerRef.current); };
  }, [API_BASE]);

  const shotTs = status?.lastScreenshot?.ts;

  // 網址列同步：agent 導航後，欄位跟著顯示目前 URL（使用者正在打字時不覆蓋）
  const typingRef = useRef(false);
  useEffect(() => {
    if (!typingRef.current && status?.url) setUrlInput(status.url);
  }, [status?.url]);

  const navigate = async () => {
    let target = urlInput.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) target = "https://" + target;
    setNavigating(true); setNavError(null);
    try {
      const res = await fetch(`${API_BASE}/api/browser/navigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
      });
      const data = await res.json();
      if (!res.ok) setNavError(data.error || `Error ${res.status}`);
      else setStatus(data);
    } catch (e: any) {
      setNavError(e.message);
    } finally {
      setNavigating(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white min-h-0">
      {/* ── 網址列（手動操作）— 唯一常駐 chrome ── */}
      <div className="flex items-center gap-1.5 px-1.5 py-1 border-b border-gray-200 shrink-0">
        <span className={connected ? "text-green-600 text-xs" : "text-red-500 text-xs"}>●</span>
        <input
          value={urlInput}
          onChange={e => { setUrlInput(e.target.value); }}
          onFocus={() => { typingRef.current = true; }}
          onBlur={() => { typingRef.current = false; }}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return; // IME 保護
            if (e.key === "Enter") { e.preventDefault(); navigate(); }
          }}
          placeholder={t("browser.urlPlaceholder")}
          className="flex-1 min-w-0 text-xs px-2.5 py-1 rounded-full bg-gray-100 focus:bg-white border border-transparent focus:border-blue-300 outline-none font-mono"
          spellCheck={false}
        />
        <button onClick={navigate} disabled={navigating || !urlInput.trim()}
          className="text-xs px-3 py-1 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-40 shrink-0">
          {navigating ? "…" : t("browser.go")}
        </button>
      </div>

      {/* 導航錯誤 — 只有出錯才佔一行 */}
      {navError && (
        <div className="px-3 py-0.5 text-[11px] text-red-500 border-b border-red-100 shrink-0 truncate" title={navError}>⚠ {navError}</div>
      )}

      {/* Playwright 未安裝 */}
      {status?.available === false && (
        <div className="m-2 p-2 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800 whitespace-pre-wrap font-mono">
          <div className="font-semibold mb-1">{t("browser.notInstalled")}</div>
          {status.installHint}
        </div>
      )}

      {/* ── 截圖：填滿主區 ── */}
      <div className="flex-1 min-h-0 overflow-hidden flex items-center justify-center bg-white">
        {shotTs ? (
          <img
            key={shotTs}
            src={`${API_BASE}/api/browser/screenshot?t=${shotTs}`}
            alt="browser screenshot"
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="text-center text-gray-400 text-sm leading-relaxed px-6">
            <div className="text-4xl mb-3">🧭</div>
            {t("browser.empty")}
          </div>
        )}
      </div>
    </div>
  );
}

export default BrowserPanel;
