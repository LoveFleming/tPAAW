/**
 * BrowserPanel — 內建瀏覽器面板（IDE Browser tab）
 *
 * 兩種模式：
 * - 🖱 互動模式（預設）：iframe 直接嵌入目標網頁 — 人可直接操作（點擊/輸入/捲動），
 *   本機 dev server（vite/express）皆可嵌入；少数網站擋 iframe（X-Frame-Options）時切截圖模式
 * - 📸 截圖模式：顯示 agent Playwright 瀏覽器的即時截圖 — 旁觀 AI 瀏覽
 *
 * 網址列：手動導航會同時（a）iframe 開啟給人操作（b）同步 agent 的 page（AI 可接手讀）
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
  const [interactive, setInteractive] = useState(true); // 預設互動模式
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingRef = useRef(false);
  const lastShownUrlRef = useRef<string | null>(null);

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

  // URL 同步：agent 導航 → 網址列 + iframe 跟著換（使用者正在打字時不覆蓋欄位）
  useEffect(() => {
    const u = status?.url;
    if (u && u !== lastShownUrlRef.current) {
      lastShownUrlRef.current = u;
      setIframeSrc(u);
      if (!typingRef.current) setUrlInput(u);
    }
  }, [status?.url]);

  const navigate = async () => {
    let target = urlInput.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) target = "https://" + target;
    setNavigating(true); setNavError(null);
    lastShownUrlRef.current = target;
    setIframeSrc(target); // 互動畫面立即開（不等後端）
    try {
      // 同步 agent 的 Playwright page（AI 接手時讀同一頁）；失敗不擋人的畫面
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
      {/* ── 網址列 — 唯一常駐 chrome ── */}
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
        {/* 模式切換：🖐 互動（iframe 可操作）／📸 截圖（agent 畫面） */}
        <button onClick={() => setInteractive(v => !v)}
          title={interactive ? t("browser.modeScreenshot") : t("browser.modeInteractive")}
          className={`text-xs px-2 py-1 rounded-full shrink-0 border ${interactive ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-gray-100 border-gray-200 text-gray-600"}`}>
          {interactive ? "🖐" : "📸"}
        </button>
      </div>

      {/* 導航錯誤 — 只有出錯才佔一行 */}
      {navError && (
        <div className="px-3 py-0.5 text-[11px] text-red-500 border-b border-red-100 shrink-0 truncate" title={navError}>⚠ {navError}</div>
      )}

      {/* Playwright 未安裝（只影響 agent 瀏覽/截圖模式，互動模式照用） */}
      {status?.available === false && !interactive && (
        <div className="m-2 p-2 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800 whitespace-pre-wrap font-mono">
          <div className="font-semibold mb-1">{t("browser.notInstalled")}</div>
          {status.installHint}
        </div>
      )}

      {/* ── 主區：互動模式（iframe 佔滿）或 截圖模式 ── */}
      <div className="flex-1 min-h-0 overflow-hidden flex items-center justify-center bg-white">
        {interactive ? (
          iframeSrc ? (
            <iframe
              key={iframeSrc}
              src={iframeSrc}
              className="w-full h-full border-0"
              title="browser"
            />
          ) : (
            <div className="text-center text-gray-400 text-sm leading-relaxed px-6">
              <div className="text-4xl mb-3">🧭</div>
              {t("browser.empty")}
            </div>
          )
        ) : (
          shotTs ? (
            <img
              key={shotTs}
              src={`${API_BASE}/api/browser/screenshot?t=${shotTs}`}
              alt="browser screenshot"
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="text-center text-gray-400 text-sm leading-relaxed px-6">
              <div className="text-4xl mb-3">📸</div>
              {t("browser.emptyShot")}
            </div>
          )
        )}
      </div>
    </div>
  );
}

export default BrowserPanel;
