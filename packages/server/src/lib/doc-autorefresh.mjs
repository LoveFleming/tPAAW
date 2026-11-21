/**
 * doc-autorefresh.mjs — 文件自動保鮮（2026-11-21 Fleming）
 *
 * 目標：人不用介入，Prod Spec / DFO 也會跟著 code 走，維持在最新狀態。
 *
 * 觸發：CU 背景巡檢（cu-background-watcher，預設 4h）每輪對每個 RU 檢查一次。
 * 判斷（零成本，先看 git/檔案）：
 *   - DFO：`.paaw/dfo/dfo.json` 的 codeCommit ≠ 目前 HEAD → 背景重生（label 不變，同代號覆寫）
 *   - Spec：`.paaw/spec/versions/*` 存在且 spec 的 codeCommit ≠ HEAD 且距上次自動更新 ≥ SPEC_AUTO_DAYS（預設 7 天）→ 觸發 spec-fill
 *   - 凍結中的 DFO（RR 已關）不動
 * 成本控制：只有 code 真的變了才會叫 LLM；同一 commit 只做一次（codeCommit 記錄）。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { PORT } from "../routes/shared.mjs";

const TAG = "[doc-auto]";

function _readJson(p) { try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; } }
function _writeJson(p, o) { try { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 2)); } catch {} }

function _head(root) {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, timeout: 8000 }).toString().trim(); } catch { return null; }
}

async function _post(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

/** 對單一 RU 檢查並自動更新文件（回傳做了什麼，方便 log / 測試） */
export async function autoRefreshDocs(root, opts = {}) {
  const out = { dfo: "skip", spec: "skip" };
  if (process.env.DOC_AUTO_WATCH === "0" && !opts.force) return out;
  const head = _head(root);
  if (!head) return out;

  const statePath = join(root, ".paaw", "doc-auto.json");
  const state = _readJson(statePath) || {};

  // ── DFO ──
  const dfoPath = join(root, ".paaw", "dfo", "dfo.json");
  // 有 CU 但還沒有 DFO → 自動建第一版（initial），人不用介入
  if (!existsSync(dfoPath) && existsSync(join(root, ".paaw", "cu-status.json")) && state.dfoCommit !== head) {
    try {
      const r = await _post(`http://127.0.0.1:${PORT}/api/coding-dfo/generate?path=${encodeURIComponent(root)}`, { cwd: root });
      if (r.ok) { out.dfo = `created ${r.data?.version || ""}`; state.dfoCommit = head; }
    } catch (e) { out.dfo = `error(${e.message})`; }
  } else if (existsSync(dfoPath)) {
    const dfo = _readJson(dfoPath);
    const seen = dfo?.codeCommit || state.dfoCommit;
    if (dfo && seen && seen !== head && state.dfoCommit !== head) {
      try {
        const r = await _post(`http://127.0.0.1:${PORT}/api/coding-dfo/generate?path=${encodeURIComponent(root)}`, { cwd: root });
        if (r.ok) { out.dfo = `updated ${r.data?.version || ""}`; state.dfoCommit = head; }
        else out.dfo = `skip(${r.data?.error || r.status})`; // 凍結或 LLM 失敗 → 不記 commit，下輪再試
      } catch (e) { out.dfo = `error(${e.message})`; }
    } else if (!seen) {
      out.dfo = "skip(no-commit-marker)";
    }
  }

  // ── Spec（預設 7 天一次，SPEC_AUTO_DAYS=0 關閉）──
  const specDays = process.env.SPEC_AUTO_DAYS === undefined ? 7 : Number(process.env.SPEC_AUTO_DAYS);
  const specVersions = join(root, ".paaw", "spec", "versions");
  if (specDays > 0 && existsSync(specVersions)) {
    const lastAt = state.specAt ? Date.parse(state.specAt) : 0;
    const due = Date.now() - lastAt >= specDays * 24 * 3600 * 1000;
    const changed = (state.specCommit || "") !== head;
    if (due && changed) {
      try {
        const r = await _post(`http://127.0.0.1:${PORT}/api/coding-project/project-md/spec-fill?path=${encodeURIComponent(root)}`, {});
        if (r.ok && r.data?.written) {
          out.spec = `updated ${r.data?.version || ""} (${(r.data?.sections || []).length} 節)`;
          state.specAt = new Date().toISOString(); state.specCommit = head;
        } else out.spec = `skip(${r.data?.error || r.data?.reason || r.status})`;
      } catch (e) { out.spec = `error(${e.message})`; }
    }
  }

  if (/^(updated|created)/.test(out.dfo) || out.spec.startsWith("updated")) _writeJson(statePath, state);
  return out;
}
