import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * SplitChatLayout — 功能頁標準布局（2026-09-26 Fleming 定調）：
 *   main area（佔滿）｜可拖曳 splitter｜右手邊 AI chat
 * - splitter 左右拖 → 自調 main/chat 視窗大小（280–760px 夾限）
 * - 寬度記在 localStorage（storageKey），下次打開保持
 * - chat 關閉時 main 自動佔滿
 */
export default function SplitChatLayout({ chat, chatOpen, storageKey, borderLight, children }: {
  chat: ReactNode;
  chatOpen: boolean;
  storageKey: string;
  borderLight: string;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem(storageKey));
      return Number.isFinite(v) && v >= 280 && v <= 760 ? v : 400;
    } catch { return 400; }
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const onMove = useCallback((e: PointerEvent) => {
    if (!draggingRef.current || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    setWidth(Math.min(760, Math.max(280, rect.right - e.clientX)));
  }, []);
  const onUp = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setWidth(w => { try { localStorage.setItem(storageKey, String(Math.round(w))); } catch {} return w; });
  }, [storageKey]);

  useEffect(() => {
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [onMove, onUp]);

  return (
    <div ref={rootRef} className="flex-1 flex min-h-0 min-w-0">
      {/* main area — 佔滿剩餘寬度 */}
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
      {/* chat 容器常駐（keep-alive，2026-09-28）：關閉只藏不卸 — 訊息/輸入狀態保留，重開不重掛 */}
      {/* splitter — 拖曳調整 chat 寬度 */}
      <div
        onPointerDown={() => {
          draggingRef.current = true;
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
        className={`shrink-0 cursor-col-resize transition-all${chatOpen ? " w-1 hover:w-1.5" : " hidden"}`}
        style={{ background: borderLight }}
      />
      {/* 右手邊 AI chat — 寬度自調 */}
      <div className={`shrink-0 flex flex-col min-h-0 min-w-0${chatOpen ? "" : " hidden"}`} style={chatOpen ? { width } : undefined}>
        {chat}
      </div>
    </div>
  );
}
