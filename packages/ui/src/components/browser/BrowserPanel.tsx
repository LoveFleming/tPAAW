/**
 * BrowserPanel — 內建瀏覽器面板（IDE Browser tab）— Cowork 級共用體驗
 *
 * 三種模式：
 * - 🔗 共用模式（預設）：CDP screencast 即時串流 agent 的 Playwright 瀏覽器畫面 +
 *   輸入回注（點擊/滾輪/鍵盤/IME 中文直接操作同一個 browser）— 人與 AI 共用，不受 X-Frame-Options 限制
 * - 🖱 互動模式：iframe 直接嵌入目標網頁（本機 dev server 延遲最低，但外站會被 X-Frame-Options 擋）
 * - 📸 截圖模式：顯示 agent 瀏覽器的最新截圖（純旁觀）
 *
 * 共用模式輸入安全（IME 三層保護，同 Fleming 規則）：
 * composingRef（可靠）→ isComposing（fallback）→ keyCode 229（legacy）；
 * 中文用 compositionEnd 的 insertText 回注，不經鍵盤佈局。
 */
import React, { useEffect, useRef, useState, useCallback } from "react";
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

interface CastFrame {
  jpeg: string; // base64
  w: number;    // viewport CSS 寬（座標換算基準）
  h: number;
  url: string;
}

type Mode = "stream" | "iframe" | "shot";

// 特殊鍵 → Playwright key name（其餘單字元鍵走 text 插入）
const KEY_MAP: Record<string, string> = {
  Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Escape: "Escape",
  ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", " ": " ",
};

export function BrowserPanel({ API_BASE }: { API_BASE: string }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [navigating, setNavigating] = useState(false);
  const [navError, setNavError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("stream"); // 預設共用模式（Cowork 級）
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [frame, setFrame] = useState<CastFrame | null>(null);
  const [live, setLive] = useState(false);
  const [kbdFocus, setKbdFocus] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingRef = useRef(false);
  const lastShownUrlRef = useRef<string | null>(null);
  const composingRef = useRef(false);       // IME composition（可靠層）
  const overlayRef = useRef<HTMLTextAreaElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const lastMoveRef = useRef(0);
  const frameRef = useRef<CastFrame | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null); // frame 顯示尺寸（letterbox 計算後）

  useEffect(() => { frameRef.current = frame; }, [frame]);

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

  // ── 共用模式：SSE 串流（CDP screencast frames）──
  useEffect(() => {
    if (mode !== "stream") { setLive(false); return; }
    const es = new EventSource(`${API_BASE}/api/browser/stream`);
    let opened = false;
    es.onopen = () => { opened = true; setLive(true); };
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === "hello") { if (!opened) setLive(true); }
        else if (d.type === "frame") setFrame({ jpeg: d.jpeg, w: d.w, h: d.h, url: d.url });
      } catch { /* ignore malformed */ }
    };
    es.onerror = () => setLive(false); // EventSource 內建自動重連
    return () => { es.close(); setLive(false); };
  }, [API_BASE, mode]);

  // ── 共用模式：顯示框尺寸（letterbox：等比縮放塞滿容器）──
  useEffect(() => {
    if (mode !== "stream" || !frame) return;
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const cw = el.clientWidth, ch = el.clientHeight;
      if (!cw || !ch || !frame.w || !frame.h) return;
      const s = Math.min(cw / frame.w, ch / frame.h);
      setBox({ w: Math.round(frame.w * s), h: Math.round(frame.h * s) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, frame?.w, frame?.h]);

  const sendInput = useCallback((payload: Record<string, unknown>) => {
    fetch(`${API_BASE}/api/browser/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => { /* best effort — 斷線由 SSE 狀態顯示 */ });
  }, [API_BASE]);

  // 畫面座標 → page CSS 座標（frame.w/h = viewport 實際大小）
  const toPageXY = (clientX: number, clientY: number) => {
    const f = frameRef.current;
    const el = overlayRef.current;
    if (!f || !el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return {
      x: Math.round(((clientX - r.left) / r.width) * f.w),
      y: Math.round(((clientY - r.top) / r.height) * f.h),
    };
  };

  const onCastMouseDown = (e: React.MouseEvent) => {
    overlayRef.current?.focus();
    const p = toPageXY(e.clientX, e.clientY);
    if (p) sendInput({
      type: "mousedown", x: p.x, y: p.y, button: e.button,
      modifiers: { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey },
    });
    e.preventDefault();
  };

  const onCastMouseUp = (e: React.MouseEvent) => {
    const p = toPageXY(e.clientX, e.clientY);
    if (p) sendInput({
      type: "mouseup", x: p.x, y: p.y, button: e.button,
      modifiers: { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey },
    });
    e.preventDefault();
  };

  const onCastMouseMove = (e: React.MouseEvent) => {
    const now = performance.now();
    if (now - lastMoveRef.current < 40) return; // hover 回注節流 ~25/s
    lastMoveRef.current = now;
    const p = toPageXY(e.clientX, e.clientY);
    if (p) sendInput({ type: "mousemove", x: p.x, y: p.y });
  };

  // 滾輪：React onWheel 綁 passive — 用原生 listener 才能 preventDefault
  useEffect(() => {
    if (mode !== "stream") return;
    const el = overlayRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      sendInput({ type: "wheel", deltaX: Math.round(e.deltaX), deltaY: Math.round(e.deltaY) });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [mode, sendInput, box?.w, box?.h]);

  const onCastKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 三層保護（Fleming 規則）：composition 中不轉發（compositionEnd 統一 insertText）
    if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
    const mod = e.ctrlKey || e.metaKey;
    const alt = e.altKey;
    const pwKey = KEY_MAP[e.key];
    if (pwKey !== undefined) {
      e.preventDefault();
      if (mod) sendInput({ type: "key", key: `Control+${pwKey.trim() || "Space"}` });
      else if (pwKey === " ") sendInput({ type: "text", text: " " });
      else sendInput({ type: "key", key: pwKey });
    } else if (e.key.length === 1) {
      e.preventDefault();
      if (mod) sendInput({ type: "key", key: `Control+${e.key.toLowerCase()}` });
      else if (alt) sendInput({ type: "key", key: `Alt+${e.key.toLowerCase()}` });
      else sendInput({ type: "text", text: e.key });
    }
    // F1-F12 / Shift 單獨按 → 忽略（v1）
  };

  const onCastCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    const text = e.data || "";
    if (text) sendInput({ type: "text", text });
    e.currentTarget.value = ""; // 清空隱形輸入框
  };

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

  const dotOk = mode === "stream" ? live : connected;

  const modeBtn = (m: Mode, icon: string, titleKey: string) => (
    <button
      key={m}
      onClick={() => setMode(m)}
      title={t(titleKey)}
      className={`text-xs px-2 py-1 rounded-full shrink-0 border transition-colors ${
        mode === m ? "bg-blue-600 border-blue-600 text-white" : "bg-gray-100 border-gray-200 text-gray-600 hover:bg-gray-200"
      }`}
    >{icon}</button>
  );

  return (
    <div className="h-full flex flex-col bg-white min-h-0">
      {/* ── 網址列 — 唯一常駐 chrome ── */}
      <div className="flex items-center gap-1.5 px-1.5 py-1 border-b border-gray-200 shrink-0">
        <span className={dotOk ? "text-green-600 text-xs" : "text-red-500 text-xs"}>●</span>
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
        {/* 模式切換：🔗 共用（串流+回注）／🖱 互動（iframe）／📸 截圖 */}
        <div className="flex items-center gap-0.5 shrink-0">
          {modeBtn("stream", "🔗", "browser.modeStream")}
          {modeBtn("iframe", "🖐", "browser.modeInteractive")}
          {modeBtn("shot", "📸", "browser.modeShot")}
        </div>
      </div>

      {/* 導航錯誤 — 只有出錯才佔一行 */}
      {navError && (
        <div className="px-3 py-0.5 text-[11px] text-red-500 border-b border-red-100 shrink-0 truncate" title={navError}>⚠ {navError}</div>
      )}

      {/* Playwright 未安裝（影響共用/截圖模式；iframe 模式照用） */}
      {status?.available === false && mode !== "iframe" && (
        <div className="m-2 p-2 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800 whitespace-pre-wrap font-mono">
          <div className="font-semibold mb-1">{t("browser.notInstalled")}</div>
          {status.installHint}
        </div>
      )}

      {/* ── 主區 ── */}
      <div className="flex-1 min-h-0 overflow-hidden flex items-center justify-center bg-white">
        {mode === "stream" ? (
          <div ref={stageRef} className="w-full h-full flex items-center justify-center bg-gray-900 relative overflow-hidden">
          {frame && box ? (
              <div className="relative shadow-2xl" style={{ width: box.w, height: box.h }}>
                <img
                  src={`data:image/jpeg;base64,${frame.jpeg}`}
                  alt="shared browser"
                  draggable={false}
                  className="absolute inset-0 w-full h-full select-none pointer-events-none"
                />
                {/* 透明輸入層：收滑鼠/滾輪/鍵盤（含 IME）→ 回注 agent browser */}
                <textarea
                  ref={overlayRef}
                  className="absolute inset-0 w-full h-full bg-transparent text-transparent caret-transparent resize-none outline-none border-0 p-0 m-0 overflow-hidden cursor-default select-none"
                  autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                  onMouseDown={onCastMouseDown}
                  onMouseUp={onCastMouseUp}
                  onMouseMove={onCastMouseMove}
                  onContextMenu={e => e.preventDefault()}
                  onKeyDown={onCastKeyDown}
                  onCompositionStart={() => { composingRef.current = true; }}
                  onCompositionEnd={onCastCompositionEnd}
                  onInput={e => { if (!composingRef.current) e.currentTarget.value = ""; }}
                  onFocus={() => setKbdFocus(true)}
                  onBlur={() => setKbdFocus(false)}
                />
                {/* 鍵盤焦點提示 — 沒焦點時浮現 */}
                {!kbdFocus && (
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 text-white text-[11px] pointer-events-none whitespace-nowrap">
                    ⌨ {t("browser.focusHint")}
                  </div>
                )}
              </div>
          ) : status?.available === false ? null : (
            <div className="text-center text-gray-400 text-sm leading-relaxed px-6">
              <div className="text-4xl mb-3">🔗</div>
              {t("browser.emptyStream")}
            </div>
          )}
          </div>
        ) : mode === "iframe" ? (
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
