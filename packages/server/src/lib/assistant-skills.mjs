/**
 * assistant-skills.mjs — 個人助理（林雨晴）技能綁定 + 實體（2026-10-09 Fleming）
 *
 * 需求：給林雨晴掛 skill；綁定與實體都存 paaw data（跟著使用者走）。
 *   - 綁定：data/assistant-skills.json  → { skills: ["nextjs-developer", ...] }
 *   - 實體：data/assistant-skills/<id>/（從 data/skills/<kind>/<id>/ 複製，帶 _paaw.json sidecar）
 *   - Prompt：context-engine `_buildChat()` 注入「已啟用技能 + 路徑 + 內容」
 *
 * 與 coding RU 的 Skill Instance Model 同精神，但根目錄是 data/assistant-skills/（非 {ru}/.paaw/skills/）。
 */
import { resolve, join, basename } from "node:path";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { DATA_HOME } from "../data-home.mjs";

export const ASSISTANT_SKILLS_DIR = resolve(DATA_HOME, "assistant-skills");
export const ASSISTANT_SKILLS_BINDINGS = resolve(DATA_HOME, "assistant-skills.json");

// 全域 skill 模板庫來源
const SOURCE_DIRS = [
  { dir: resolve(DATA_HOME, "skills", "physical-skill"), kind: "physical" },
  { dir: resolve(DATA_HOME, "skills", "input-prompt"), kind: "input-prompt" },
  { dir: resolve(DATA_HOME, "skills", "pool"), kind: "pool" },
];

// ── 讀寫綁定 ──
export function getBoundSkills() {
  try {
    const j = JSON.parse(readFileSync(ASSISTANT_SKILLS_BINDINGS, "utf-8"));
    return Array.isArray(j.skills) ? j.skills : [];
  } catch { return []; }
}

export function setBoundSkills(ids) {
  const clean = [...new Set((ids || []).filter(x => typeof x === "string" && /^[\w.-]+$/.test(x)))];
  mkdirSync(resolve(ASSISTANT_SKILLS_BINDINGS, ".."), { recursive: true });
  writeFileSync(ASSISTANT_SKILLS_BINDINGS, JSON.stringify({ skills: clean }, null, 2));
  // provision 新綁定、清掉已解除的
  const existing = existsSync(ASSISTANT_SKILLS_DIR) ? readdirSync(ASSISTANT_SKILLS_DIR) : [];
  for (const id of clean) if (!existing.includes(id)) provisionAssistantSkill(id);
  for (const id of existing) if (!clean.includes(id)) { try { rmSync(join(ASSISTANT_SKILLS_DIR, id), { recursive: true, force: true }); } catch {} }
  return clean;
}

// ── 掃描可用 skill ──
function _metaFromSkillMd(raw, fallbackId) {
  const name = raw.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") || fallbackId;
  const description = raw.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
  const domain = raw.match(/^\s*domain:\s*(.+)$/m)?.[1]?.trim() || "";
  return { name, description, domain };
}

export function listAvailableSkills() {
  const out = [];
  const seen = new Set();
  for (const { dir, kind } of SOURCE_DIRS) {
    if (!existsSync(dir)) continue;
    for (const id of readdirSync(dir).sort()) {
      if (seen.has(id)) continue;
      const skillMd = join(dir, id, "SKILL.md");
      if (!existsSync(skillMd)) continue;
      try {
        const raw = readFileSync(skillMd, "utf-8");
        const m = _metaFromSkillMd(raw, id);
        out.push({ id, kind, sourcePath: join(dir, id), ...m });
        seen.add(id);
      } catch {}
    }
  }
  return out;
}

function findSkillDir(id) {
  for (const { dir } of SOURCE_DIRS) {
    const p = join(dir, id);
    if (existsSync(join(p, "SKILL.md"))) return p;
  }
  return null;
}

function _hash(s) { return createHash("sha256").update(s).digest("hex").slice(0, 16); }

export function provisionAssistantSkill(id) {
  const src = findSkillDir(id);
  if (!src) return false;
  const dest = join(ASSISTANT_SKILLS_DIR, id);
  try {
    mkdirSync(ASSISTANT_SKILLS_DIR, { recursive: true });
    cpSync(src, dest, { recursive: true });
    const raw = readFileSync(join(src, "SKILL.md"), "utf-8");
    writeFileSync(join(dest, "_paaw.json"), JSON.stringify({
      id, source: src, templateHash: _hash(raw), provisionedAt: new Date().toISOString(),
    }, null, 2));
    return true;
  } catch { return false; }
}

/** 讀實體（優先 data/assistant-skills/，fallback 模板庫） */
export function readAssistantSkill(id) {
  const inst = join(ASSISTANT_SKILLS_DIR, id, "SKILL.md");
  const src = join(ASSISTANT_SKILLS_DIR, id);
  if (existsSync(inst)) {
    const raw = readFileSync(inst, "utf-8");
    return { id, path: src, ..._metaFromSkillMd(raw, id), content: raw };
  }
  const dir = findSkillDir(id);
  if (!dir) return null;
  const raw = readFileSync(join(dir, "SKILL.md"), "utf-8");
  return { id, path: dir, ..._metaFromSkillMd(raw, id), content: raw };
}

/** 目錄內附件（非 SKILL.md/_paaw.json）絕對路徑，供 read_file */
function _listFiles(dir) {
  const SKIP = new Set(["SKILL.md", "_paaw.json", "_cron_inputs.json"]);
  const out = [];
  (function walk(d) {
    let entries; try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); }
      else if (!SKIP.has(e.name) && statSync(p).size < 512 * 1024) out.push(p);
    }
  })(dir);
  return out;
}

const MAX_SKILL_CHARS = 6000;

/** Prompt 段落：已啟用技能清單 + 路徑 + 內容（Fleming：提示詞要多加 skill 路徑與可用清單） */
export function buildAssistantSkillsPrompt() {
  const bound = getBoundSkills();
  if (bound.length === 0) return "";
  const items = [];
  for (const id of bound) {
    const s = readAssistantSkill(id);
    if (!s) continue;
    let block = `### Skill: ${s.name} (id: ${s.id})\n- 技能目錄：${s.path}`;
    const files = _listFiles(s.path);
    if (files.length) block += `\n- 附件檔案（需要時用 read_file 讀取）：\n${files.map(f => `  - ${f}`).join("\n")}`;
    let body = s.content;
    if (body.length > MAX_SKILL_CHARS) body = body.slice(0, MAX_SKILL_CHARS) + "\n...(略)";
    block += `\n\n${body}`;
    items.push(block);
  }
  if (!items.length) return "";
  return `## 已啟用技能 (Skills)\n以下是你（個人助理）可使用並須遵循的技能定義；技能規則優先於一般做法。技能實體存放於 \`${ASSISTANT_SKILLS_DIR}\`。\n\n${items.join("\n\n---\n\n")}`;
}
