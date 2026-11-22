/**
 * cu-background-watcher.mjs — CU 定時全 RU 巡檢（2026-11-21 Fleming）
 *
 * 問題：CU 自動增量重跑原本掛在「前端查 cu-status API」上 — 使用者不開專案就沒人查，
 * CU 凍在 baseline，AI 沒最新內容可參考。
 *
 * 解法：背景定時循環（預設 4h，env CU_WATCH_INTERVAL_MS 可調）對所有已 import 的專案
 * 自呼一次 `GET /api/coding-project/cu-status?path=<root>` — 該 route 本身就含
 * 機械層自動重掃 + 智慧層自動增量重跑邏輯（busy set / 10min cooldown / bulk 訂閱板防併發），
 * 這裡零邏輯重複，只是把觸發條件從「UI 開專案」換成「時間到」。
 *
 * 安全設計：
 * - timer unref() — 不阻擋 process 正常退出
 * - 逐專案 sequential + 失敗續跑 — 一個壞不掉整輪
 * - 無 stale 時只花 git diff 的成本（內容導向 staleness），零 token
 *
 * 2026-11-22 Fleming：import 時不再觸發 CU（onboarding 已無 CU 步驟）→ 從沒跑過 CU 的 RU
 * （無 .paaw/cu-status.json）也納入巡檢：背景自呼 ai-initial 跑首次 CU，
 * 每輪上限 CU_AUTO_NEW_PER_SWEEP（預設 1）避免一次對多個 RU 連發 LLM。
 *
 * 2026-11-21 同日加：同一輪順便做「文件自動保鮮」（doc-autorefresh）—
 * code 有動且 DFO/spec 落後才叫 LLM，人不用介入文件也不會過時。
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { DATA_HOME, REPO_ROOT } from "../data-home.mjs";
import { PORT } from "../routes/shared.mjs";

const DEFAULT_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 小時
const INITIAL_DELAY_MS = 60 * 1000; // server 起來 1 分鐘後先跑第一輪（避開啟動尖峰）
const PER_PROJECT_GAP_MS = 5_000; // 專案間隔 5 秒，避免瞬間連發
const WATCH_TAG = "[cu-watch]";

let _running = false;

/** 收集所有要巡檢的 project root（recent-projects.json + workspaces.json + PAAW_ROOT） */
function _collectProjectRoots() {
  const paths = new Set([REPO_ROOT]);
  const readList = (p, pick) => {
    try {
      const arr = JSON.parse(readFileSync(p, "utf-8"));
      if (Array.isArray(arr)) for (const item of arr) {
        const v = pick(item);
        if (typeof v === "string" && v) paths.add(v);
      }
    } catch {}
  };
  readList(join(DATA_HOME, "config", "recent-projects.json"), (r) => r?.path);
  readList(join(DATA_HOME, "workspaces.json"), (r) => r?.path ?? r?.directories?.[0] ?? null);
  // workspaces.json 的 directories 是字串陣列不是物件陣列，分開處理
  try {
    const ws = JSON.parse(readFileSync(join(DATA_HOME, "workspaces.json"), "utf-8"));
    if (Array.isArray(ws?.directories)) for (const d of ws.directories) if (typeof d === "string" && d) paths.add(d);
  } catch {}
  // 2026-11-22：從沒跑過 CU 的也納入（首次 CU 改由這裡背景跑）
  return [...paths].filter((p) => existsSync(p));
}

/** 首次 CU（無 cu-status.json）背景自呼 ai-initial — 每輪限量 */
async function _runFirstCu(root) {
  const { Agent } = await import("undici");
  const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
  let model = null;
  try { model = JSON.parse(readFileSync(join(root, ".paaw", "cu-model.json"), "utf-8"))?.model || null; } catch {}
  const r = await fetch(`http://127.0.0.1:${PORT}/api/coding-project/ai-initial?path=${encodeURIComponent(root)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: model || undefined }), dispatcher,
  });
  if (r.body) { const rd = r.body.getReader(); while (true) { const { done } = await rd.read(); if (done) break; } }
  try {
    const { importCodingDb } = await import("./coding-db/import.mjs");
    importCodingDb(root);
  } catch {}
}

/** 巡檢一輪：對每個 RU 自呼 cu-status — stale 的會被 route 內既有邏輯自動重掃/重跑 */
async function _runSweep() {
  if (_running) return;
  _running = true;
  try {
    const roots = _collectProjectRoots();
    if (roots.length === 0) return;
    console.log(`${WATCH_TAG} 🕐 巡檢 ${roots.length} 個 RU（stale 才會花 token，無變更零成本）`);
    const maxDocUpdates = parseInt(process.env.DOC_AUTO_MAX_PER_SWEEP || "", 10) || 2;
    let docUpdates = 0;
    const maxNewCu = parseInt(process.env.CU_AUTO_NEW_PER_SWEEP || "", 10) || 1;
    let newCu = 0;
    for (const root of roots) {
      // 首次 CU：從沒跑過（無 cu-status.json）→ 背景自呼 ai-initial（每輪限量）
      if (!existsSync(join(root, ".paaw", "cu-status.json"))) {
        if (newCu < maxNewCu) {
          newCu++;
          try {
            console.log(`${WATCH_TAG} 🧠 首次 CU（背景）：${root}`);
            await _runFirstCu(root);
            console.log(`${WATCH_TAG} 🧠 首次 CU 完成：${root}`);
          } catch (e) { console.warn(`${WATCH_TAG} 首次 CU 失敗 (${root}):`, e.message); }
        }
        await new Promise((ok) => setTimeout(ok, PER_PROJECT_GAP_MS));
        continue;
      }
      try {
        const r = await fetch(
          `http://127.0.0.1:${PORT}/api/coding-project/cu-status?path=${encodeURIComponent(root)}`,
          { headers: { Accept: "application/json" } },
        );
        // 讀掉 body 讔回應完整送達（route 的背景重掃不 await，這裡只要觸發成功）
        await r.arrayBuffer();
      } catch (e) {
        console.warn(`${WATCH_TAG} cu-status 自呼失敗 (${root}):`, e.message);
      }
      // 文件自動保鮮（DFO 跟著 code 走；spec 預設 7 天一次）
      // 2026-11-21：每輪最多處理 DOC_AUTO_MAX_PER_SWEEP 個 RU（預設 2）— 避免重啟後一次對 10 個 RU 連發 LLM
      if (docUpdates < maxDocUpdates) {
        try {
          const { autoRefreshDocs } = await import("./doc-autorefresh.mjs");
          const r = await autoRefreshDocs(root);
          if (/^(updated|created)/.test(r.dfo) || /^updated/.test(r.spec)) {
            docUpdates++;
            console.log(`${WATCH_TAG} 📄 ${root}: dfo=${r.dfo} spec=${r.spec}（本輪第 ${docUpdates}/${maxDocUpdates} 個）`);
          }
        } catch (e) {
          console.warn(`${WATCH_TAG} 文件保鮮失敗 (${root}):`, e.message);
        }
      }
      await new Promise((ok) => setTimeout(ok, PER_PROJECT_GAP_MS));
    }
  } finally {
    _running = false;
  }
}

/** 啟動背景巡檢循環（paaw-server listen 後呼叫一次） */
export function startCuBackgroundWatcher() {
  const intervalMs = parseInt(process.env.CU_WATCH_INTERVAL_MS || "", 10) || DEFAULT_INTERVAL_MS;
  const timer = setInterval(() => { _runSweep().catch(() => {}); }, intervalMs);
  timer.unref();
  // 第一輪延遲跑（不阻塞啟動）
  const boot = setTimeout(() => { _runSweep().catch(() => {}); }, INITIAL_DELAY_MS);
  boot.unref();
  console.log(`${WATCH_TAG} 🧹 CU 定時巡檢已啟動（interval=${Math.round(intervalMs / 60000)}min，可由 CU_WATCH_INTERVAL_MS 調整）`);
}
