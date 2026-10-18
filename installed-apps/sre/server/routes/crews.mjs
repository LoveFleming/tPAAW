/**
 * crews — SRE 室職能專家編制（左邊清單 = 各專長 AI agent）
 *
 * 架構（2026-10-09 起）：crew 一律 firmware；本模組把自帶模板
 *   installed-apps/sre/crews/<agentId>.json  →  data/crews/<agentId>.json
 * 掛載時 ensure（冪等，隨模組更新覆蓋模板檔；.paaw override 仍可疊 append/顯示欄位）。
 *
 * 清單：
 *   GET /api/sre/crews          → { agents:[...], cabinets:[...] }
 *   POST /api/sre/crews/sync    → 重新同步模板（debug/更新用）
 *
 * 每個職能 = 一個 agent（agentId `sre.<id>`）+ 一個職能檔案櫃（dossiers/<id>/）。
 * 「左邊功能 ↔ 專家」對應表在 BUILTIN_FUNCTIONS。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync } from "fs";
import { join } from "path";
import { readBody, PAAW_ROOT, TPAW_REPO_ROOT, MODULE_DIR } from "./shared.mjs";

const REG = join(PAAW_ROOT, "services.json");
const CREWS_DEST = join(TPAW_REPO_ROOT, "data", "crews");
const CREWS_SRC = join(MODULE_DIR, "crews");

/** 職能專家編制（左邊「專家團隊」區）— 每個功能對一個專長 agent */
export const BUILTIN_FUNCTIONS = [
  { id: "grafana",  name: "監控巡檢員", emoji: "📈", agentId: "sre.grafana",   duty: "Grafana/Prometheus 巡檢、面板與告警盤點、數據源健康、產出巡檢報告" },
  { id: "incident", name: "告警處置官", emoji: "🚨", agentId: "sre.incident",  duty: "事故分級與通報、止損、on-call 交接、事件時間線" },
  { id: "capacity", name: "容量規劃師", emoji: "📦", agentId: "sre.capacity",  duty: "資源水位、擴縮容、成本與容量規劃" },
  { id: "release",  name: "部署變更官", emoji: "🚀", agentId: "sre.release",   duty: "部署流程、變更風險評估、回滾計畫、變更窗口" },
  { id: "slo",      name: "可靠性治理師", emoji: "🎯", agentId: "sre.slo",     duty: "SLO/錯誤預算、可靠性覆盤、可靠性改善路線" },
  { id: "postmortem", name: "事故覆盤師", emoji: "🧯", agentId: "sre.postmortem", duty: "postmortem 撰寫、action item 追蹤、同因事故防再發" },
  { id: "runbook",  name: "Runbook 管理師", emoji: "📖", agentId: "sre.runbook", duty: "運維手冊/SOP、值班清單、演練腳本" },
];
export const CHIEF = { id: "chief", name: "SRE 總管", emoji: "🛡️", agentId: "sre.chief", duty: "跨服務調度、可靠性總覽、重大事故指揮" };

/** registry 損毀標記 — loadRegistry 拋出後由 ensure 消費：絕不以空陣列 persist 覆蓋使用者服務（QA C2） */
export const REGISTRY_CORRUPT = Symbol("registry-corrupt");

export function loadRegistry() {
  const raw = readFileSync(REG, "utf-8"); // 不存在 → ENOENT → caller 以空編制重建（安全）
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error("services.json 內容非陣列");
  return list;
}

/** 原子寫（QA C2/M4）：tmp → rename，crash 不留截斷檔 */
export function saveRegistry(list) {
  const tmp = REG + ".tmp";
  writeFileSync(tmp, JSON.stringify(list, null, 2));
  renameSync(tmp, REG);
}

/**
 * 讀-改-寫序列化（QA M4）：process 內並發 scaffold/sync/ensure 不再 lost update。
 * 契約：mutate(reg) 就地修改 reg 並回傳 result（給 caller）；回傳嚴格 false = 不落盤（如 ensure 無變更）。
 * 鎖鏈不因單次失敗中斷（失敗只回給當次 caller）。
 */
let _regLock = Promise.resolve();
export function withRegistry(mutate) {
  const run = _regLock.then(async () => {
    let reg = [];
    try { reg = loadRegistry(); } catch (e) {
      if (e.code === "ENOENT") reg = [];
      else throw e; // 損毀（parse error / 非陣列）→ 上拋，絕不靜默重建（C2）
    }
    const result = await mutate(reg);
    if (result !== false) saveRegistry(reg); // reg 是 in-place 修改後的同一陣列
    return result;
  });
  _regLock = run.then(() => undefined, () => undefined); // 鎖鏈吞錯續行；錯誤只回當次 caller
  return run;
}

function crewTemplate(agentId) {
  const p = join(CREWS_SRC, `${agentId}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
}

/**
 * ensure：① 職能檔案櫃（目錄 + README）② registry 條目 ③ data/crews/sre.*.json 模板
 * 冪等：模板「每次都覆蓋」（firmware 隨模組更新）；registry/目錄只補不覆蓋使用者改動。
 */
export async function ensureBuiltinCrews() {
  const synced = [];
  try {
    mkdirSync(CREWS_DEST, { recursive: true });
    // 走 withRegistry（QA M4）：與 services POST/PATCH 同一把鎖，消除 lost update；
    // registry 損毀 → loadRegistry 內部上拋 → 本函式 catch 靜默失敗，絕不以 [] 為基底落盤（QA C2）
    await withRegistry((reg) => {
      let changed = false;

      const entries = [...BUILTIN_FUNCTIONS, CHIEF];
      for (const f of entries) {
        // ① 檔案櫃（chief 不給櫃；總管看全部）
        if (f.id !== "chief") {
          const dir = join(PAAW_ROOT, "dossiers", f.id);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          const readme = join(dir, "README.md");
          if (!existsSync(readme)) {
            writeFileSync(readme, `# ${f.emoji} ${f.name}（${f.agentId}）\n\n職責：${f.duty}\n\n## 檔案慣例\n- 產出檔帶主題與日期：\`主題-YYYY-MM-DD.md\`\n- 跨服務通用知識（模板、checklist、SOP）放這裡\n- 引用服務事實時註明來源櫃與檔名（如 \`api-gateway/overview.md\`）\n`);
          }
          if (!reg.some(r => r.id === f.id)) {
            reg.push({ ...f, description: f.duty, kind: "function", builtin: true, enabled: true });
            changed = true;
          }
        }

        // ③ crew 模板 → data/crews（firmware 隨模組更新；tmp→rename 原子寫）
        const tpl = crewTemplate(f.agentId);
        if (tpl) {
          const dest = join(CREWS_DEST, `${f.agentId}.json`);
          const next = JSON.stringify(tpl, null, 2);
          let prev = "";
          try { prev = readFileSync(dest, "utf-8"); } catch { /* 不存在 */ }
          if (prev !== next) {
            const tmp = dest + ".tmp";
            writeFileSync(tmp, next);
            renameSync(tmp, dest);
            synced.push(f.agentId);
          }
        }
      }

      return changed ? true : false; // false = 無變更不落盤（withRegistry 契約）
    });

    if (synced.length) console.log(`[sre] crews 已同步：${synced.join(", ")}`);
  } catch (e) {
    console.error(`[sre] ensureBuiltinCrews 失敗：${e.message}`);
  }

  return synced;
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (!p.startsWith("/api/sre/crews")) return false;
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); return true; };

  if (req.method === "GET") {
    const dir = CREWS_DEST;
    const agents = [...BUILTIN_FUNCTIONS, CHIEF].map(f => ({
      ...f,
      crewPath: join(dir, `${f.agentId}.json`),
      crewReady: existsSync(join(dir, `${f.agentId}.json`)),
    }));
    return json(200, { agents, chief: CHIEF.agentId });
  }

  if (req.method === "POST") {
    await readBody(req).catch(() => "");
    const synced = await ensureBuiltinCrews();
    return json(200, { ok: true, synced });
  }

  return json(405, { error: "method not allowed" });
}

/** 服務櫃清單（board/樹用）— 讓 briefing/services 共用 */
export function listCabinets() {
  try {
    const dirs = readdirSync(join(PAAW_ROOT, "dossiers"), { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith(".")).map(d => d.name);
    return dirs;
  } catch { return []; }
}
