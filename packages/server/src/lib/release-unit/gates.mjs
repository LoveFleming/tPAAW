/**
 * release-unit/gates.mjs — 發布門檻（Tier 2 治理力）
 *
 * gates 定義放 .paaw/gates.json（可覆寫預設）；check 時讀 verify-last +
 * git 狀態判定每個 gate 過/不過。沒跑過 verify → blocked（不能發布）。
 *
 * 預設 gates（Release Unit 總計畫 §品質門檻）：
 *   build / type-check / test = required；lint = warn；
 *   clean-tree（無未 commit 變更）= warn
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { readLastVerify } from "./verify.mjs";
import { shellExec } from "../shell-exec.mjs";

const DEFAULT_GATES = {
  build: { required: true },
  "type-check": { required: true },
  test: { required: true },
  lint: { required: false, level: "warn" },
  "clean-tree": { required: false, level: "warn" },
};

/** 讀（或建立）gates.json */
export async function loadGates(root) {
  const file = join(root, ".paaw", "gates.json");
  let gates = { ...DEFAULT_GATES };
  let created = false;
  if (existsSync(file)) {
    try {
      const user = JSON.parse(await readFile(file, "utf-8"));
      gates = { ...DEFAULT_GATES, ...user };
    } catch { /* 壞檔用預設 */ }
  } else {
    try {
      const dir = join(root, ".paaw");
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      await writeFile(file, JSON.stringify({ ...DEFAULT_GATES, _hint: "required:true 擋發布；level:warn 只警示" }, null, 2), "utf-8");
      created = true;
    } catch { /* 寫不出來就算了 */ }
  }
  return { gates, file, created };
}

/** 檢查所有 gates（對照 verify-last + git 狀態） */
export async function checkGates(root) {
  const { gates, file, created } = await loadGates(root);
  const last = await readLastVerify(root);
  const verifyByCheck = {};
  for (const c of last?.checks || []) verifyByCheck[c.check] = c;

  // git dirty（給 clean-tree gate 用）
  let dirtyCount = null;
  try {
    const { stdout } = await shellExec("git status --porcelain", { cwd: root, timeout: 10_000, maxBuffer: 1e6 });
    dirtyCount = (stdout || "").split("\n").filter(Boolean).length;
  } catch { /* 非 git repo */ }

  const results = [];
  for (const [name, conf] of Object.entries(gates)) {
    if (name.startsWith("_")) continue;
    const item = { gate: name, required: !!conf.required, level: conf.level || (conf.required ? "block" : "warn") };

    if (name === "clean-tree") {
      if (dirtyCount === null) { item.status = "skip"; item.detail = "not a git repo"; }
      else if (dirtyCount === 0) item.status = "pass";
      else { item.status = conf.required ? "fail" : "warn"; item.detail = `${dirtyCount} uncommitted files`; }
      results.push(item);
      continue;
    }

    const ran = verifyByCheck[name];
    if (!last) {
      item.status = "not-run";
      item.detail = "verify 從未執行 — POST /api/ru/verify 先建立基準";
    } else if (!ran) {
      // verify 跑過但沒跑這關（skip 或無指令）
      item.status = conf.required ? "not-run" : "skip";
      item.detail = `上次 verify 未包含 ${name}`;
    } else {
      item.status = ran.ok ? "pass" : (conf.required ? "fail" : "warn");
      if (!ran.ok) item.detail = `${ran.command} 失敗（${Math.round(ran.durationMs / 100) / 10}s）`;
    }
    results.push(item);
  }

  const blocking = results.filter(r => r.required && r.status !== "pass");
  const warnings = results.filter(r => !r.required && (r.status === "warn" || r.status === "fail"));
  const overall = blocking.length === 0
    ? (warnings.length ? "pass-with-warnings" : "pass")
    : "blocked";

  return {
    root: String(root),
    overall,                        // pass | pass-with-warnings | blocked
    gates: results,
    blocking: blocking.map(b => b.gate),
    warnings: warnings.map(w => w.gate),
    verifyAt: last?.generatedAt || null,
    gatesFile: file.split(/[\\/]/).slice(-2).join("/"),
    gatesCreated: created,
    checkedAt: new Date().toISOString(),
  };
}
