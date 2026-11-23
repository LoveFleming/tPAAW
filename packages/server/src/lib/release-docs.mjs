/**
 * release-docs.mjs — RR 的三份 AI 文件（Prod Spec / DFO / Release Info）編排 + 決定性檢查
 *
 * 2026-11-21 Fleming 定調（Release Manager tab）：
 *   - New RR → 自動觸發 AI 製作三份文件
 *   - 任何一份有問題 → 顯示給人看，人按按鈕重做（不自動擋）
 *   - 全部 OK → 人把 RR set to close（只改 status，不卡關）
 *   - 最新一版可 reopen 重做（臨時要加功能，保留彈性）
 *
 * 這支只做「狀態記錄 + 觸發 + 決定性檢查」，不新增 workflow/approval。
 * 狀態檔：.paaw/release-info/{RR-ID}/docs.json
 */

import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import { PORT } from "../routes/shared.mjs";
import { getReleaseRequest } from "./release-requests.mjs";

const BASE = () => `http://127.0.0.1:${PORT}`;
// 2026-11-23 fix：spec-fill 跑 8 節可超過 5 分鐘，global fetch 預設 headersTimeout=300s 會把外層 fetch 掓死
// （「fetch failed」但內層其實成功）— 改用同份 undici 的 fetch+Agent（關 timeout）
import { Agent as _DocAgent, fetch as _docFetch } from "undici";
const _docDispatcher = new _DocAgent({ headersTimeout: 0, bodyTimeout: 0 });
const docFetch = (url, opts) => _docFetch(url, { ...opts, dispatcher: _docDispatcher });
const DOC_KINDS = ["spec", "dfo", "releaseInfo", "diff"]; // 2026-11-22 Fleming：多一個「與前一版的差異摘要」（第一版無前版可白動 skip）

export function docsStatusPath(projectPath, rrId) {
  return join(projectPath, ".paaw", "release-info", rrId, "docs.json");
}

export function readDocsStatus(projectPath, rrId) {
  try {
    const d = JSON.parse(readFileSync(docsStatusPath(projectPath, rrId), "utf-8"));
    return { rrId, docs: {}, ...d };
  } catch {
    return { rrId, docs: {}, updatedAt: null };
  }
}

function writeDocsStatus(projectPath, rrId, st) {
  const p = docsStatusPath(projectPath, rrId);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, JSON.stringify({ ...st, rrId, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
}

function setDoc(projectPath, rrId, kind, patch) {
  const st = readDocsStatus(projectPath, rrId);
  st.docs = { ...(st.docs || {}), [kind]: { ...(st.docs?.[kind] || {}), ...patch, at: new Date().toISOString() } };
  writeDocsStatus(projectPath, rrId, st);
  return st;
}

/** 觸發單份文件重做（背景跑，立即回 running） */
export async function triggerDoc(projectPath, rrId, kind) {
  const run = async () => {
    try {
      if (kind === "spec") {
        const r = await docFetch(`${BASE()}/api/coding-project/project-md/spec-fill?path=${encodeURIComponent(projectPath)}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rr: rrId }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d?.error) throw new Error(d?.error || `spec-fill HTTP ${r.status}`);
        if (!d?.written) throw new Error(d?.reason || "spec 未寫入");
        setDoc(projectPath, rrId, kind, { status: "done", error: null, detail: `spec ${d.version || ""} · ${(d.sections || []).length} 節` });
      } else if (kind === "dfo") {
        const r = await docFetch(`${BASE()}/api/coding-dfo/generate?path=${encodeURIComponent(projectPath)}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: projectPath, rr: rrId }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d?.error) throw new Error(d?.error || `dfo generate HTTP ${r.status}`);
        setDoc(projectPath, rrId, kind, { status: "done", error: null, detail: `DFO ${d.version ?? "?"}` });
      } else if (kind === "releaseInfo") {
        const { startReleaseInfoBuild, getBuildStatus, listInfoVersions } = await import("./release-info-builder.mjs");
        await startReleaseInfoBuild(projectPath, rrId, { by: "auto:docs" });
        // 背景 job：輪詢到結束（最多 15 分鐘）再落狀態
        const t0 = Date.now();
        let st = getBuildStatus(projectPath, rrId);
        while (st?.running && Date.now() - t0 < 15 * 60_000) {
          await new Promise((ok) => setTimeout(ok, 4000));
          st = getBuildStatus(projectPath, rrId);
        }
        if (st?.error) throw new Error(st.error);
        // 2026-11-22 Fleming：未 close 前不顯示版號（誤導：v18 是預估下一版，不是真的 release 過 18 次）
        setDoc(projectPath, rrId, kind, { status: "done", error: null, detail: st?.aiFallback ? "AI 摘要失敗（系統列表）" : `生成於 ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, aiFallback: !!st?.aiFallback });
      } else if (kind === "diff") {
        // 2026-11-22 Fleming：📊 與前一版的差異摘要（決定性證據 + AI 條列；第一版自動 skip）
        // 先等 releaseInfo build（並行觸發時）跑完再比，免得拿舊版比
        const { getBuildStatus } = await import("./release-info-builder.mjs");
        const t0 = Date.now();
        let stx = getBuildStatus(projectPath, rrId);
        while (stx?.running && Date.now() - t0 < 15 * 60_000) {
          await new Promise((ok) => setTimeout(ok, 4000));
          stx = getBuildStatus(projectPath, rrId);
        }
        const { buildDiffSummary } = await import("./release-diff.mjs");
        const d = await buildDiffSummary(projectPath, rrId);
        if (d?.skipped) { setDoc(projectPath, rrId, kind, { status: "done", error: null, detail: `（${d.reason || "第一版，無前版可比"}）`, skipped: true }); }
        else setDoc(projectPath, rrId, kind, { status: "done", error: null, detail: d.aiFallback ? "決定性數字表（AI 摘要失敗 fallback）" : `vs ${d.previous.rr} v${d.previous.version}`, aiFallback: !!d.aiFallback });
      } else {
        throw new Error(`unknown doc kind: ${kind}`);
      }
    } catch (e) {
      setDoc(projectPath, rrId, kind, { status: "error", error: e.message });
      console.warn(`[release-docs] ${kind} failed (${rrId}):`, e.message);
    }
  };
  setDoc(projectPath, rrId, kind, { status: "running", error: null });
  run();
  return readDocsStatus(projectPath, rrId);
}

export async function triggerAllDocs(projectPath, rrId) {
  for (const k of DOC_KINDS) await triggerDoc(projectPath, rrId, k);
  return readDocsStatus(projectPath, rrId);
}

const _readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; } };
const _mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };

/**
 * 決定性檢查（零 LLM）：只驗「事實對不對」，回 findings [{doc, level, message}]
 * level: error = 明確錯誤（顯示紅字）；warn = 提醒（可重做）
 */
export async function verifyDocs(projectPath, rrId) {
  const findings = [];
  const add = (doc, level, message) => findings.push({ doc, level, message });
  let rr = null;
  try { rr = await getReleaseRequest(projectPath, rrId); } catch {}
  const rrCreatedMs = rr?.createdAt ? new Date(rr.createdAt).getTime() : 0;

  // ── Release Info ──
  let info = null, infoVersions = [];
  try {
    const { listInfoVersions, readInfoVersion } = await import("./release-info-builder.mjs");
    infoVersions = listInfoVersions(projectPath, rrId);
    if (infoVersions.length) info = readInfoVersion(projectPath, rrId, Math.max(...infoVersions));
  } catch {}
  if (!info) add("releaseInfo", "error", "Release Info 尚未產生");
  else {
    if (info.ai?.source === "fallback" || info.aiFallback) add("releaseInfo", "warn", "AI 摘要失敗，目前內容是系統列出的 commit 清單 — 建議重做");
    if (!Array.isArray(info.changes)) add("releaseInfo", "error", "Release Info 缺少 changes 陣列");
    if (!Array.isArray(info.features)) add("releaseInfo", "warn", "Release Info 沒有 features 資訊（schema 1.1 應有）");
    // 2026-11-21：features 是 AI 摘要（id 可為 API entry 或功能 slug），不再對照 Feature Map（避免假警報）
    // commit 必須是 HEAD（否則代表有更新沒重做）
    try {
      const { shellExec } = await import("./shell-exec.mjs");
      const head = (await shellExec("git rev-parse HEAD", { cwd: projectPath, timeout: 8000 })).stdout.trim();
      if (info.git?.commit && head && !head.startsWith(info.git.commit) && !info.git.commit.startsWith(head.slice(0, 7))) {
        add("releaseInfo", "warn", `Release Info 不是最新 HEAD（info=${info.git.commit.slice(0, 7)} / HEAD=${head.slice(0, 7)}）— 有新 commit 建議重做`);
      }
    } catch {}
  }

  // ── Prod Spec ──
  try {
    const { parseProjectMd, splitSpecSections } = await import("./project-md.mjs");
    const specCandidates = [join(projectPath, ".paaw", "project", "PROJECT.md"), join(projectPath, ".paaw", "PROJECT.md")];
    const specPath = specCandidates.find((x) => existsSync(x));
    if (!specPath) throw new Error("PROJECT.md not found");
    const md = readFileSync(specPath, "utf-8");
    const parts = splitSpecSections(parseProjectMd(md).specSection || "");
    const empty = parts.filter((p) => !String(p || "").trim()).length;
    if (empty === 8) add("spec", "error", "Prod Spec 尚未產生（8 節全空）");
    else if (empty > 0) add("spec", "warn", `Prod Spec 有 ${empty} 節空白 — 建議重做`);
    const bad = parts.join("\n").match(/資料待補|待人確認|待討論/g);
    if (bad) add("spec", "error", `Prod Spec 含 ${bad.length} 處「待補/待確認」佔位 — AI 未填完`);
    const specMs = _mtime(specPath);
    if (rrCreatedMs && specMs && specMs < rrCreatedMs) add("spec", "warn", "Prod Spec 在 RR 建立後未更新 — 可能沒涵蓋本版變更");
  } catch {
    add("spec", "error", "Prod Spec（PROJECT.md）不存在");
  }

  // ── DFO ──
  try {
    const { readDfo } = await import("./dfo.mjs");
    const dfo = readDfo(projectPath);
    if (!dfo) add("dfo", "error", "DFO 尚未產生");
    else {
      const empty = (dfo.sections || []).filter((s) => !String(s.markdown || "").trim()).length;
      if (empty) add("dfo", "warn", `DFO 有 ${empty} 節空白 — 建議重做`);
      const dfoMs = _mtime(join(projectPath, ".paaw", "dfo", "dfo.json"));
      if (rrCreatedMs && dfoMs && dfoMs < rrCreatedMs) add("dfo", "warn", "DFO 在 RR 建立後未更新 — 可能沒涵蓋本版變更");
    }
  } catch {
    add("dfo", "error", "DFO 讀取失敗");
  }

  return {
    ok: findings.filter((f) => f.level === "error").length === 0,
    errors: findings.filter((f) => f.level === "error").length,
    warnings: findings.filter((f) => f.level === "warn").length,
    findings,
  };
}

/** 給 UI 的整合狀態：三份文件狀態 + 決定性檢查 */
export async function getDocsOverview(projectPath, rrId) {
  const status = readDocsStatus(projectPath, rrId);
  const verify = await verifyDocs(projectPath, rrId);
  return { rrId, docs: status.docs || {}, verify, updatedAt: status.updatedAt };
}
