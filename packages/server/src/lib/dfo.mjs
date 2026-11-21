/**
 * dfo.mjs — Design for Operation（DFO）文件 lib（2026-11-20 Fleming）
 *
 * DFO = Handover + Troubleshooting 合併的維運設計文件，owner = Greta（coding.ops）。
 * 單一真相 .paaw/dfo/dfo.json；每次寫入自動快照 versions/v{N}.json（不可變）。
 * AI 更新時自動讀現行版當參考（延續性）；`<!-- AI:SKIP-START/END -->` 人寫區塊機械保留。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

export const DFO_SECTIONS = [
  { id: "overview", title: "系統全景" },
  { id: "operations", title: "日常操作" },
  { id: "troubleshooting", title: "事故排查" },
  { id: "handover", title: "交接上手" },
  { id: "rollback", title: "回滾與降級" },
];
export const DFO_SCHEMA_VERSION = 1;

export function dfoDir(root) { return join(root, ".paaw", "dfo"); }
export function dfoPath(root) { return join(dfoDir(root), "dfo.json"); }
export function dfoVersionsDir(root) { return join(dfoDir(root), "versions"); }

/** schema 驗證（機械層）— 不合就 throw，呼叫端擋寫入 */
export function validateDfo(dfo) {
  if (!dfo || typeof dfo !== "object") throw new Error("dfo 必須是 object");
  if (dfo.schemaVersion !== DFO_SCHEMA_VERSION) throw new Error(`schemaVersion 必須是 ${DFO_SCHEMA_VERSION}`);
  if (!Array.isArray(dfo.sections)) throw new Error("sections 必須是 array");
  const ids = dfo.sections.map(s => s?.id);
  for (const def of DFO_SECTIONS) {
    if (!ids.includes(def.id)) throw new Error(`缺少 section: ${def.id}`);
  }
  for (const s of dfo.sections) {
    if (typeof s.markdown !== "string") throw new Error(`section ${s.id} 的 markdown 必須是 string`);
    const def = DFO_SECTIONS.find(d => d.id === s.id);
    if (def && s.title !== undefined && s.title !== def.title) throw new Error(`section ${s.id} title 不合法（固定: ${def.title}）`);
  }
  return true;
}

/** 讀現行版（無 → null） */
export function readDfo(root) {
  try {
    const raw = readFileSync(dfoPath(root), "utf-8");
    const dfo = JSON.parse(raw);
    validateDfo(dfo);
    return dfo;
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

/**
 * 版本清單（升冪 = 舊→新）
 * 版本代號 v2 起 = Release Request id（RR-yyyymmdd-…）；首次 = "initial"（2026-11-21 Fleming）
 * 舊式 v1/v2/v3 檔相容。同代號多次寫入 = `代號~2`、`代號~3`…（快照不可變）
 */
export function listDfoVersions(root) {
  const dir = dfoVersionsDir(root);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter(f => /^(v\d+|[\w][\w.\-]*(~\d+)?)\.json$/.test(f))
      .map(f => ({ version: f.replace(/\.json$/, ""), file: f, _mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => a._mtime - b._mtime);
  } catch { return []; }
}

/** 讀指定版（預設最新） */
export function readDfoVersion(root, version) {
  const list = listDfoVersions(root);
  if (!list.length) return null;
  const v = version || list[list.length - 1].version;
  try {
    return JSON.parse(readFileSync(join(dfoVersionsDir(root), `${v}.json`), "utf-8"));
  } catch { return null; }
}

/** 抽出 AI:SKIP 人寫區塊（機械保留用） */
export function extractSkipBlocks(markdown) {
  const blocks = [];
  const re = /<!-- AI:SKIP-START -->[\s\S]*?<!-- AI:SKIP-END -->/g;
  let m;
  while ((m = re.exec(markdown || "")) !== null) blocks.push(m[0]);
  return blocks;
}

/**
 * 寫入 DFO（唯一入口）：
 * - sections 部分覆寫（只動傳入的 section id，其餘保留）
 * - 舊版同 section 有 AI:SKIP 區塊 → 機械接回新版尾端（AI 沒帶就補上，帶了就不重複）
 * - 自動 version+1、快照落 versions/、hash 留痕
 */
export function writeDfo(root, partialSections, updatedBy, label) {
  const prev = readDfo(root);
  const prevMap = new Map((prev?.sections || []).map(s => [s.id, s]));
  const sections = DFO_SECTIONS.map(def => {
    const incoming = partialSections?.find(s => s?.id === def.id);
    if (incoming && typeof incoming.markdown === "string" && incoming.markdown.trim()) {
      let md = incoming.markdown.trim();
      const oldSkips = extractSkipBlocks(prevMap.get(def.id)?.markdown || "");
      const newSkips = extractSkipBlocks(md);
      for (const skip of oldSkips) {
        if (!newSkips.some(n => n === skip)) md += `\n\n${skip}`;
      }
      return { id: def.id, title: def.title, markdown: md };
    }
    return prevMap.get(def.id) || { id: def.id, title: def.title, markdown: "" };
  });
  // 版本代號：無前版 → label 或 "initial"；有前版 → label（來自 RR）或沿用前代號
  const prevLabel = prev?.version ? String(prev.version) : null;
  const baseLabel = prev ? (label || prevLabel.replace(/~\d+$/, "")) : (label || "initial");
  const safeLabel = baseLabel.replace(/[^\w.\-]/g, "_");
  // 同代號第幾份快照
  const sameLabelCount = listDfoVersions(root).filter(v => v.version === safeLabel || v.version.startsWith(`${safeLabel}~`)).length;
  const versionStr = sameLabelCount === 0 ? safeLabel : `${safeLabel}~${sameLabelCount + 1}`;
  const versionNum = versionStr; // 快照檔名 = 代號（去掉可能的 vN 語意）
  const dfo = {
    schemaVersion: DFO_SCHEMA_VERSION,
    version: versionStr,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy || "greta",
    sections,
  };
  validateDfo(dfo);
  mkdirSync(dfoVersionsDir(root), { recursive: true });
  // 快照不可變：同版號已存在（重試情境）→ 內容一致就續用，不一致擋下
  const snapPath = join(dfoVersionsDir(root), `${versionNum}.json`);
  if (existsSync(snapPath)) {
    const old = readFileSync(snapPath, "utf-8");
    if (old !== JSON.stringify(dfo, null, 2)) throw new Error(`版本 ${versionNum} 已存在且內容不同 — 不可竄改歷史版本`);
  } else {
    writeFileSync(snapPath, JSON.stringify(dfo, null, 2), "utf-8");
  }
  writeFileSync(dfoPath(root), JSON.stringify(dfo, null, 2), "utf-8");
  return { ...dfo, _snapshot: snapPath, _hash: createHash("sha256").update(JSON.stringify(dfo)).digest("hex").slice(0, 12) };
}


/**
 * 凍結檢查（2026-11-21 Fleming：rr 單關了就不能改）
 * 現行版代號是 RR id 且該 RR 已 released/cancelled → 凍結，回原因字串；可改 → null
 */
export async function dfoFrozenReason(root) {
  let prev; try { prev = readDfo(root); } catch { return null; }
  const label = String(prev?.version || "").replace(/~\d+$/, "");
  if (!/^RR-/.test(label)) return null;
  try {
    const { getReleaseRequest } = await import("./release-requests.mjs");
    const rr = await getReleaseRequest(root, label);
    if (rr && (rr.status === "released" || rr.status === "cancelled")) {
      return `此 DFO 屬於已${rr.status === "released" ? "定案" : "取消"}的 ${label} — 已凍結不可修改；請建立新的 Release Request 再更新`;
    }
  } catch {}
  return null;
}
