import React, { useState, useEffect, useCallback, useRef } from "react";
import { useTheme } from "../theme";
import API from "../api";

interface FsEntry {
  name: string;
  path: string;
  type?: "dir" | "file";
}

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (path: string) => void;
  existingNames?: string[];
  title?: string;
}

/** File picker that can browse the entire filesystem (not just workspaces) */
export default function FileImportPicker({
  open,
  onClose,
  onPick,
  existingNames = [],
  title = "匯入檔案",
}: Props) {
  const { info: t } = useTheme();
  const [currentPath, setCurrentPath] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [dirs, setDirs] = useState<FsEntry[]>([]);
  const [files, setFiles] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [dupAction, setDupAction] = useState<"ask" | "overwrite" | "skip">("ask");
  const [manualInput, setManualInput] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const browse = useCallback((path: string) => {
    setLoading(true);
    setError("");
    setSelectedFile(null);
    fetch(`${API}/api/fs/browse-files?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setCurrentPath(data.currentPath);
        setParentPath(data.parent || null);
        setDirs(data.directories || []);
        setFiles(data.files || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Initial load — start at home
  useEffect(() => {
    if (open) browse("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && selectedFile) {
        const name = selectedFile.split(/[\\/]/).pop() || "";
        if (!existingNames.includes(name) || dupAction === "overwrite") {
          onPick(selectedFile);
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, onPick, selectedFile, existingNames, dupAction]);

  if (!open) return null;

  const selectedName = selectedFile?.split(/[\\/]/).pop() || "";
  const isDuplicate = selectedName && existingNames.includes(selectedName);
  const canConfirm = selectedFile && (!isDuplicate || dupAction === "overwrite");

  const handleConfirm = () => {
    if (!selectedFile || !canConfirm) return;
    if (isDuplicate && dupAction === "skip") { onClose(); return; }
    onPick(selectedFile);
    onClose();
  };

  const handleManualGo = () => {
    const p = manualInput.trim();
    if (p) {
      browse(p);
      setManualInput("");
      setShowManual(false);
    }
  };

  const filteredDirs = showHidden ? dirs : dirs;
  const filteredFiles = showHidden
    ? files
    : files.filter((f) => !f.name.startsWith("."));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border flex flex-col"
        style={{
          borderColor: t.accentBorder,
          width: "min(560px, 92vw)",
          maxHeight: "82vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b shrink-0 rounded-t-2xl"
          style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}
        >
          <h3 className="text-base font-bold" style={{ color: t.accentText }}>
            📄 {title}
          </h3>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 text-lg leading-none cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* ── Toolbar ── */}
        <div
          className="flex items-center gap-2 px-4 py-2 border-b shrink-0"
          style={{ borderColor: t.accentBorder + "40" }}
        >
          <button
            onClick={() => parentPath && browse(parentPath)}
            disabled={!parentPath}
            className="px-2.5 py-1.5 rounded-lg border text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ borderColor: t.accentBorder, color: t.accent }}
          >
            ↩
          </button>
          <div
            className="flex-1 text-sm font-mono text-stone-600 truncate px-3 py-1.5 rounded-lg border"
            style={{ borderColor: t.accentBorder + "60", backgroundColor: t.accentBg + "60" }}
            title={currentPath}
          >
            {currentPath}
          </div>
          <button
            onClick={() => setShowManual(!showManual)}
            className="px-2 py-1.5 rounded-lg border text-sm transition-colors"
            style={{ borderColor: t.accentBorder, color: t.accent + "99" }}
            title="手動輸入路徑"
          >
            ✎
          </button>
        </div>

        {/* ── Manual path input ── */}
        {showManual && (
          <div
            className="flex items-center gap-2 px-4 py-2 border-b shrink-0"
            style={{ borderColor: t.accentBorder + "40" }}
          >
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="/手動/輸入/路徑"
              className="flex-1 px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-1 font-mono"
              style={{ borderColor: t.accentBorder }}
              onKeyDown={(e) => { if (e.key === "Enter") handleManualGo(); }}
              autoFocus
            />
            <button
              onClick={handleManualGo}
              className="px-3 py-1.5 text-sm font-bold text-white rounded-lg"
              style={{ backgroundColor: t.accent }}
            >
              Go
            </button>
          </div>
        )}

        {/* ── File list ── */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto min-h-[240px]"
          style={{ scrollbarWidth: "thin" }}
        >
          {loading ? (
            <div className="flex items-center justify-center py-16 text-stone-400 text-sm gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading...
            </div>
          ) : error ? (
            <div className="text-center py-16 px-6">
              <div className="text-red-400 text-sm mb-2">❌ {error}</div>
              <button
                onClick={() => browse(currentPath)}
                className="text-sm px-3 py-1 rounded-lg border"
                style={{ borderColor: t.accentBorder, color: t.accent }}
              >
                重試
              </button>
            </div>
          ) : filteredDirs.length === 0 && filteredFiles.length === 0 ? (
            <div className="text-center py-16 text-stone-400 text-sm">
              📭 空目錄
            </div>
          ) : (
            <div className="py-1">
              {/* Directories */}
              {filteredDirs.map((d) => (
                <button
                  key={d.path}
                  className="w-full text-left px-4 py-2 text-sm flex items-center gap-2.5 transition-colors cursor-pointer hover:bg-stone-50"
                  onClick={() => browse(d.path)}
                  onDoubleClick={() => browse(d.path)}
                >
                  <span className="text-base">📁</span>
                  <span className="text-stone-700 truncate">{d.name}</span>
                </button>
              ))}
              {/* Files */}
              {filteredFiles.map((f) => {
                const isSelected = selectedFile === f.path;
                return (
                  <button
                    key={f.path}
                    className="w-full text-left px-4 py-2 text-sm flex items-center gap-2.5 transition-colors cursor-pointer"
                    style={{
                      backgroundColor: isSelected ? t.accentBg : undefined,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.backgroundColor = t.accentBg + "80";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.backgroundColor = "";
                    }}
                    onClick={() => setSelectedFile(f.path)}
                  >
                    <span className="text-base">{isSelected ? "📄" : "📄"}</span>
                    <span
                      className="truncate"
                      style={{
                        color: isSelected ? t.accent : "#44403c",
                        fontWeight: isSelected ? 500 : 400,
                      }}
                    >
                      {f.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Duplicate warning ── */}
        {isDuplicate && (
          <div className="px-4 py-2 border-t border-amber-200 bg-amber-50 shrink-0">
            <div className="flex items-center gap-2 text-xs text-amber-700">
              <span>⚠️</span>
              <span><b>{selectedName}</b> 已存在於 Knowledge</span>
            </div>
            <div className="flex gap-2 mt-1.5">
              <button
                onClick={() => setDupAction("overwrite")}
                className={`px-2.5 py-1 text-[10px] rounded font-medium ${dupAction === "overwrite" ? "bg-rose-500 text-white" : "bg-white border border-stone-300 text-stone-600"}`}
              >
                覆蓋
              </button>
              <button
                onClick={() => setDupAction("skip")}
                className={`px-2.5 py-1 text-[10px] rounded font-medium ${dupAction === "skip" ? "bg-stone-500 text-white" : "bg-white border border-stone-300 text-stone-600"}`}
              >
                取消匯入
              </button>
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div
          className="flex items-center justify-between px-5 py-3 border-t shrink-0 rounded-b-2xl"
          style={{ borderColor: t.accentBorder + "60", backgroundColor: t.accentBg + "40" }}
        >
          <span className="text-[10px] text-stone-400 truncate max-w-[55%]">
            {selectedFile ? `📄 ${selectedName}` : "請選擇檔案"}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg border transition-colors"
              style={{ borderColor: t.accentBorder, color: t.accentText }}
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="px-5 py-2 text-sm font-bold text-white rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ backgroundColor: t.accent }}
            >
              匯入檔案
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
