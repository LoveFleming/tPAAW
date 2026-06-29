import React, { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "../theme";
import { fileEmoji } from "../components/FileEmoji";
import { pathBasename } from "../utils";
import API_BASE from "../api";

interface Props {
  filePath: string;
  active?: boolean;
}

type SaveState = "clean" | "saving" | "saved" | "error";

export default function FileEditor({ filePath, active }: Props) {
  const { info: t } = useTheme();
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("clean");
  const [error, setError] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContent = useRef("");

  const fileName = pathBasename(filePath);
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  // Load file content
  useEffect(() => {
    if (!filePath) return;
    if (active === false) return;
    setLoading(true);
    fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(filePath)}`)
      .then(r => r.json())
      .then(data => {
        const text = data.content ?? "";
        setContent(text);
        setOriginalContent(text);
        latestContent.current = text;
        setSaveState("clean");
        setError("");
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [filePath, active]);

  // Auto-save (debounced 800ms after last edit)
  const save = useCallback(async () => {
    const text = latestContent.current;
    if (text === originalContent) return;
    setSaveState("saving");
    try {
      const resp = await fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(filePath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setOriginalContent(text);
      setSaveState("saved");
      // Clear "saved" indicator after 2s
      setTimeout(() => setSaveState(prev => prev === "saved" ? "clean" : prev), 2000);
    } catch (e: any) {
      setSaveState("error");
      setError(e.message);
    }
  }, [filePath, originalContent]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setContent(text);
    latestContent.current = text;
    setSaveState("clean"); // dirty
    // Debounce auto-save
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(), 800);
  }, [save]);

  // Save on unmount / tab switch
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      // Fire-and-forget save if dirty
      if (latestContent.current !== originalContent) {
        fetch(`${API_BASE}/api/fs/file?path=${encodeURIComponent(filePath)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: latestContent.current }),
        }).catch(() => {});
      }
    };
  }, [filePath, originalContent]);

  // Save indicator
  const indicator = {
    clean: { label: "", color: "" },
    saving: { label: "💾 儲存中...", color: "#f59e0b" },
    saved: { label: "✅ 已儲存", color: "#10b981" },
    error: { label: "❌ 儲存失敗", color: "#ef4444" },
  }[saveState];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-stone-400 text-sm">
        <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading...
      </div>
    );
  }

  if (error && !content) {
    return (
      <div className="flex items-center justify-center h-full text-rose-400 text-sm">
        ❌ {error}
      </div>
    );
  }

  // Determine if markdown for slightly different styling
  const isMarkdown = ext === "md" || ext === "markdown";

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header */}
      <div
        className="px-4 py-1.5 border-b flex items-center justify-between shrink-0"
        style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs">{fileEmoji(ext)}</span>
          <span className="text-sm font-semibold truncate" style={{ color: t.accentText }}>
            ✏️ {fileName}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {indicator.label && (
            <span className="text-[11px] font-medium" style={{ color: indicator.color }}>
              {indicator.label}
            </span>
          )}
          <button
            onClick={() => save()}
            disabled={saveState === "saving" || content === originalContent}
            className="px-3 py-1 rounded-lg text-xs font-bold border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ borderColor: t.accentBorder, color: t.accent }}
            onMouseEnter={e => { if (content !== originalContent) { e.currentTarget.style.backgroundColor = t.accent; e.currentTarget.style.color = "white"; } }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = t.accent; }}
          >
            💾 Save
          </button>
        </div>
      </div>

      {/* Editor — auto-save textarea */}
      <div className="flex-1 overflow-hidden">
        <textarea
          value={content}
          onChange={handleChange}
          onBlur={() => {
            if (saveTimer.current) clearTimeout(saveTimer.current);
            save();
          }}
          onKeyDown={(e) => {
            // Tab support — insert spaces instead of switching focus
            if (e.key === "Tab") {
              e.preventDefault();
              const target = e.currentTarget;
              const start = target.selectionStart;
              const end = target.selectionEnd;
              const newValue = content.substring(0, start) + "  " + content.substring(end);
              setContent(newValue);
              latestContent.current = newValue;
              setSaveState("clean");
              if (saveTimer.current) clearTimeout(saveTimer.current);
              saveTimer.current = setTimeout(() => save(), 800);
              // Restore cursor position after state update
              requestAnimationFrame(() => {
                target.selectionStart = target.selectionEnd = start + 2;
              });
            }
            // Ctrl/Cmd+S — manual save
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
              e.preventDefault();
              if (saveTimer.current) clearTimeout(saveTimer.current);
              save();
            }
          }}
          spellCheck={false}
          className="w-full h-full p-4 font-mono text-sm resize-none outline-none border-0"
          style={{
            backgroundColor: "#1e1e1e",
            color: "#d4d4d4",
            lineHeight: 1.6,
            tabSize: 2,
            scrollbarWidth: "thin",
          }}
          placeholder="開始輸入內容..."
        />
      </div>
    </div>
  );
}
