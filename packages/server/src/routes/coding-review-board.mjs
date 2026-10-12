/**
 * coding-review-board.mjs — Code Review 委員會會議記錄 API Routes（2026-10-11 Fleming）
 *
 * Multi-Model Review 委員會每次開會的 report 落檔在 {project}/.paaw/review-board/*.md
 * （coding-review-runner.mjs 產出）。本 route 把這些 md 當「會議記錄」公開成唯讀頁面：
 *   - LIST：列出全部 report + 解析出的 metadata（時間/range/結論/reviewers/findings/分歧）
 *   - REPORT：讀單一 report 全文 markdown（給前端 render 成會議記錄）
 *
 * 鐵律：純唯讀。檔名嚴格 basename 驗證（防路徑穿越）。
 *
 * Routes:
 *   GET /api/coding-review-board/list?path=<projectDir>
 *   GET /api/coding-review-board/report?path=<projectDir>&file=<filename>
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";

const SEV_ICON = { critical: "🔴", major: "🟠", minor: "🟡" };

/** 解析單份 report 的 metadata — 容忍舊格式，缺欄位回 null，不硬猜 */
export function parseReport(file, md, mtimeMs) {
  const at = (md.match(/- 時間：(\S+)/) || [])[1] || (mtimeMs ? new Date(mtimeMs).toISOString() : null);
  const range = (md.match(/- Range：`([^`]+)`/) || [])[1] || null;
  const pathFilter = /- Range：`[^`]+`（path:/.test(md)
    ? ((md.match(/（path: `([^`]+)`）/) || [])[1] || true)
    : null;
  const reviewers = [...(md.match(/- Reviewers：(.+)/) || [])].slice(1).flatMap(line =>
    [...line.matchAll(/`([^`]+)`/g)].map(m => m[1]));
  const decM = md.match(/- 結論：\*\*([a-z-]+)\*\*（critical (\d+) \/ major (\d+) \/ minor (\d+)）/);
  const decision = decM ? decM[1] : null;
  const counts = decM ? { critical: +decM[2], major: +decM[3], minor: +decM[4] } : null;
  const shasM = md.match(/- CommitSHAs：\s*([0-9a-f ]+)/);
  const commitShas = shasM ? shasM[1].trim().split(/\s+/).filter(Boolean) : null;
  const fileCount = (md.match(/- 檔案數：(\d+)/) || [])[1];
  // findings = `### <icon> file:line ...` headings（分歧區用 `- **` 不算）
  const findings = [...md.matchAll(/^### (.+)$/gm)].map(m => m[1].trim());
  const consensus = (md.match(/🤝/g) || []).length;
  const disputes = /## 🚩 分歧/.test(md)
    ? (md.split("## 🚩 分歧")[1] || "").split("\n").filter(l => l.startsWith("- **")).length
    : 0;
  const tdDropped = /## 退件的幻覺 findings/.test(md)
    ? (md.split("## 退件的幻覺 findings")[1] || "").split("\n").filter(l => l.startsWith("- [")).length
    : 0;
  return {
    file,
    at,
    range,
    pathFilter: pathFilter || null,
    decision, // approve | review-notes | request-changes | inconclusive | null（非 runner 格式）
    counts,
    reviewers,
    modelCount: reviewers.length,
    commitShas,
    commitCount: commitShas ? commitShas.length : 0,
    fileCount: fileCount ? +fileCount : null,
    findingsCount: findings.length,
    consensus,
    disputes,
    dropped: tdDropped,
    runnerFormat: !!(decision && range),
  };
}

export default async function reviewBoardRoutes(req, res) {
  const urlObj = new URL(req.url || "", "http://localhost");
  const pathname = urlObj.pathname;
  const projectDir = urlObj.searchParams.get("path") || "";

  const json = (code, data) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return true;
  };

  // ── GET /api/coding-review-board/list ──
  if (req.method === "GET" && pathname === "/api/coding-review-board/list") {
    if (!projectDir) return json(400, { ok: false, error: "Missing path" });
    const dir = join(projectDir, ".paaw", "review-board");
    if (!existsSync(dir)) return json(200, { ok: true, exists: false, reports: [], latest: null });
    let files = [];
    try { files = (await readdir(dir)).filter(f => f.endsWith(".md")).sort(); } // 檔名 ts 前綴 = 舊→新
    catch { return json(200, { ok: true, exists: true, reports: [], latest: null }); }
    const reports = [];
    for (const f of files) {
      try {
        const [md, st] = await Promise.all([readFile(join(dir, f), "utf-8"), stat(join(dir, f))]);
        reports.push(parseReport(f, md, st.mtimeMs));
      } catch { /* skip unreadable */ }
    }
    reports.reverse(); // 新→舊（最新會議在前）
    return json(200, { ok: true, exists: true, count: reports.length, reports, latest: reports[0] || null });
  }

  // ── GET /api/coding-review-board/report?file=... ──
  if (req.method === "GET" && pathname === "/api/coding-review-board/report") {
    if (!projectDir) return json(400, { ok: false, error: "Missing path" });
    const file = urlObj.searchParams.get("file") || "";
    // 嚴格 basename 驗證 — 防路徑穿越
    // 註：不用 includes("..") — runner 產的檔名含 git range（如 HEAD~1..HEAD.md）本就有 ".."，
    // basename===file 已保證無路徑分隔，等價且不誤殺。
    if (!file || basename(file) !== file || /[\\/]/.test(file) || !file.endsWith(".md")) {
      return json(400, { ok: false, error: "Invalid file" });
    }
    const p = join(projectDir, ".paaw", "review-board", file);
    if (!existsSync(p)) return json(404, { ok: false, error: "Not found" });
    try {
      const content = await readFile(p, "utf-8");
      return json(200, { ok: true, file, content });
    } catch (err) {
      return json(500, { ok: false, error: String(err.message || err) });
    }
  }

  return false;
}
