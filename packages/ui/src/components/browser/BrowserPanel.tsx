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
  scroll?: { top: number; max: number; h: number }; // document 層 scroll 狀態（UI 畫 scrollbar）
}

type Mode = "stream" | "iframe" | "shot";

interface DlgInfo { id: string; kind: string; message: string; defaultValue: string }
interface DlInfo { id: string; filename: string; state: string; path: string | null; ts: number }
interface SetupInfo {
  playwright: boolean;
  chrome: boolean;
  executablePath: string | null;
}

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
  // ── Cowork 級：dialog / 下載（無分頁 — Fleming：不需要分頁）──
  const [dlgList, setDlgList] = useState<DlgInfo[]>([]);
  const [dialogText, setDialogText] = useState("");
  const [downloads, setDownloads] = useState<DlInfo[]>([]);
  // ── 可選元件：偵測系統 Chrome / Chromium（channel: "chrome"，不載自帶 chromium）──
  const [setup, setSetup] = useState<SetupInfo | null>(null);
  const setupPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSetup = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/browser/setup`);
      const data = await res.json();
      if (data.ok) setSetup(data);
      return data as SetupInfo;
    } catch { return null; }
  }, [API_BASE]);

  // available===false 才偵測/輪詢（1s）；輪詢只是刷新狀態（不再有安裝流程）
  useEffect(() => {
    if (status?.available !== false) { setSetup(null); return; }
    fetchSetup();
    setupPollRef.current = setInterval(fetchSetup, 1000);
    return () => { if (setupPollRef.current) clearInterval(setupPollRef.current); };
  }, [status?.available === false, fetchSetup]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // dialog/下載初始清單（SSE 只在 stream 模式收，其他模式靠這個 + 動作回應同步）
  useEffect(() => {
    fetch(`${API_BASE}/api/browser/downloads`).then(r => r.json()).then(d => { if (d.downloads) setDownloads(d.downloads.slice(0, 8)); }).catch(() => {});
  }, [API_BASE]);

  // ── 共用模式：SSE 串流（CDP screencast frames + dialog/download 事件）──
  useEffect(() => {
    if (mode !== "stream") { setLive(false); return; }
    const es = new EventSource(`${API_BASE}/api/browser/stream`);
    let opened = false;
    es.onopen = () => { opened = true; setLive(true); };
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === "hello") { if (!opened) setLive(true); }
        else if (d.type === "frame") {
          setFrame({ jpeg: d.jpeg, w: d.w, h: d.h, url: d.url, scroll: d.scroll });
          if (d.url && !typingRef.current && d.url !== lastShownUrlRef.current) {
            lastShownUrlRef.current = d.url;
            setUrlInput(d.url);
          }
        }
        else if (d.type === "dialog") {
          if (d.closed) setDlgList(prev => prev.filter(x => x.id !== d.id));
          else setDlgList(prev => [...prev.filter(x => x.id !== d.id), { id: d.id, kind: d.kind, message: d.message, defaultValue: d.defaultValue || "" }]);
        }
        else if (d.type === "download") {
          setDownloads(prev => [{ id: d.id, filename: d.filename, state: d.state, path: d.path ?? null, ts: d.ts }, ...prev.filter(x => x.id !== d.id)].slice(0, 8));
        }
      } catch { /* ignore malformed */ }
    };
    es.onerror = () => setLive(false); // EventSource 內建自動重連
    return () => { es.close(); setLive(false); };
  }, [API_BASE, mode]);

  // ── 共用模式：object-contain 完整顯示（含 scrollbar，不裁切畫面）──
  // （Fleming 2026-09-02：要能看到頁面 scrollbar，不能裁切）

  const sendInput = useCallback((payload: Record<string, unknown>) => {
    fetch(`${API_BASE}/api/browser/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => { /* best effort — 斷線由 SSE 狀態顯示 */ });
  }, [API_BASE]);

  // 畫面座標 → page CSS 座標（頁面填滿寬度、頂端對齊：scale = 容器寬/viewport 寬，無水平偏移）
  const toPageXY = (clientX: number, clientY: number) => {
    const f = frameRef.current;
    const el = overlayRef.current;
    if (!f || !el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || !f.w || !f.h) return null;
    const scale = r.width / f.w; // 寬度填滿 → scale（y 依同比例，頂端對齊 offsetY=0）
    return {
      x: Math.round((clientX - r.left) / scale),
      y: Math.round((clientY - r.top) / scale),
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
      const p = toPageXY(e.clientX, e.clientY);
      sendInput({ type: "wheel", x: p?.x ?? 640, y: p?.y ?? 400, deltaX: Math.round(e.deltaX), deltaY: Math.round(e.deltaY) });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [mode, sendInput, frame?.w, frame?.h]);

  const onCastKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 三層保護（Fleming 規則）：composition 中不轉發（compositionEnd 統一 insertText）
    if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
    const mod = e.ctrlKey || e.metaKey;
    const alt = e.altKey;
    // 本機剪貼簿 → 遠端貼上（headless 的系統剪貼簿跟本機不同，Ctrl+V 轉發無效）
    if (mod && (e.key === "v" || e.key === "V")) {
      e.preventDefault();
      navigator.clipboard.readText().then(txt => { if (txt) sendInput({ type: "text", text: txt.slice(0, 2000) }); }).catch(() => {});
      return;
    }
    // Ctrl+C：選取文字複製到遠端剪貼簿（配合 📋 取回本機）— 直接轉發組合鍵
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

  // 自訂 vertical scrollbar（headless overlay scrollbar 在串流圖裡看不見 — Fleming 要能看到捲軸）
  // thumb 依 document scroll 狀態繪製；點擊/拖動 → 送 wheel 回注
  const scrollDragRef = useRef<{ y: number; top: number } | null>(null);
  const scrollbarThumbSize = (s: CastFrame["scroll"] | undefined) => {
    if (!s || s.max <= 0) return 0;
    const ratio = s.h / (s.h + s.max);
    return Math.max(24, Math.round(ratio * 100)); // 至少 24px
  };
  const scrollToRatio = (ratio: number) => {
    const f = frameRef.current?.scroll;
    if (!f || f.max <= 0) return;
    const delta = Math.round(f.top - ratio * f.max); // 現在位置 → 目標位置（回注 wheel 差值）
    if (delta !== 0) sendInput({ type: "wheel", x: 640, y: 400, deltaX: 0, deltaY: delta });
  };
  const onScrollbarTrack = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const f = frameRef.current?.scroll;
    if (!f || !rect.height) return;
    const thumb = scrollbarThumbSize(f);
    const clickY = e.clientY - rect.top - thumb / 2;
    scrollToRatio(Math.min(1, Math.max(0, clickY / rect.height)));
  };
  const onScrollbarGrab = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const f = frameRef.current?.scroll;
    if (!f || f.max <= 0) return;
    const ratio = f.max > 0 ? f.top / f.max : 0;
    scrollDragRef.current = { y: e.clientY, top: ratio * rect.height };
    const onMove = (ev: MouseEvent) => {
      const s = scrollDragRef.current; if (!s) return;
      const trackH = rect.height;
      const newTop = Math.min(trackH, Math.max(0, s.top + (ev.clientY - s.y)));
      scrollToRatio(newTop / trackH);
    };
    const onUp = () => {
      scrollDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const dotOk = mode === "stream" ? live : connected;

  // ── 導航控制 ──
  const navAction = async (act: "back" | "forward" | "reload") => {
    try { await fetch(`${API_BASE}/api/browser/${act}`, { method: "POST" }); } catch {}
  };
  const respondDialog = async (id: string, action: "accept" | "dismiss") => {
    const text = dialogText;
    setDialogText("");
    try {
      await fetch(`${API_BASE}/api/browser/dialog`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, text: text || undefined }),
      });
    } catch {}
    setDlgList(prev => prev.filter(x => x.id !== id));
  };

  // 取回共享瀏覽器剪貼簿（GitHub copy 按鈕寫适的内容 → 本機剪貼簿）
  const [clipMsg, setClipMsg] = useState("");
  useEffect(() => {
    if (!clipMsg) return;
    const id = setTimeout(() => setClipMsg(""), 3500);
    return () => clearTimeout(id);
  }, [clipMsg]);
  const grabClipboard = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/browser/clipboard`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "fail");
      const text = String(d.text || "");
      if (!text) { setClipMsg(t("browser.clipboardEmpty")); return; }
      await navigator.clipboard.writeText(text);
      setClipMsg(t("browser.clipboardDone").replace("{n}", String(text.length)));
    } catch (err) {
      setClipMsg(t("browser.clipboardFail"));
    }
  };

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
        {/* 導航控制：← → ⟳（Cowork 級）*/}
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={() => navAction("back")} title={t("browser.back")} className="text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded text-sm px-1.5 py-0.5">←</button>
          <button onClick={() => navAction("forward")} title={t("browser.forward")} className="text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded text-sm px-1.5 py-0.5">→</button>
          <button onClick={() => navAction("reload")} title={t("browser.reload")} className="text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded text-sm px-1.5 py-0.5">⟳</button>
        </div>
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
          <button
            onClick={grabClipboard}
            title={t("browser.clipboardGet")}
            className="text-xs px-2 py-1 rounded-full shrink-0 border bg-gray-100 border-gray-200 text-gray-600 hover:bg-gray-200 transition-colors"
          >📋</button>
          {clipMsg && <span className="text-[10px] text-emerald-600 truncate max-w-[140px]">{clipMsg}</span>}
        </div>
      </div>

      {/* ── 分頁列移除（Fleming：不需要分頁）── */}

      {/* 導航錯誤 — 只有出錯才佔一行 */}
      {navError && (
        <div className="px-3 py-0.5 text-[11px] text-red-500 border-b border-red-100 shrink-0 truncate" title={navError}>⚠ {navError}</div>
      )}

      {/* Playwright/系統 Chrome 未就緒（影響共用/截圖模式；iframe 模式照用）— 指引卡，不再有一鍵安裝 */}
      {status?.available === false && mode !== "iframe" && (
        <div className="m-2 p-3 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800">
          <div className="font-semibold mb-2">{t("browser.notInstalled")}</div>
          {!setup ? (
            <div className="text-amber-600">{t("browser.setup.checking")}</div>
          ) : !setup.playwright ? (
            <div className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{status.installHint}</div>
          ) : setup.chrome ? (
            <div className="flex items-center gap-2">
              <span className="text-amber-600">{t("browser.setup.done")}</span>
              <button onClick={fetchSetup}
                className="ml-auto px-2 py-0.5 rounded border border-amber-300 hover:bg-amber-100 text-amber-700 select-none">
                ↻ {t("browser.setup.recheck")}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="text-amber-600">{t("browser.setup.needChrome")}</div>
              <details className="text-[11px]">
                <summary className="cursor-pointer text-amber-600 select-none">{t("browser.setup.manual")}</summary>
                <div className="whitespace-pre-wrap font-mono mt-1 leading-relaxed">{status.installHint}</div>
              </details>
              <button onClick={fetchSetup}
                className="self-start px-2.5 py-1 rounded border border-amber-300 hover:bg-amber-100 text-amber-700 select-none">
                ↻ {t("browser.setup.recheck")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── 主區 ── */}
      <div className="relative flex-1 min-h-0 overflow-hidden flex items-center justify-center bg-white">
        {/* dialog 卡（alert/confirm/prompt — 遠端頁面彈窗，等人在此回應）*/}
        {dlgList.length > 0 && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-[380px] max-w-[90%] p-4">
              <div className="text-sm font-semibold mb-2">{dlgList[0].kind === "prompt" ? "🤔" : dlgList[0].kind === "confirm" ? "❓" : "ℹ️"} {dlgList[0].kind}</div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap mb-3 break-all">{dlgList[0].message}</div>
              {dlgList[0].kind === "prompt" && (
                <input value={dialogText} onChange={e => setDialogText(e.target.value)} placeholder={t("browser.dialogPrompt")} autoFocus
                  className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-gray-300 focus:border-blue-400 outline-none mb-3" />
              )}
              <div className="flex justify-end gap-2">
                {dlgList[0].kind !== "alert" && (
                  <button onClick={() => respondDialog(dlgList[0].id, "dismiss")} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200">{t("browser.dialogCancel")}</button>
                )}
                <button onClick={() => respondDialog(dlgList[0].id, "accept")} className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white">{t("browser.dialogOk")}</button>
              </div>
            </div>
          </div>
        )}
        {/* 下載列（右下角 — 完成可複製路徑）*/}
        {downloads.length > 0 && (
          <div className="absolute bottom-2 right-2 flex flex-col gap-1 max-w-[260px] z-20">
            {downloads.map(dl => (
              <div key={dl.id} className="px-2.5 py-1.5 rounded-lg bg-gray-900/90 text-white text-[11px] shadow-lg flex items-center gap-2">
                <span className="shrink-0">{dl.state === "done" ? "✅" : dl.state === "failed" ? "❌" : "⏬"}</span>
                <span className="truncate flex-1" title={dl.path || dl.filename}>{dl.filename}</span>
                {dl.state === "done" && dl.path && (
                  <button onClick={() => navigator.clipboard?.writeText(dl.path!).catch(() => {})} title={dl.path} className="opacity-60 hover:opacity-100 shrink-0">📄</button>
                )}
                <button onClick={() => setDownloads(prev => prev.filter(x => x.id !== dl.id))} className="opacity-60 hover:opacity-100 shrink-0">×</button>
              </div>
            ))}
          </div>
        )}
        {mode === "stream" ? (
          <div ref={stageRef} className="w-full h-full bg-gray-900 relative overflow-hidden">
          {frame ? (
              <div className="absolute inset-0 overflow-hidden bg-white">
                {/* 頁面填滿寬度、頂端對齊（w-full h-auto 依寬度等比，底部超出靠捲軸捲）→ 無上下黑塊 */}
                <img
                  src={`data:image/jpeg;base64,${frame.jpeg}`}
                  alt="shared browser"
                  draggable={false}
                  className="absolute top-0 left-0 w-full h-auto select-none pointer-events-none"
                />
                {/* 透明輸入層：收滑鼠/滾輪/鍵盤（含 IME）→ 回注 agent browser（蓋滿整個面板）*/}
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
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 text-white text-[11px] pointer-events-none whitespace-nowrap z-10">
                    ⌨ {t("browser.focusHint")}
                  </div>
                )}
                {/* 自訂 vertical scrollbar（headless 圖裡看不見捲軸 → 疊一層）：可拖動/點擊回注 */}
                {frame.scroll && frame.scroll.max > 0 && (
                  <div
                    onMouseDown={onScrollbarTrack}
                    onDragStart={e => e.preventDefault()}
                    className="absolute top-0 right-0 h-full w-3.5 z-20 cursor-pointer select-none"
                    title={t("browser.scrollbar")}
                  >
                    <div
                      onMouseDown={onScrollbarGrab}
                      className="absolute right-0.5 w-2 rounded-full bg-white/70 hover:bg-white/90 border border-black/20"
                      style={{
                        top: `${(frame.scroll.max > 0 ? (frame.scroll.top / frame.scroll.max) : 0) * 100}%`,
                        height: `${scrollbarThumbSize(frame.scroll)}px`,
                        transition: "top 60ms linear",
                      }}
                    />
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
