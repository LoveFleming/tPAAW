/**
 * ConsoleLogView — app / server console 檢視器（2026-09-06）
 *
 * 資料：GET /api/logs/console?src=app|server&cwd=&offset=（既有的 offset 輪詢 API，首次接 UI）
 * 掛載：CodingIDE Terminal tab（📜 Console view）
 * app = log/app-console/<ru>/app-console-YYYY-MM-DD.log（agent 啟動的 app；讀最新一份）
 * server = data/logs/server-console.log（PAAW server 自己）
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useI18n } from "../i18n";
import API_BASE from "../api";

export default function ConsoleLogView({ cwd, theme: tk }: { cwd?: string; theme: any }) {
  const { t } = useI18n();
  const [src, setSrc] = useState<"app" | "server">("server");
  const [text, setText] = useState("");
  const [follow, setFollow] = useState(true);
  const offsetRef = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    offsetRef.current = 0;
    setText("");
  }, []);

  useEffect(() => {
    reset();
    let stop = false;
    let timer: any = null;

    const poll = async () => {
      if (stop) return;
      try {
        const q = new URLSearchParams({ src, offset: String(offsetRef.current) });
        if (src === "app" && cwd) q.set("cwd", cwd);
        const r = await fetch(`${API_BASE}/api/logs/console?${q}`);
        const d = await r.json();
        if (!stop && d?.exists && d.data) {
          offsetRef.current = d.nextOffset;
          setText((prev) => (prev + d.data).slice(-400_000)); // 上限 ~400KB 防 UI 爆
        }
      } catch {} finally {
        if (!stop) timer = setTimeout(poll, 3000);
      }
    };
    poll();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [src, cwd, reset]);

  useEffect(() => {
    if (follow && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [text, follow]);

  const btn = (active: boolean) => ({
    className: `text-xs px-2.5 py-1 rounded-lg font-medium transition-colors`,
    style: {
      backgroundColor: active ? "#8b5cf622" : "transparent",
      color: active ? "#8b5cf6" : "#a8a29e",
      border: `1px solid ${active ? "#8b5cf655" : "transparent"}`,
    },
  });

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 border-b" style={{ borderColor: tk.borderLight }}>
        <button {...btn(src === "server")} onClick={() => setSrc("server")}>🖥 {t("janitor.consoleServer")}</button>
        <button {...btn(src === "app")} onClick={() => setSrc("app")}>📦 {t("janitor.consoleApp")}</button>
        <div className="flex-1" />
        <button onClick={() => setFollow(!follow)} {...btn(follow)} title={t("janitor.followTip")}>
          {follow ? "⬇ following" : "⏸ paused"}
        </button>
        <button onClick={reset} className="text-xs px-2 py-1 rounded-lg" style={{ color: "#a8a29e" }}>↻</button>
      </div>
      <div ref={boxRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all"
        style={{ backgroundColor: "#0c0c0c", color: "#cccccc", scrollbarWidth: "thin" }}>
        {text || <span style={{ color: "#78716c" }}>（{src === "app" ? t("janitor.consoleAppEmpty") : "…"}）</span>}
      </div>
    </div>
  );
}
