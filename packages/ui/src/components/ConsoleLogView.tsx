/**
 * ConsoleLogView — Terminal 頁 📜 Console 模式（2026-09-06 Fleming）
 *
 * 需求：程式寫好重啟不用人動手 — agent 負責重啟（bash 背景執行），
 * 人類在 Terminal 頁看 console log：
 *   - src="server" → PAAW server 自己的 stdout/stderr（paaw-server.mjs tee 落檔）
 *   - src="app"    → RU 專案 app 的 console（agent 重啟時重導向 .paaw/logs/app-console.log）
 *
 * 實作：HTTP 輪詢 /api/logs/console?offset=（1.5s），append 到 buffer，
 * 自動跟隨捲動（使用者往上捲則暫停跟隨）。
 */

import { useEffect, useRef, useState, useCallback } from "react";

const API_BASE = import.meta.env.VITE_PAAW_API_BASE || "";

interface ConsoleLogViewProps {
  src: "server" | "app";
  cwd?: string;
  active?: boolean;
}

export default function ConsoleLogView({ src, cwd, active = true }: ConsoleLogViewProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [missing, setMissing] = useState(false);
  const offsetRef = useRef(0);
  const bufRef = useRef<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const poll = useCallback(async () => {
    if (pausedRef.current) return;
    try {
      const params = new URLSearchParams({ src, offset: String(offsetRef.current) });
      if (src === "app" && cwd) params.set("cwd", cwd);
      const res = await fetch(`${API_BASE}/api/logs/console?${params}`);
      const data = await res.json();
      setMissing(!data.exists);
      if (data.exists && data.data) {
        offsetRef.current = data.nextOffset;
        bufRef.current = (bufRef.current + data.data).slice(-256 * 1024); // 前端 buffer 上限 256KB
        setLines(bufRef.current.split("\n"));
      }
    } catch {}
  }, [src, cwd]);

  useEffect(() => {
    if (!active) return;
    poll();
    const timer = setInterval(poll, 1500);
    return () => clearInterval(timer);
  }, [active, poll]);

  // 切換來源時重置
  useEffect(() => {
    offsetRef.current = 0;
    bufRef.current = "";
    setLines([]);
    setMissing(false);
  }, [src, cwd]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    if (stickBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="flex flex-col h-full bg-[#1e1717]">
      {/* 工具列 */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-white/10 shrink-0">
        <span className="text-[10px] text-stone-400 font-mono truncate">
          {src === "server" ? "PAAW server · data/logs/server-console.log" : cwd ? `${cwd.split(/[\\/]/).pop()}/.paaw/logs/app-console.log` : "app-console.log"}
        </span>
        <div className="flex-1" />
        {missing && (
          <span className="text-[10px] text-amber-400/80">
            {src === "app" ? "（尚無 app console — agent 重啟 app 後出現）" : ""}
          </span>
        )}
        <button
          onClick={() => setPaused(p => !p)}
          className={`text-[10px] px-1.5 py-0.5 rounded font-mono transition-colors ${paused ? "bg-amber-500/20 text-amber-300" : "text-stone-400 hover:text-stone-200"}`}
          title={paused ? "Resume" : "Pause follow"}
        >
          {paused ? "▶ resume" : "⏸ pause"}
        </button>
        <button
          onClick={() => { bufRef.current = ""; offsetRef.current = 0; setLines([]); }}
          className="text-[10px] px-1.5 py-0.5 rounded font-mono text-stone-400 hover:text-stone-200 transition-colors"
          title="Clear view（只清畫面，不動檔案）"
        >
          clear
        </button>
      </div>
      {/* log 內容 */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-[1.5] text-[#d4d4d4] whitespace-pre-wrap break-all"
      >
        {lines.length === 0 && !missing && <span className="text-stone-500">…</span>}
        {missing && lines.length === 0 && <span className="text-stone-500">（尚無 console 輸出）</span>}
        {lines.map((l, i) => (
          <div key={i} className={
            /error|Error|ERROR|✗|FAIL/i.test(l) ? "text-red-400" :
            /warn|WARN/i.test(l) ? "text-yellow-400" :
            /═══ PAAW server start/i.test(l) ? "text-cyan-400" : undefined
          }>{l || "\u00A0"}</div>
        ))}
      </div>
    </div>
  );
}
