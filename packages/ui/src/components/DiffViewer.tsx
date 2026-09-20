/**
 * GitHub-style Diff Viewer
 * Parses unified diff text and renders colored, file-grouped diff.
 */

import { useMemo, useState } from "react";

// ── Types ──
interface DiffFile {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
}

interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

interface DiffLine {
  type: "add" | "del" | "context" | "hunk-header";
  oldLine?: number;
  newLine?: number;
  content: string;
}

// ── Parser ──
function parseUnifiedDiff(diffText: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = diffText.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // File header
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const oldPath = match ? match[1] : "?";
      const newPath = match ? match[2] : "?";

      const file: DiffFile = { oldPath, newPath, hunks: [] };
      i++;

      // Skip index/old/new file lines
      while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff --git ")) {
        i++;
      }

      // Parse hunks
      while (i < lines.length && (lines[i].startsWith("@@") || !lines[i].startsWith("diff --git "))) {
        if (lines[i].startsWith("@@")) {
          const hunkMatch = lines[i].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
          const hunk: DiffHunk = {
            header: lines[i],
            oldStart: hunkMatch ? parseInt(hunkMatch[1]) : 0,
            oldCount: hunkMatch ? parseInt(hunkMatch[2] || "1") : 0,
            newStart: hunkMatch ? parseInt(hunkMatch[3]) : 0,
            newCount: hunkMatch ? parseInt(hunkMatch[4] || "1") : 0,
            lines: [],
          };
          i++;

          let oldLine = hunk.oldStart;
          let newLine = hunk.newStart;

          while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff --git ")) {
            const hl = lines[i];
            if (hl.startsWith("+")) {
              hunk.lines.push({ type: "add", newLine: newLine++, content: hl.slice(1) });
            } else if (hl.startsWith("-")) {
              hunk.lines.push({ type: "del", oldLine: oldLine++, content: hl.slice(1) });
            } else if (hl.startsWith("\\") || hl === "") {
              // "\ No newline at end of file" or empty line
              if (hl === "") {
                hunk.lines.push({ type: "context", oldLine: oldLine++, newLine: newLine++, content: "" });
              }
              // skip "\ No newline..." 
            } else {
              hunk.lines.push({ type: "context", oldLine: oldLine++, newLine: newLine++, content: hl.startsWith(" ") ? hl.slice(1) : hl });
            }
            i++;
          }
          file.hunks.push(hunk);
        } else {
          break;
        }
      }
      files.push(file);
    } else {
      i++;
    }
  }

  return files;
}

// ── Component ──
export function DiffViewer({ diffText, theme }: { diffText: string; theme?: "light" | "dark" }) {
  const files = useMemo(() => parseUnifiedDiff(diffText), [diffText]);
  const dark = theme === "dark";

  if (files.length === 0) {
    return <div className="flex items-center justify-center h-full text-xs text-stone-400">No changes</div>;
  }

  const colors = {
    bg: dark ? "#1a1a1a" : "#ffffff",
    headerBg: dark ? "#2d333b" : "#f6f8fa",
    headerText: dark ? "#adbac7" : "#24292f",
    addBg: dark ? "#1a3a1a" : "#e6ffec",
    addText: dark ? "#7ee787" : "#1a7f37",
    delBg: dark ? "#3a1a1a" : "#ffebe9",
    delText: dark ? "#ffa198" : "#cf222e",
    contextBg: dark ? "transparent" : "transparent",
    contextText: dark ? "#adbac7" : "#24292f",
    lineNumberBg: dark ? "#22272e" : "#f6f8fa",
    lineNumberText: dark ? "#636c76" : "#8c959f",
    hunkBg: dark ? "#1c2128" : "#ddf4ff",
    border: dark ? "#30363d" : "#d0d7de",
    fileBorder: dark ? "#30363d" : "#d0d7de",
  };

  // 2026-09-20：檔案數上限 — 整包 diff（working/staged）檔案太多時也會撐爆 DOM
  const MAX_FILES = 30;
  const shownFiles = files.length > MAX_FILES ? files.slice(0, MAX_FILES) : files;

  return (
    <div className="overflow-x-auto" style={{ fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace", fontSize: "12px", lineHeight: "20px" }}>
      {shownFiles.map((file, fi) => (
        <FileDiff key={fi} file={file} colors={colors} />
      ))}
      {files.length > MAX_FILES && (
        <div className="px-3 py-2 text-xs text-stone-500 bg-stone-50 text-center">
          ⋯ 另有 {files.length - MAX_FILES} 檔未顯示（共 {files.length} 檔；縮小 diff 範圍或逐檔查看）
        </div>
      )}
    </div>
  );
}

function FileDiff({ file, colors }: { file: DiffFile; colors: any }) {
  const [collapsed, setCollapsed] = useState(false);
  // 2026-09-20 Fleming：大 diff（數千行）全渲染 → DOM 爆量畫面凍結、push 按鈕按不到
  // 每檔超過 MAX_DIFF_ROWS 行先截斷，「顯示其餘」手動展開
  const [expanded, setExpanded] = useState(false);
  const MAX_DIFF_ROWS = 800;
  const totalLines = useMemo(() => file.hunks.reduce((s, h) => s + h.lines.length, 0), [file]);
  const isTruncated = !expanded && totalLines > MAX_DIFF_ROWS;
  const renderHunks = useMemo(() => {
    if (!isTruncated) return file.hunks.map(h => ({ header: h.header, lines: h.lines }));
    let budget = MAX_DIFF_ROWS;
    const out: { header: string; lines: DiffLine[] }[] = [];
    for (const h of file.hunks) {
      if (budget <= 0) break;
      const take = h.lines.slice(0, budget);
      budget -= take.length;
      out.push({ header: h.header, lines: take });
    }
    return out;
  }, [file, isTruncated]);
  const fileName = file.newPath !== "/dev/null" ? file.newPath : file.oldPath;
  const isDeleted = file.newPath === "/dev/null";
  const isAdded = file.oldPath === "/dev/null" || file.oldPath === "dev/null";

  const additions = file.hunks.reduce((sum, h) => sum + h.lines.filter(l => l.type === "add").length, 0);
  const deletions = file.hunks.reduce((sum, h) => sum + h.lines.filter(l => l.type === "del").length, 0);

  return (
    <div className="mb-3 rounded-lg overflow-hidden" style={{ border: `1px solid ${colors.fileBorder}` }}>
      {/* File header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
        style={{ backgroundColor: colors.headerBg }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span style={{ fontSize: "10px" }}>{collapsed ? "▶" : "▼"}</span>
        <span style={{ fontWeight: 600, color: colors.headerText, fontSize: "12px" }}>
          {fileName}
        </span>
        {isAdded && <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: colors.addBg, color: colors.addText }}>New</span>}
        {isDeleted && <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: colors.delBg, color: colors.delText }}>Deleted</span>}
        <span className="flex-1" />
        <span className="text-xs" style={{ color: colors.addText }}>+{additions}</span>
        <span className="text-xs" style={{ color: colors.delText }}>−{deletions}</span>
      </div>

      {/* Diff body */}
      {!collapsed && (
        <div style={{ backgroundColor: colors.bg }}>
          {renderHunks.map((hunk, hi) => (
            <div key={hi}>
              {/* Hunk header */}
              <div
                className="px-3 py-0.5 text-xs"
                style={{ backgroundColor: colors.hunkBg, color: colors.lineNumberText, borderBottom: `1px solid ${colors.border}` }}
              >
                {hunk.header}
              </div>
              {/* Lines */}
              {hunk.lines.map((line, li) => (
                <DiffLineRow key={li} line={line} colors={colors} />
              ))}
            </div>
          ))}
          {isTruncated && (
            <button
              onClick={() => setExpanded(true)}
              className="w-full px-3 py-2 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors text-center"
            >
              ⋯ 顯示其餘 {totalLines - MAX_DIFF_ROWS} 行（共 {totalLines} 行，全開可能卡）
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DiffLineRow({ line, colors }: { line: DiffLine; colors: any }) {
  let bg = colors.contextBg;
  let textColor = colors.contextText;
  let prefix = " ";
  if (line.type === "add") { bg = colors.addBg; textColor = colors.addText; prefix = "+"; }
  else if (line.type === "del") { bg = colors.delBg; textColor = colors.delText; prefix = "−"; }

  return (
    <div className="flex" style={{ backgroundColor: bg }}>
      {/* Old line number */}
      <div
        className="select-none text-right shrink-0"
        style={{ width: "45px", minWidth: "45px", color: colors.lineNumberText, backgroundColor: colors.lineNumberBg, padding: "0 8px", borderRight: `1px solid ${colors.border}` }}
      >
        {line.oldLine ?? ""}
      </div>
      {/* New line number */}
      <div
        className="select-none text-right shrink-0"
        style={{ width: "45px", minWidth: "45px", color: colors.lineNumberText, backgroundColor: colors.lineNumberBg, padding: "0 8px", borderRight: `1px solid ${colors.border}` }}
      >
        {line.newLine ?? ""}
      </div>
      {/* Prefix (+/-/space) */}
      <div className="select-none shrink-0" style={{ width: "20px", minWidth: "20px", textAlign: "center", color: textColor }}>
        {prefix}
      </div>
      {/* Content */}
      <div className="flex-1 px-1 whitespace-pre overflow-x-auto" style={{ color: textColor }}>
        {line.content || " "}
      </div>
    </div>
  );
}

export default DiffViewer;
// END
