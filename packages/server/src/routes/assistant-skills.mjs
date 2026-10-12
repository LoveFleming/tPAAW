/**
 * assistant-skills route — 個人助理（林雨晴）技能綁定 API（2026-10-09 Fleming）
 *   GET  /api/assistant-skills          → { available: [...], bound: [...] }
 *   PUT  /api/assistant-skills          → body { skills: [...] } 儲存綁定 + provision 實體
 *   GET  /api/assistant-skills/content/:id → 單一技能內容
 */
import { readBody } from "./shared.mjs";
import { json } from "./context.mjs";
import {
  listAvailableSkills, getBoundSkills, setBoundSkills, readAssistantSkill, ASSISTANT_SKILLS_DIR,
} from "../lib/assistant-skills.mjs";

export default async function assistantSkillsRoute(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  if (path === "/api/assistant-skills" && req.method === "GET") {
    try {
      json(res, {
        available: listAvailableSkills(),
        bound: getBoundSkills(),
        storeDir: ASSISTANT_SKILLS_DIR,
      });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  if (path === "/api/assistant-skills" && req.method === "PUT") {
    try {
      const body = JSON.parse(await readBody(req));
      const ids = Array.isArray(body.skills) ? body.skills : [];
      const saved = setBoundSkills(ids);
      json(res, { ok: true, bound: saved });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  const m = path.match(/^\/api\/assistant-skills\/content\/([\w.-]+)$/);
  if (m && req.method === "GET") {
    try {
      const s = readAssistantSkill(m[1]);
      if (!s) { json(res, { error: "skill not found" }, 404); return true; }
      json(res, s);
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  return false;
}
