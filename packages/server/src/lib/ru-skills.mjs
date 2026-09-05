/**
 * ru-skills.mjs — Skill Instance Model（2026-09-05）
 *
 * Skill 是 Release Unit 的資產：clone 進 {ru}/.paaw/skills/{skillId}/，
 * 跟著 RU 存檔、移機、handover。全域 data/skills/ 只是上游模板庫。
 *
 * 模板 → 實例（跟 crew _templateHash 同一套心智模型）：
 *   - provision：從全域模板 copy 進 RU + sidecar _paaw.json 記 templateHash
 *   - sync：RU 副本未客製化（本地 hash == 種入 hash）→ 模板更新自動跟版；
 *           客製過（hash 不符）→ 不動，UI 標「已客製」
 *   - 解析：readRuSkillContent 只看 {ru}/.paaw/skills/，單一路徑，無全域 fallback
 *
 * Sidecar _paaw.json：{ sourceKind, templateHash, syncedAt }
 * （不放 SKILL.md frontmatter — 內嵌 hash 會讓客製偵測雞生蛋）
 */
import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync, copyFileSync } from "fs";
import { join, resolve } from "path";
import { DATA_HOME } from "../data-home.mjs";

// ── 路徑 ──

export function getRuSkillsDir(projectDir) {
  return resolve(projectDir, ".paaw", "skills");
}

/** 全域模板 roots（catalog 上游） */
function _globalRoots() {
  return [
    { dir: resolve(DATA_HOME, "skills", "physical-skill"), kind: "physical" },
    { dir: resolve(DATA_HOME, "skills", "input-prompt"), kind: "input" },
    { dir: resolve(DATA_HOME, "skills", "building"), kind: "building" },
  ];
}

// ── 模板尋找 / 雜湊 ──

const SKIP_COPY = new Set([".DS_Store", "_paaw.json"]);
const SKIP_DIRS = new Set([".git", "node_modules"]);

/** 在全域 catalog 找 skill → { dir, kind, mainFile, hash }；找不到回 null */
export function findGlobalSkill(skillId) {
  if (!skillId || typeof skillId !== "string" || /[/\\]/.test(skillId)) return null; // 防 path traversal
  for (const { dir, kind } of _globalRoots()) {
    const skillDir = join(dir, skillId);
    if (!existsSync(skillDir)) continue;
    for (const mainFile of ["SKILL.md", "inputs.json"]) {
      const p = join(skillDir, mainFile);
      if (existsSync(p)) {
        return { dir: skillDir, kind, mainFile, hash: _hashFile(p) };
      }
    }
  }
  return null;
}

function _hashFile(p) {
  try {
    return createHash("sha256").update(readFileSync(p)).digest("hex");
  } catch {
    return null;
  }
}

function _hashDirMain(skillDir) {
  for (const mainFile of ["SKILL.md", "inputs.json"]) {
    const p = join(skillDir, mainFile);
    if (existsSync(p)) return _hashFile(p);
  }
  return null;
}

// ── 遞迴 copy（跨平台，純 node — 不用 cp -r） ──

function _copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP_COPY.has(e.name) || SKIP_DIRS.has(e.name)) continue;
    const s = join(src, e.name);
    const d = join(dest, e.name);
    if (e.isDirectory()) _copyTree(s, d);
    else if (e.isFile()) copyFileSync(s, d);
  }
}

// ── Sidecar ──

function _readSidecar(skillDir) {
  try { return JSON.parse(readFileSync(join(skillDir, "_paaw.json"), "utf-8")); } catch { return null; }
}
function _writeSidecar(skillDir, data) {
  writeFileSync(join(skillDir, "_paaw.json"), JSON.stringify({ ...data, syncedAt: new Date().toISOString() }, null, 2));
}

// ── Provision / Sync / Status ──

/** 從全域模板 clone 一個 skill 進 RU。已存在 → 不覆蓋（回 alreadyExists）。 */
export function provisionRuSkill(projectDir, skillId) {
  const g = findGlobalSkill(skillId);
  if (!g) return { ok: false, reason: "template-not-found" };
  const dest = join(getRuSkillsDir(projectDir), skillId);
  if (existsSync(dest)) {
    // 已有副本但缺 sidecar（手動放的）→ 補 sidecar 對齊，讓跟版機制接手
    if (!_readSidecar(dest)) _writeSidecar(dest, { sourceKind: g.kind, templateHash: g.hash });
    return { ok: true, alreadyExists: true, path: dest };
  }
  _copyTree(g.dir, dest);
  _writeSidecar(dest, { sourceKind: g.kind, templateHash: g.hash });
  return { ok: true, alreadyExists: false, path: dest };
}

export function provisionRuSkills(projectDir, skillIds) {
  const results = { provisioned: [], exists: [], missing: [] };
  for (const id of skillIds || []) {
    const r = provisionRuSkill(projectDir, id);
    if (!r.ok) results.missing.push(id);
    else if (r.alreadyExists) results.exists.push(id);
    else results.provisioned.push(id);
  }
  return results;
}

/** 跟版 sync（冪等）：
 *  - synced：本地 == 模板（最新）
 *  - updated：未客製 + 模板更新 → 已重 copy
 *  - customized：本地 hash != 種入 hash → 不動
 *  - orphan：全域模板已不存在
 *  - broken：本地目錄在但主檔案不見（手動刪）→ 重 provision
 */
export function syncRuSkills(projectDir, onlySkillId = null) {
  const skillsDir = getRuSkillsDir(projectDir);
  const summary = [];
  if (!existsSync(skillsDir)) return summary;
  for (const name of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const id = name.name;
    if (onlySkillId && id !== onlySkillId) continue;
    const skillDir = join(skillsDir, id);
    const sidecar = _readSidecar(skillDir);
    const localHash = _hashDirMain(skillDir);
    const g = findGlobalSkill(id);

    if (!localHash) {
      // 主檔案不見 — 模板還在就重建
      if (g) { rmSync(skillDir, { recursive: true, force: true }); _copyTree(g.dir, skillDir); _writeSidecar(skillDir, { sourceKind: g.kind, templateHash: g.hash }); summary.push({ id, action: "restored" }); }
      else summary.push({ id, action: "orphan" });
      continue;
    }
    if (!g) { summary.push({ id, action: "orphan" }); continue; }

    const templateHash = sidecar?.templateHash || null;
    const customized = templateHash && localHash !== templateHash;

    if (customized) { summary.push({ id, action: "customized" }); continue; }

    if (localHash !== g.hash) {
      // 未客製 + 模板有新版 → 跟版（整目錄重 copy，保留 sidecar 時間戳重寫）
      rmSync(skillDir, { recursive: true, force: true });
      _copyTree(g.dir, skillDir);
      _writeSidecar(skillDir, { sourceKind: g.kind, templateHash: g.hash });
      summary.push({ id, action: "updated" });
    } else {
      if (!templateHash) _writeSidecar(skillDir, { sourceKind: g.kind, templateHash: g.hash }); // 手動副本補 sidecar
      summary.push({ id, action: "synced" });
    }
  }
  return summary;
}

/** UI 用狀態清單：RU 內 skills + 全域 catalog 還沒進 RU 的可用清單 */
export function ruSkillStatus(projectDir, boundSkillIds = []) {
  const skillsDir = getRuSkillsDir(projectDir);
  const skills = [];
  if (existsSync(skillsDir)) {
    for (const name of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const id = name.name;
      const skillDir = join(skillsDir, id);
      const sidecar = _readSidecar(skillDir);
      const localHash = _hashDirMain(skillDir);
      const g = findGlobalSkill(id);
      const bound = boundSkillIds.includes(id);

      let status;
      if (!localHash) status = "broken";
      else if (!g) status = "orphan";
      else if (sidecar?.templateHash && localHash !== sidecar.templateHash) status = "customized";
      else if (localHash !== g.hash) status = "behind";   // 未客製 + 模板有新版
      else status = "synced";

      skills.push({
        id,
        name: _skillName(skillDir, id),
        status,
        bound,
        syncedAt: sidecar?.syncedAt || null,
        updatedAt: _mtime(skillDir),
      });
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));

  // 全域可用（未進 RU）
  const inRu = new Set(skills.map(s => s.id));
  const available = [];
  for (const { dir } of _globalRoots()) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (!name.isDirectory() || inRu.has(name.name)) continue;
      const skillDir = join(dir, name.name);
      if (!existsSync(join(skillDir, "SKILL.md")) && !existsSync(join(skillDir, "inputs.json"))) continue;
      available.push({ id: name.name, name: _skillName(skillDir, name.name) });
    }
  }
  available.sort((a, b) => a.name.localeCompare(b.name));
  return { skills, available };
}

function _skillName(skillDir, id) {
  try {
    const md = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    const m = md.match(/^name:\s*(.+)$/m);
    if (m) return m[1].trim();
  } catch {}
  try {
    const data = JSON.parse(readFileSync(join(skillDir, "inputs.json"), "utf-8"));
    if (data.name) return data.name;
  } catch {}
  return id;
}

function _mtime(p) {
  try { return statSync(p).mtimeMs; } catch { return null; }
}

/** 移除 RU 內 skill 實例（UI 確認後才呼叫；客製化內容會丟 — 前端要警告） */
export function removeRuSkill(projectDir, skillId) {
  if (!skillId || /[/\\]/.test(skillId)) return { ok: false, reason: "invalid-id" };
  const dest = join(getRuSkillsDir(projectDir), skillId);
  if (!existsSync(dest)) return { ok: false, reason: "not-found" };
  rmSync(dest, { recursive: true, force: true });
  return { ok: true };
}

// ── 解析（單一路徑，無全域 fallback） ──

/**
 * 讀 RU 內 skill prompt 內容。只看 {ru}/.paaw/skills/{skillId}/。
 * 回傳形狀與舊 readSkillContent 相同：{ name, prompt, skillDir }
 */
export function readRuSkillContent(projectDir, skillId) {
  if (!skillId || /[/\\]/.test(skillId)) return null;
  const skillDir = join(getRuSkillsDir(projectDir), skillId);

  // SKILL.md
  try {
    const raw = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    const nameMatch = raw.match(/^name:\s*(.+)$/m);
    const bodyMatch = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    return {
      name: (nameMatch && nameMatch[1]) || skillId,
      prompt: bodyMatch ? bodyMatch[1].trim() : raw,
      skillDir,
    };
  } catch {}

  // inputs.json
  try {
    const data = JSON.parse(readFileSync(join(skillDir, "inputs.json"), "utf-8"));
    return { name: data.name || skillId, prompt: data.description || data.systemPrompt || `Skill: ${skillId}` };
  } catch {}

  return null;
}
