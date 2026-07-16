/**
 * SecurityTab — Semgrep security scan results panel
 *
 * Top: Summary stats (severity breakdown + scan button)
 * Left: Finding list with severity filter
 * Right: Finding detail (code snippet, fix suggestion, references)
 */
import React, { useState, useEffect, useCallback } from "react";
import { cn } from "../utils";
import { useI18n } from "../i18n";
import API_BASE from "../api";

interface Finding {
  id: string;
  severity: string;
  confidence: string;
  category: string | string[];
  cwe: string[];
  message: string;
  file: string;
  line: number;
  column: number;
  endLine: number;
  snippet: string;
  fix: string | null;
  references: string[];
}

interface ScanStats {
  total: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  filesScanned: number;
  filesAffected: number;
  rulesRun: number;
  rulePacks: string[];
}

interface ScanResult {
  findings: Finding[];
  stats: ScanStats;
  error?: string;
}

interface Props {
  rootPath: string;
  theme: {
    bg: string;
    bgMuted: string;
    borderLight: string;
    accent: string;
    accentBg: string;
    text: string;
  };
  onOpenFile: (path: string) => void;
}

const SEVERITY_CONFIG: Record<string, { icon: string; color: string; bg: string; label: string }> = {
  ERROR:   { icon: "🔴", color: "#dc2626", bg: "#fef2f2", label: "Error" },
  WARNING: { icon: "🟡", color: "#d97706", bg: "#fffbeb", label: "Warning" },
  INFO:    { icon: "🔵", color: "#2563eb", bg: "#eff6ff", label: "Info" },
};

const SEVERITY_ORDER = ["ERROR", "WARNING", "INFO"];

export default function SecurityTab({ rootPath, theme, onOpenFile }: Props) {
  const { t } = useI18n();
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<string>("ALL");
  const [filterFile, setFilterFile] = useState<string>("");

  // Load last scan results on mount
  const loadResults = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotInstalled(false);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/security-scan/results?path=${encodeURIComponent(rootPath)}`);
      if (res.ok) {
        const data = await res.json();
        setScanResult(data);
      } else if (res.status === 404) {
        setScanResult(null);
      } else if (res.status === 503) {
        setNotInstalled(true);
      } else {
        setError(`HTTP ${res.status}`);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [rootPath]);

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  // Run new scan
  const [notInstalled, setNotInstalled] = useState(false);
  const [diagnostic, setDiagnostic] = useState<any | null>(null);
  const [loadingDiag, setLoadingDiag] = useState(false);
  const [showDiag, setShowDiag] = useState(false);
  // Load diagnostic info
  const loadDiagnostic = useCallback(async () => {
    setLoadingDiag(true);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/security-scan/diagnose?path=${encodeURIComponent(rootPath)}`);
      if (res.ok) {
        const data = await res.json();
        setDiagnostic(data);
        setShowDiag(true);
      }
    } catch (err) {
      console.error("Diagnostic failed:", err);
    } finally {
      setLoadingDiag(false);
    }
  }, [rootPath]);

  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setNotInstalled(false);
    try {
      const res = await fetch(`${API_BASE}/api/coding-project/security-scan?path=${encodeURIComponent(rootPath)}`);
      if (res.ok) {
        const data = await res.json();
        setScanResult(data);
        setSelectedFinding(null);
      } else if (res.status === 503) {
        setNotInstalled(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setScanning(false);
    }
  }, [rootPath]);

  const findings = scanResult?.findings || [];
  const stats = scanResult?.stats;

  // Filter findings
  const filteredFindings = findings.filter(f => {
    if (filterSeverity !== "ALL" && f.severity !== filterSeverity) return false;
    if (filterFile && !f.file.toLowerCase().includes(filterFile.toLowerCase())) return false;
    return true;
  });

  // Group by file
  const byFile: Record<string, Finding[]> = {};
  for (const f of filteredFindings) {
    if (!byFile[f.file]) byFile[f.file] = [];
    byFile[f.file].push(f);
  }
  const fileList = Object.keys(byFile).sort();

  const tk = theme;

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: tk.bg }}>
      {/* ── Header: Summary + Actions ── */}
      <div className="shrink-0 px-4 py-2 flex items-center gap-3" style={{ borderBottom: `1px solid ${tk.borderLight}`, backgroundColor: tk.bgMuted }}>
        <span className="text-sm font-bold" style={{ color: tk.text }}>🔒 Security Scan</span>

        {stats && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-stone-500">{stats.total} findings</span>
            {SEVERITY_ORDER.filter(s => stats.bySeverity[s]).map(s => (
              <span key={s} className="px-1.5 py-0.5 rounded-full text-xs font-semibold"
                style={{ backgroundColor: SEVERITY_CONFIG[s]?.bg, color: SEVERITY_CONFIG[s]?.color }}>
                {SEVERITY_CONFIG[s]?.icon} {stats.bySeverity[s]}
              </span>
            ))}
            <span className="text-stone-400">·</span>
            <span className="text-stone-400">{stats.filesAffected || 0} files</span>
            <span className="text-stone-400">·</span>
            <span className="text-stone-400">{stats.rulesRun} rules</span>
          </div>
        )}

        <span className="flex-1" />

          <button
            onClick={loadDiagnostic}
            disabled={loadingDiag}
            className={cn("text-xs px-3 py-1 rounded font-semibold transition-colors",
              loadingDiag ? "bg-stone-200 text-stone-400 cursor-wait" : "bg-amber-500 text-white hover:bg-amber-600")}
          >
            {loadingDiag ? "⏳..." : "🔧 Diagnose"}
          </button>
          <button
            onClick={runScan}
            disabled={scanning}
            className={cn("text-xs px-3 py-1 rounded font-semibold transition-colors",
              scanning ? "bg-stone-200 text-stone-400 cursor-wait" : "bg-blue-500 text-white hover:bg-blue-600")}
          >
            {scanning ? "⏳ Scanning..." : "🔄 Run Scan"}
          </button>
      </div>

      {/* ── Diagnostic Panel ── */}
      {showDiag && diagnostic && (
        <div className="shrink-0 border-b" style={{ borderColor: tk.borderLight, backgroundColor: "#fffbeb" }}>
          <div className="px-4 py-2 flex items-center gap-2">
            <span className="text-sm font-bold text-amber-700">🔧 Security Scan 診斷</span>
            <span className={cn("text-xs px-2 py-0.5 rounded-full font-bold",
              diagnostic.available ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
              {diagnostic.available ? "✅ Semgrep 可用" : "❌ Semgrep 不可用"}
            </span>
            <span className="flex-1" />
            <button onClick={() => setShowDiag(false)} className="text-xs text-stone-400 hover:text-stone-600">✕ 關閉</button>
          </div>
          <div className="px-4 pb-3 space-y-2 text-xs">
            {/* Detected command */}
            {diagnostic.cmd && (
              <div>
                <span className="text-stone-500 font-bold">偵測到的指令：</span>
                <code className="ml-1 px-1.5 py-0.5 bg-amber-50 border border-amber-200 rounded font-mono text-amber-800 select-all">{diagnostic.cmd}</code>
              </div>
            )}

            {/* Full scan command */}
            {diagnostic.fullScanCommand && (
              <div>
                <span className="text-stone-500 font-bold">🚀 完整掃描指令（手動執行這行等同 Run Scan）：</span>
                <div className="mt-1 px-2 py-1.5 bg-blue-50 border border-blue-300 rounded font-mono text-xs text-blue-900 select-all break-all" style={{whiteSpace:"pre-wrap"}}>
                  {diagnostic.fullScanCommand}
                </div>
                {diagnostic.rulePacks && (
                  <div className="mt-1 text-stone-400">
                    Rule packs: {diagnostic.rulePacks.join(", ")}
                  </div>
                )}
                {diagnostic.projectRoot && (
                  <div className="text-stone-400">
                    Project: {diagnostic.projectRoot}
                  </div>
                )}
              </div>
            )}

            {/* Manual test commands */}
            <div>
              <span className="text-stone-500 font-bold">📋 手動測試指令（複製到終端機執行）：</span>
            </div>
            <div className="space-y-1">
              {[
                { label: "1. 檢查 Python", cmd: "python --version" },
                { label: "2. 檢查 pip", cmd: "pip --version" },
                { label: "3. 檢查 semgrep 版本", cmd: diagnostic.cmd ? `${diagnostic.cmd} --version` : "semgrep --version" },
                { label: "4. 安裝 semgrep", cmd: "pip install semgrep" },
                { label: "5. 找 semgrep 路徑", cmd: "where semgrep" },
                { label: "6. 找 Python Scripts 目錄", cmd: "python -c \"import os,site;print(os.path.join(site.getsitepackages()[0],'..','Scripts'))\"" },
                { label: "7. 設定環境變數", cmd: "set SEMGREP_PATH=<上面找到的路徑>" },
              ].map(item => (
                <div key={item.label} className="flex items-start gap-2">
                  <span className="text-stone-400 shrink-0 w-28">{item.label}</span>
                  <code className="flex-1 px-1.5 py-0.5 bg-white border border-stone-200 rounded font-mono text-stone-700 select-all break-all">{item.cmd}</code>
                </div>
              ))}
            </div>

            {/* Tried commands & results */}
            {diagnostic.tried && diagnostic.tried.length > 0 && (
              <div>
                <span className="text-stone-500 font-bold">🔍 已嘗試的指令：</span>
                <div className="mt-1 space-y-1">
                  {diagnostic.tried.map((t: any, i: number) => (
                    <div key={i} className={cn("px-2 py-1 rounded font-mono text-xs",
                      t.ok ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200")}>
                      <span className={t.ok ? "text-green-600" : "text-red-600"}>{t.ok ? "✅" : "❌"}</span>{" "}
                      <span className="select-all">{t.cmd}</span>
                      {t.ok && t.stdout && <div className="text-green-700 mt-0.5 select-all">→ {t.stdout.slice(0, 120)}</div>}
                      {!t.ok && t.error && <div className="text-red-600 mt-0.5 select-all">→ {t.error.slice(0, 120)}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Env info */}
            {diagnostic.envInfo && (
              <div>
                <span className="text-stone-500 font-bold">🌍 環境資訊：</span>
                <pre className="mt-1 px-2 py-1 bg-white border border-stone-200 rounded text-xs font-mono text-stone-600 overflow-x-auto select-all" style={{whiteSpace:"pre-wrap"}}>
{JSON.stringify(diagnostic.envInfo, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Error banner ── */}
      {error && (
        <div className="px-4 py-2 text-xs text-red-600 bg-red-50 border-b border-red-200">
          ❌ {error}
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-stone-400 text-sm">Loading scan results...</div>
        </div>
      )}

      {/* ── Semgrep not installed ── */}
      {notInstalled && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8">
          <div className="text-5xl">📦</div>
          <div className="text-center">
            <div className="text-stone-600 font-semibold text-sm mb-1">Semgrep 未安裝</div>
            <div className="text-stone-400 text-xs mb-4">Security scan 需要 Semgrep — 輕量級靜態分析工具（SAST）</div>
            <div className="bg-stone-50 border border-stone-200 rounded-lg p-4 text-left">
              <div className="text-xs font-bold text-stone-500 mb-2">安裝方式：</div>
              <div className="font-mono text-xs space-y-2">
                <div className="flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 text-xs font-bold shrink-0">pip</span>
                  <span className="text-stone-700">pip install semgrep</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-600 text-xs font-bold shrink-0">brew</span>
                  <span className="text-stone-700">brew install semgrep</span>
                </div>
              </div>
            </div>
            <div className="text-xs text-stone-400 mt-3">
              安裝後重啟 PAAW server 即可使用 🔒
            </div>
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && !scanResult && !error && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <div className="text-5xl">🔒</div>
          <div className="text-stone-500 text-sm">No security scan results yet</div>
          <button onClick={runScan} disabled={scanning}
            className="text-xs px-4 py-1.5 rounded bg-blue-500 text-white hover:bg-blue-600 font-semibold">
            Run First Scan
          </button>
        </div>
      )}

      {/* ── Clean state ── */}
      {!loading && scanResult && findings.length === 0 && !error && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <div className="text-5xl">✅</div>
          <div className="text-green-600 text-sm font-semibold">No issues found!</div>
          <div className="text-stone-400 text-xs">Scanned {stats?.filesScanned || 0} files with {stats?.rulesRun || 0} rules</div>
        </div>
      )}

      {/* ── Main content: finding list + detail ── */}
      {!loading && scanResult && findings.length > 0 && (
        <>
          {/* Filter bar */}
          <div className="shrink-0 px-3 py-1.5 flex items-center gap-2 text-xs" style={{ borderBottom: `1px solid ${tk.borderLight}` }}>
            <button onClick={() => setFilterSeverity("ALL")}
              className={cn("px-2 py-0.5 rounded font-semibold transition-colors",
                filterSeverity === "ALL" ? "bg-stone-700 text-white" : "text-stone-400 hover:bg-stone-100")}>
              All ({findings.length})
            </button>
            {SEVERITY_ORDER.filter(s => stats?.bySeverity[s]).map(s => (
              <button key={s} onClick={() => setFilterSeverity(s)}
                className={cn("px-2 py-0.5 rounded font-semibold transition-colors",
                  filterSeverity === s ? "text-white" : "hover:bg-stone-100")}
                style={filterSeverity === s ? { backgroundColor: SEVERITY_CONFIG[s]?.color } : { color: SEVERITY_CONFIG[s]?.color }}>
                {SEVERITY_CONFIG[s]?.icon} {stats?.bySeverity[s]}
              </button>
            ))}
            <span className="flex-1" />
            <input
              type="text"
              placeholder="Filter by file..."
              value={filterFile}
              onChange={e => setFilterFile(e.target.value)}
              className="text-xs px-2 py-0.5 rounded border border-stone-200 outline-none focus:border-blue-400 w-40"
            />
          </div>

          {/* Split: file list | finding detail */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Left: finding list grouped by file */}
            <div className="w-1/2 overflow-y-auto border-r" style={{ borderColor: tk.borderLight }}>
              {fileList.map(file => (
                <div key={file}>
                  <div className="px-3 py-1 text-xs font-bold text-stone-500 sticky top-0 bg-stone-50 border-b border-stone-100 flex items-center gap-1">
                    <span className="truncate flex-1">{file}</span>
                    <span className="text-stone-400 font-normal">{byFile[file].length}</span>
                  </div>
                  {byFile[file].map((f, i) => {
                    const sev = SEVERITY_CONFIG[f.severity] || SEVERITY_CONFIG.INFO;
                    const isSelected = selectedFinding === f;
                    return (
                      <div key={i}
                        className={cn("px-3 py-1.5 cursor-pointer transition-colors border-l-2",
                          isSelected ? "bg-blue-50" : "hover:bg-stone-50")}
                        style={{ borderLeftColor: isSelected ? tk.accent : "transparent" }}
                        onClick={() => setSelectedFinding(f)}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs">{sev.icon}</span>
                          <span className="text-xs font-mono text-stone-400 shrink-0">L{f.line}</span>
                          <span className="text-xs text-stone-600 truncate flex-1">{f.id}</span>
                        </div>
                        <div className="text-xs text-stone-500 mt-0.5 pl-6 truncate">{f.message}</div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Right: finding detail */}
            <div className="flex-1 overflow-y-auto">
              {selectedFinding ? (
                <div className="p-4 space-y-4">
                  {/* Title */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{SEVERITY_CONFIG[selectedFinding.severity]?.icon}</span>
                      <span className="text-sm font-bold" style={{ color: SEVERITY_CONFIG[selectedFinding.severity]?.color }}>
                        {selectedFinding.severity}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 font-mono">
                        {selectedFinding.id}
                      </span>
                    </div>
                    <div className="text-sm text-stone-700">{selectedFinding.message}</div>
                  </div>

                  {/* Location */}
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-stone-400">📍</span>
                    <button
                      onClick={() => onOpenFile(selectedFinding.file)}
                      className="text-blue-500 hover:underline font-mono">
                      {selectedFinding.file}:{selectedFinding.line}
                    </button>
                    {selectedFinding.endLine > selectedFinding.line && (
                      <span className="text-stone-400">→ {selectedFinding.endLine}</span>
                    )}
                  </div>

                  {/* Code snippet */}
                  {selectedFinding.snippet && (
                    <div>
                      <div className="text-xs font-bold text-stone-500 mb-1">Code:</div>
                      <pre className="text-xs font-mono p-3 rounded bg-stone-50 border border-stone-200 overflow-x-auto"
                        style={{ whiteSpace: "pre-wrap" }}>
                        {selectedFinding.snippet.trim()}
                      </pre>
                    </div>
                  )}

                  {/* Fix suggestion */}
                  {selectedFinding.fix && (
                    <div>
                      <div className="text-xs font-bold text-green-600 mb-1">💡 Suggested Fix:</div>
                      <pre className="text-xs font-mono p-3 rounded bg-green-50 border border-green-200 overflow-x-auto"
                        style={{ whiteSpace: "pre-wrap" }}>
                        {selectedFinding.fix}
                      </pre>
                    </div>
                  )}

                  {/* Metadata */}
                  <div className="flex flex-wrap gap-2 text-xs">
                    {selectedFinding.confidence && selectedFinding.confidence !== "UNKNOWN" && (
                      <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-500">
                        Confidence: {selectedFinding.confidence}
                      </span>
                    )}
                    {Array.isArray(selectedFinding.category) ? (
                      selectedFinding.category.map(c => (
                        <span key={c} className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-600">{c}</span>
                      ))
                    ) : selectedFinding.category ? (
                      <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-600">{selectedFinding.category}</span>
                    ) : null}
                    {selectedFinding.cwe?.map(c => (
                      typeof c === "string" && c.startsWith("CWE") ? (
                        <span key={c} className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-mono">{c}</span>
                      ) : null
                    ))}
                  </div>

                  {/* References */}
                  {selectedFinding.references && selectedFinding.references.length > 0 && (
                    <div>
                      <div className="text-xs font-bold text-stone-500 mb-1">References:</div>
                      <div className="space-y-1">
                        {selectedFinding.references.map((ref, i) => (
                          <a key={i} href={ref} target="_blank" rel="noopener noreferrer"
                            className="block text-xs text-blue-500 hover:underline truncate">
                            {ref}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center h-full">
                  <div className="text-stone-400 text-sm">Select a finding to view details</div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
