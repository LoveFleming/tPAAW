/**
 * ColResizer — 左右面板 splitter（共用元件）
 * 2026-10-09 Fleming：side chat 左右可拖曳調整寬度（跟 QA Browser 同款）。
 *
 * 用法：
 *   const chatPane = useColResize(340, 260, 640);
 *   <ColResizer onDown={chatPane.startDrag} className="hidden md:block" />
 *   <div className="shrink-0" style={{ width: chatPane.width }}>…</div>
 *
 * 拖曳方向約定：本元件放在「右側面板」的左緣 — 游標往左拖 → 面板變寬。
 */

import { useCallback, useRef, useState } from "react";
import { useI18n } from "../i18n";

export function useColResize(initial: number, min: number, max: number) {
  const [width, setWidth] = useState(initial);
  const widthRef = useRef(initial);
  widthRef.current = width;

  const startDrag = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;
    const onMove = (ev: PointerEvent) => {
      // 右側面板：游標往左移（dx 負）→ 面板變寬
      const next = Math.min(max, Math.max(min, startW + (startX - ev.clientX)));
      widthRef.current = next;
      setWidth(next);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [min, max]);

  return { width, startDrag };
}

export function ColResizer({ onDown, className = "" }: {
  onDown: (e: React.PointerEvent) => void;
  className?: string; // 帶 breakpoints（如 hidden md:block — 跟 side chat 同步顯隱）
}) {
  const { t } = useI18n();
  return (
    <div
      onPointerDown={onDown}
      title={t("sideChat.resize")}
      className={`shrink-0 w-1.5 cursor-col-resize relative group hover:bg-stone-300/40 active:bg-stone-400/50 transition-colors ${className}`}
      style={{ zIndex: 10 }}
    >
      {/* 加寬 hit area，好抓 */}
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  );
}
