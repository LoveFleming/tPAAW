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
  onPick: (dirPath: string) => void;
  rootPath: string;
  itemName: string;
}

/** Folder-only picker for moving files within Knowledge tree */
export default function MoveFolderPicker({
  open,
  onClose,
  onPick,
  rootPath,
  itemName,
}: Props) {
  const { info: t } = useTheme();
  const [currentPath, setCurrentPath] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [dirs, setDirs] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedDir, setSelectedDir] = useState<string | null>(null);

  const browse = useCallback((path: string) => {
    setLoading(true);
    setError("");
    setSelectedDir(null);
    fetch(`${API}/api/fs/browse?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setCurrentPath(data.currentPath);
        setParentPath(data.parent || null);
        setDirs(data.directories || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Initial load — start at knowledge root
  useEffect(() => {
    if (open && rootPath) {
      browse(rootPath);
      setSelectedDir(rootPath);
    }
  }, [open, rootPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && selectedDir) {
        onPick(selectedDir);
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, onPick, selectedDir]);

  if (!open) return null;

  const currentDirName = currentPath.split(/[\\/]/).pop() || currentPath;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border flex flex-col"
        style={{
          borderColor: t.accentBorder,
          width: "min(520px, 92vw)",
          maxHeight: "78vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b shrink-0 rounded-t-2xl"
          style={{ borderColor: t.accentBorder, backgroundColor: t.accentBg }}
        >
          <h3 className="text-base font-bold" style={{ color: t.accentText }}>
            📦 移動「{itemName}」到...
          </h3>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 text-lg leading-none cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Toolbar */}
        <div
          className="flex items-center gap-2 px-4 py-2 border-b shrink-0"
          style={{ borderColor: t.accentBorder + "40" }}
        >
          <button
            onClick={() => parentPath && browse(parentPath)}
            disabled={!parentPath || parentPath.length < rootPath.length}
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
            {currentDirName}
          </div>
        </div>

        {/* Folder list */}
        <div
          className="flex-1 overflow-y-auto min-h-[200px]"
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
          ) : dirs.filter(d => !d.name.startsWith(".")).length === 0 ? (
            <div className="text-center py-16 text-stone-400 text-sm">
              📭 沒有子資料夾
            </div>
          ) : (
            <div className="py-1">
              {/* Select current directory */}
              <button
                className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors cursor-pointer"
                style={{
                  backgroundColor: selectedDir === currentPath ? t.accentBg : undefined,
                }}
                onMouseEnter={(e) => {
                  if (selectedDir !== currentPath) e.currentTarget.style.backgroundColor = t.accentBg + "80";
                }}
                onMouseLeave={(e) => {
                  if (selectedDir !== currentPath) e.currentTarget.style.backgroundColor = "";
                }}
                onClick={() => setSelectedDir(currentPath)}
              >
                <span className="text-base">✅</span>
                <span
                  className="truncate font-medium"
                  style={{ color: selectedDir === currentPath ? t.accent : "#44403c" }}
                >
                  目前目錄（{currentDirName}）
                </span>
              </button>

              {/* Subdirectories */}
              {dirs.filter(d => !d.name.startsWith(".")).map((d) => {
                const isSelected = selectedDir === d.path;
                return (
                  <button
                    key={d.path}
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
                    onClick={() => setSelectedDir(d.path)}
                    onDoubleClick={() => browse(d.path)}
                  >
                    <span className="text-base">📁</span>
                    <span
                      className="truncate"
                      style={{
                        color: isSelected ? t.accent : "#44403c",
                        fontWeight: isSelected ? 500 : 400,
                      }}
                    >
                      {d.name}
                    </span>
                    <span className="ml-auto text-stone-300 text-xs" title="雙擊進入">→</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-5 py-3 border-t shrink-0 rounded-b-2xl"
          style={{ borderColor: t.accentBorder + "60", backgroundColor: t.accentBg + "40" }}
        >
          <span className="text-[10px] text-stone-400 truncate max-w-[55%]">
            {selectedDir ? `📁 ${selectedDir.split(/[\\/]/).pop()}` : "請選擇目標資料夾"}
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
              onClick={() => {
                if (selectedDir) {
                  onPick(selectedDir);
                  onClose();
                }
              }}
              disabled={!selectedDir}
              className="px-5 py-2 text-sm font-bold text-white rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ backgroundColor: t.accent }}
            >
              移動到這裡
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
