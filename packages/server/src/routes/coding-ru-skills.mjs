/**
 * coding-ru-skills.mjs — RU Skill 管理 API（Skill Instance Model，2026-09-05）
 *
 * 「skill 是 Release Unit 的資產」— 管理 {ru}/.paaw/skills/ 內的實例。
 *
 *   GET    /ru-skills?path=&skillId=       — 狀態清單（RU 內 + 全域可用）；帶 skillId → 回單一 skill 內容
 *   POST   /ru-skills/sync   { path, skillId? } — 跟版 sync（全部或單一）
 *   POST   /ru-skills/add    { path, skillId }  — 從全域模板 clone 進 RU
 *   DELETE /ru-skills?path=&skillId=       — 移除 RU 內實例（同時解綁 crew）
 */

import { existsSync } from "fs";
import { join } from "path";
import { ruSkillStatus, syncRuSkills, provisionRuSkill, removeRuSkill, getRuSkillsDir } from "../lib/ru-skills.mjs";
import { allBoundSkillIds, updateAgentSkills, readJson, getConfigPath } from "../lib/project-crew.mjs";

function _json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function _readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}"); } catch { return {}; }
}

export default async function ruSkillsRoutes(req, res, next) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = new URL(rawUrl, "http://localhost").searchParams;

  if (!url.startsWith("/api/coding-project/ru-skills")) return next?.() ?? false;

  // ── GET — 狀態清單 / 單一 skill 內容 ──
  if (url === "/api/coding-project/ru-skills" && method === "GET") {
    const projectPath = q.get("path");
    if (!projectPath || !existsSync(projectPath)) return _json(res, 400, { error: "path required" }) || true;

    const skillId = q.get("skillId");
    if (skillId) {
      // 單一 skill：SKILL.md 原文（UI 檢視用）
      const { readFileSync } = await import("fs");
      const mdPath = join(getRuSkillsDir(projectPath), skillId, "SKILL.md");
      if (!existsSync(mdPath)) return _json(res, 404, { error: "skill not found" }) || true;
      return _json(res, 200, { ok: true, skillId, content: readFileSync(mdPath, "utf-8") }) || true;
    }

    try {
      const bound = allBoundSkillIds(projectPath);
      const result = ruSkillStatus(projectPath, bound);
      return _json(res, 200, { ok: true, ...result, boundCount: bound.length }) || true;
    } catch (err) {
      return _json(res, 500, { error: err.message }) || true;
    }
  }

  // ── POST /sync — 跟版（全部或單一） ──
  if (url === "/api/coding-project/ru-skills/sync" && method === "POST") {
    const body = await _readBody(req);
    const { path: projectPath, skillId } = body;
    if (!projectPath || !existsSync(projectPath)) return _json(res, 400, { error: "path required" }) || true;
    try {
      const summary = syncRuSkills(projectPath, skillId || null);
      return _json(res, 200, { ok: true, summary }) || true;
    } catch (err) {
      return _json(res, 500, { error: err.message }) || true;
    }
  }

  // ── POST /add — 從全域模板 clone 進 RU ──
  if (url === "/api/coding-project/ru-skills/add" && method === "POST") {
    const body = await _readBody(req);
    const { path: projectPath, skillId } = body;
    if (!projectPath || !existsSync(projectPath)) return _json(res, 400, { error: "path required" }) || true;
    if (!skillId) return _json(res, 400, { error: "skillId required" }) || true;
    const r = provisionRuSkill(projectPath, skillId);
    if (!r.ok) return _json(res, 404, { error: "template not found", skillId }) || true;
    return _json(res, 200, { ok: true, ...r }) || true;
  }

  // ── DELETE — 移除實例 + 從所有 crew 綁定解綁 ──
  if (url === "/api/coding-project/ru-skills" && method === "DELETE") {
    const projectPath = q.get("path");
    const skillId = q.get("skillId");
    if (!projectPath || !existsSync(projectPath)) return _json(res, 400, { error: "path required" }) || true;
    if (!skillId) return _json(res, 400, { error: "skillId required" }) || true;

    // 先從 crew 綁定拿掉（避免 dangling reference）
    try {
      const cfg = readJson(getConfigPath(projectPath), null);
      if (cfg?.skillBindings) {
        for (const [agentId, ids] of Object.entries(cfg.skillBindings)) {
          if (Array.isArray(ids) && ids.includes(skillId)) {
            updateAgentSkills(projectPath, agentId, ids.filter(i => i !== skillId));
          }
        }
      }
    } catch { /* 綁定讀不到就只刪檔案 */ }

    const r = removeRuSkill(projectPath, skillId);
    if (!r.ok) return _json(res, 404, { error: r.reason }) || true;
    return _json(res, 200, { ok: true }) || true;
  }

  return next?.() ?? false;
}
