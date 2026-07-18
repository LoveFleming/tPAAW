/**
 * DeveloperPanel — Developer (Marcus) Vibe Coding 面板
 *
 * 左側: Chat — 跟 Marcus 討論（不改碼）
 * 右側: Task 狀態 — Run / Abort / Rollback
 *
 * 流程: 聊天討論 → 確認 → 按「執行」→ Phase 0-4 → 完成/中斷/rollback
 */

import { useState, useEffect, useRef, useCallback } from "react";
import API_BASE from "../api";
import ModelSelector from "./ModelSelector";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  ts?: string;
  _thinking?: boolean;
}

interface TaskProgress {
  phase: string;
  turn?: number;
  status?: string;
  changedFiles?: string[];
}

interface TaskResult {
  status: "completed" | "failed" | "aborted";
  task: string;
  filesChanged: string[];
  buildPassed: boolean;
  testsPassed: boolean;
  commitHash?: string;
}

interface DeveloperPanelProps {
  rootPath: string;
  theme: {
    bg: string;
    bgMuted: string;
    borderLight: string;
    accent: string;
    accentBg: string;
    text: string;
    textMuted: string;
    hover: string;
  };
  model?: string;
  onModelChange?: (m: string) => void;
}

export default function DeveloperPanel({ rootPath, theme: tk, model, onModelChange }: DeveloperPanelProps) {
  // ── Chat state ──
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "👋 我是 Marcus，你的 Developer。先聊聊你想做什麼，討論好了再動手。",
      ts: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);

  // ── Task state ──
  const [taskRunning, setTaskRunning] = useState(false);
  const [taskInput, setTaskInput] = useState("");
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [taskResult, setTaskResult] = useState<TaskResult | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Auto scroll ──
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // ── Poll status while running ──
  useEffect(() => {
    if (!taskRunning) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/coding-developer/status`);
        const d = await res.json();
        if (!d.running && taskRunning) {
          setTaskRunning(false);
          if (d.lastResult) setTaskResult(d.lastResult);
          if (d.lastError) setError(d.lastError);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [taskRunning]);

  // ── Fetch snapshot ──
  useEffect(() => {
    fetch(`${API_BASE}/api/coding-developer/snapshot`)
      .then(r => r.json())
      .then(d => setSnapshot(d.snapshot))
      .catch(() => {});
  }, [taskRunning]);

  // ── Chat send (vibe discussion, no code changes) ──
  const sendChat = async () => {
    const text = input.trim();
    if (!text || chatLoading) return;
    setInput("");

    setMessages(prev => [...prev, { role: "user", content: text, ts: new Date().toISOString() }]);
    setChatLoading(true);

    // thinking bubble
    const thinkId = Date.now();
    setMessages(prev => [...prev, { role: "assistant", content: "💭...", ts: new Date().toISOString(), _thinking: true }]);

    try {
      // Use the a2a architect endpoint for chat (read-only discussion)
      const res = await fetch(`${API_BASE}/a2a/architect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "message/stream",
          params: {
            message: { role: "user", parts: [{ type: "text", text: `[Developer Chat] ${text}` }] },
            context: { cwd: rootPath },
            conversationHistory: messages.filter(m => !m._thinking).map(m => ({ role: m.role, content: m.content })),
            ...(model ? { metadata: { model } } : {}),
          },
          id: `dev-chat-${thinkId}`,
        }),
      });

      setMessages(prev => prev.filter(m => !m._thinking));

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let currentEvent = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) { currentEvent = line.slice(7).trim(); continue; }
          if (!line.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (currentEvent === "content" && d.content) {
              fullText = d.content;
              setMessages(prev => [...prev.filter(m => !m._thinking)]);
              setMessages(prev => [...prev, { role: "assistant", content: d.content, ts: new Date().toISOString() }]);
            } else if (currentEvent === "error" && d.error) {
              setMessages(prev => [...prev.filter(m => !m._thinking)]);
              setMessages(prev => [...prev, { role: "assistant", content: `❌ ${typeof d.error === "string" ? d.error : d.error.message || "error"}`, ts: new Date().toISOString() }]);
            } else if (d.result?.artifacts?.[0]?.parts?.[0]?.text) {
              fullText = d.result.artifacts[0].parts[0].text;
              setMessages(prev => [...prev.filter(m => !m._thinking)]);
              setMessages(prev => [...prev, { role: "assistant", content: fullText, ts: new Date().toISOString() }]);
            }
            currentEvent = "";
          } catch {}
        }
      }

      if (!fullText) {
        setMessages(prev => [...prev, { role: "assistant", content: "（沒有回應，請重試）", ts: new Date().toISOString() }]);
      }
    } catch (err: any) {
      setMessages(prev => prev.filter(m => !m._thinking));
      setMessages(prev => [...prev, { role: "assistant", content: `❌ 連線失敗: ${err.message}`, ts: new Date().toISOString() }]);
    } finally {
      setChatLoading(false);
    }
  };

  // ── Run task ──
  const runTask = async () => {
    const task = taskInput.trim();
    if (!task || taskRunning) return;

    setTaskRunning(true);
    setTaskResult(null);
    setError(null);
    setProgress({ phase: "starting", status: "initializing" });

    try {
      const res = await fetch(`${API_BASE}/api/coding-developer/run?path=${encodeURIComponent(rootPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, model, skipCommit: false }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) { currentEvent = line.slice(7).trim(); continue; }
          if (!line.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (currentEvent === "progress") {
              setProgress(d);
            } else if (currentEvent === "complete") {
              setTaskResult(d);
              setTaskRunning(false);
              // Update snapshot after completion
              fetch(`${API_BASE}/api/coding-developer/snapshot`).then(r => r.json()).then(s => setSnapshot(s.snapshot));
            } else if (currentEvent === "error") {
              setError(d.message || "Unknown error");
              setTaskRunning(false);
            }
            currentEvent = "";
          } catch {}
        }
      }
    } catch (err: any) {
      setError(err.message);
      setTaskRunning(false);
    }
  };

  // ── Abort ──
  const abortTask = async (withRollback: boolean) => {
    try {
      await fetch(`${API_BASE}/api/coding-developer/abort`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rollback: withRollback }),
      });
      setTaskRunning(false);
      if (withRollback) {
        setProgress(null);
        setTaskResult(null);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ── Standalone Rollback ──
  const doRollback = async () => {
    if (!snapshot) return;
    if (!confirm(`還原到 ${snapshot}？所有未提交的變更會消失。`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/coding-developer/rollback?path=${encodeURIComponent(rootPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json();
      if (d.rolledBack) {
        setTaskResult(null);
        setProgress(null);
        setMessages(prev => [...prev, { role: "system", content: `⏪ 已還原到 ${snapshot}`, ts: new Date().toISOString() }]);
      } else {
        setError(d.error || "Rollback failed");
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ── Send task from chat (pre-fill task input) ──
  const sendAsTask = (text: string) => {
    setTaskInput(text);
  };

  const phaseEmoji: Record<string, string> = {
    L1: "📋", plan: "🗺️", execute: "⚙️", verify: "🔍", "verify-retry": "🔄", handoff: "📦", starting: "⏳",
  };

  return (
    <div className="flex-1 flex min-w-0 min-h-0" style={{ background: tk.bg }}>
      {/* ── Left: Chat ── */}
      <div className="flex-1 flex flex-col min-w-0 border-r" style={{ borderColor: tk.borderLight }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
          <div className="flex items-center gap-2">
            <span className="text-lg">💻</span>
            <span className="font-bold text-sm" style={{ color: tk.text }}>Marcus · Developer</span>
          </div>
          {model && onModelChange && <ModelSelector feature="codingIDE" value={model} onChange={onModelChange} />}
        </div>

        {/* Chat messages */}
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-3" style={{ scrollbarWidth: "thin" }}>
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} mb-3`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                msg.role === "user" ? "bg-blue-500 text-white" :
                msg.role === "system" ? "bg-amber-100 text-amber-800 border border-amber-300" :
                "bg-stone-100 text-stone-800"
              }`} style={msg._thinking ? { opacity: 0.6 } : undefined}>
                {msg.content}
              </div>
            </div>
          ))}
          {chatLoading && messages[messages.length - 1]?._thinking && (
            <div className="flex justify-start mb-3">
              <div className="bg-stone-100 rounded-lg px-3 py-2 text-sm" style={{ opacity: 0.6 }}>💭 ...</div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t px-3 py-2 flex gap-2 items-end" style={{ borderColor: tk.borderLight, background: tk.bgMuted }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDown={e => {
              if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
            }}
            placeholder="跟 Marcus 聊聊..."
            rows={1}
            className="flex-1 rounded-lg border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1"
            style={{
              background: tk.bg, color: tk.text, borderColor: tk.borderLight,
            }}
          />
          <button
            onClick={sendChat}
            disabled={!input.trim() || chatLoading}
            className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
            style={{ background: tk.accent, color: "white" }}
          >
            送出
          </button>
        </div>
      </div>

      {/* ── Right: Task Panel ── */}
      <div className="w-[340px] flex flex-col" style={{ background: tk.bgMuted }}>
        {/* Task input */}
        <div className="p-3 border-b" style={{ borderColor: tk.borderLight }}>
          <div className="text-xs font-bold mb-2" style={{ color: tk.textMuted }}>任務</div>
          <textarea
            value={taskInput}
            onChange={e => setTaskInput(e.target.value)}
            placeholder="確定要做什麼，然後按執行..."
            rows={3}
            className="w-full rounded-lg border px-3 py-2 text-sm resize-none focus:outline-none"
            style={{ background: tk.bg, color: tk.text, borderColor: tk.borderLight }}
          />
          <button
            onClick={runTask}
            disabled={!taskInput.trim() || taskRunning}
            className="w-full mt-2 py-2 rounded-lg text-sm font-bold disabled:opacity-40 transition-colors"
            style={{ background: taskRunning ? tk.borderLight : tk.accent, color: "white" }}
          >
            {taskRunning ? "執行中..." : "▶ 執行"}
          </button>
        </div>

        {/* Progress */}
        {progress && (
          <div className="p-3 border-b" style={{ borderColor: tk.borderLight }}>
            <div className="text-xs font-bold mb-2" style={{ color: tk.textMuted }}>進度</div>
            <div className="flex items-center gap-2 text-sm" style={{ color: tk.text }}>
              <span className="text-base">{phaseEmoji[progress.phase] || "⏳"}</span>
              <span className="capitalize">{progress.phase}</span>
              {progress.turn && <span className="text-xs" style={{ color: tk.textMuted }}>· Turn {progress.turn}</span>}
            </div>
            {progress.status && <div className="text-xs mt-1" style={{ color: tk.textMuted }}>{progress.status}</div>}
            {progress.changedFiles && progress.changedFiles.length > 0 && (
              <div className="mt-2 space-y-1">
                {progress.changedFiles.map((f, i) => (
                  <div key={i} className="text-xs truncate" style={{ color: tk.text }}>📝 {f}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Controls */}
        {taskRunning && (
          <div className="p-3 border-b flex gap-2" style={{ borderColor: tk.borderLight }}>
            <button
              onClick={() => abortTask(false)}
              className="flex-1 py-2 rounded-lg text-xs font-bold border"
              style={{ borderColor: tk.borderLight, color: tk.text, background: tk.bg }}
            >
              ⏹ 中止
            </button>
            <button
              onClick={() => abortTask(true)}
              className="flex-1 py-2 rounded-lg text-xs font-bold"
              style={{ background: "#dc2626", color: "white" }}
            >
              ⏹⏪ 中止+還原
            </button>
          </div>
        )}

        {/* Result */}
        {taskResult && (
          <div className="p-3 border-b" style={{ borderColor: tk.borderLight }}>
            <div className="text-xs font-bold mb-2" style={{ color: tk.textMuted }}>結果</div>
            <div className={`text-sm font-bold ${taskResult.status === "completed" ? "text-green-600" : taskResult.status === "aborted" ? "text-amber-600" : "text-red-600"}`}>
              {taskResult.status === "completed" ? "✅" : taskResult.status === "aborted" ? "⏹" : "❌"} {taskResult.status}
            </div>
            {taskResult.filesChanged.length > 0 && (
              <div className="mt-2 space-y-1">
                {taskResult.filesChanged.map((f, i) => (
                  <div key={i} className="text-xs truncate" style={{ color: tk.text }}>📝 {f}</div>
                ))}
              </div>
            )}
            <div className="mt-2 text-xs space-y-1">
              <div style={{ color: taskResult.buildPassed ? "#16a34a" : "#dc2626" }}>Build: {taskResult.buildPassed ? "✅" : "❌"}</div>
              <div style={{ color: taskResult.testsPassed ? "#16a34a" : "#dc2626" }}>Tests: {taskResult.testsPassed ? "✅" : "❌"}</div>
              {taskResult.commitHash && <div style={{ color: tk.textMuted }}>Commit: {taskResult.commitHash}</div>}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 border-b" style={{ borderColor: tk.borderLight }}>
            <div className="text-xs text-red-600 bg-red-50 rounded-lg p-2">❌ {error}</div>
          </div>
        )}

        {/* Rollback */}
        {!taskRunning && snapshot && (
          <div className="p-3 border-b" style={{ borderColor: tk.borderLight }}>
            <div className="text-xs font-bold mb-1" style={{ color: tk.textMuted }}>Snapshot</div>
            <div className="text-xs font-mono mb-2" style={{ color: tk.textMuted }}>{snapshot}</div>
            <button
              onClick={doRollback}
              className="w-full py-2 rounded-lg text-xs font-bold border"
              style={{ borderColor: "#dc2626", color: "#dc2626", background: "transparent" }}
            >
              ⏪ Rollback 到 Snapshot
            </button>
          </div>
        )}

        <div className="flex-1" />
      </div>
    </div>
  );
}
