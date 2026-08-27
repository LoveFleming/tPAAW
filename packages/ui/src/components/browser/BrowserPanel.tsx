/**
 * BrowserPanel — 內建瀏覽器面板（IDE Browser tab）
 *
 * 顯示 agent 目前操作的頁面：狀態列（URL/title）+ 最新截圖。
 * 資料來源：GET /api/browser/status + /api/browser/screenshot
 * 對標 Claude Cowork 內建瀏覽器（2026-08-26）：human 即時旁觀 agent 瀏覽。
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

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header：狀態列 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 text-xs">
        <span className={connected ? "text-green-600" : "text-red-500"}>●</span>
        <span className="text-gray-500">{t("browser.title")}</span>
        {status?.url && (
          <span className="ml-2 truncate max-w-[50%] text-gray-700 font-mono" title={status.url}>
            {status.title ? `${status.title} — ` : ""}{status.url}
          </span>
        )}
        {status?.lastActionAt && (
          <span className="ml-auto text-gray-400">
            {t("browser.lastAction")}: {new Date(status.lastActionAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Playwright 未安裝 */}
      {status?.available === false && (
        <div className="m-4 p-3 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800 whitespace-pre-wrap font-mono">
          <div className="font-semibold mb-1">{t("browser.notInstalled")}</div>
          {status.installHint}
        </div>
      )}

      {/* 截圖 */}
      <div className="flex-1 overflow-auto flex items-start justify-center p-4 bg-gray-50">
        {shotTs ? (
          <img
            key={shotTs}
            src={`${API_BASE}/api/browser/screenshot?t=${shotTs}`}
            alt="browser screenshot"
            className="max-w-full shadow-md border border-gray-200 rounded"
            style={{ imageRendering: "auto" }}
          />
        ) : (
          <div className="text-center text-gray-400 text-sm mt-16">
            <div className="text-4xl mb-3">🌐</div>
            {t("browser.empty")}
          </div>
        )}
      </div>
    </div>
  );
}

export default BrowserPanel;
