/**
 * Skill routes — CRUD for skills (pool, input-prompt, physical-skill)
 */
import { readdir, readFile, writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { PATHS, readBody, json, urlPath, parseSkillFrontmatter } from "./context.mjs";

const ROOTS = [PATHS.INPUT_PROMPT_ROOT, PATHS.PHYSICAL_SKILL_ROOT, PATHS.SKILL_POOL_ROOT];
const ROOT_KINDS = ["input-prompt", "physical-skill", "skill-pool"];

async function scanSkillsDir(root, kind) {
  const skills = [];
  await mkdir(root, { recursive: true });
  const dirs = await readdir(root);
  for (const dir of dirs) {
    try {
      const { stat } = await import("fs/promises");
      const s = await stat(join(root, dir));
      if (!s.isDirectory()) continue;
      const raw = await readFile(join(root, dir, "SKILL.md"), "utf-8");
      const parsed = parseSkillFrontmatter(raw);
      skills.push({
        id: dir, kind,
        name: parsed.name || dir, description: parsed.description || "",
        version: parsed.version || "1.0.0", category: parsed.category || "",
        skillPrompt: parsed.body || "",
        useSkills: Array.isArray(parsed.useSkills) ? parsed.useSkills : [],
        usePhysicalSkills: Array.isArray(parsed.usePhysicalSkills) ? parsed.usePhysicalSkills : [],
        userInputs: Array.isArray(parsed.userInputs) ? parsed.userInputs : [],
        fullContent: raw,
      });
    } catch { /* skip */ }
  }
  return skills;
}

export default async function skillRoutes(req, res) {
  const path = urlPath(req);

  // GET /api/skills — list all
  if (req.method === "GET" && path.match(/^\/api\/skills(?:\?.*)?$/)) {
    try {
      const skills = [];
      for (let i = 0; i < ROOTS.length; i++) {
        skills.push(...await scanSkillsDir(ROOTS[i], ROOT_KINDS[i]));
      }
      for (const sk of skills) {
        const base = ROOT_KINDS.indexOf(sk.kind);
        try { const { access } = await import("fs/promises"); await access(join(ROOTS[base >= 0 ? base : 0], sk.id, "app.html")); sk.hasApp = true; } catch { sk.hasApp = false; }
      }
      json(res, skills);
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // GET /api/skills/:id — get single
  const getMatch = req.method === "GET" && path.match(/^\/api\/skills\/([\w.-]+)(?:\?.*)?$/);
  if (getMatch) {
    const skillId = getMatch[1];
    try {
      for (let i = 0; i < ROOTS.length; i++) {
        const skillPath = join(ROOTS[i], skillId, "SKILL.md");
        try {
          const raw = await readFile(skillPath, "utf-8");
          const parsed = parseSkillFrontmatter(raw);
          json(res, { id: skillId, kind: ROOT_KINDS[i], name: parsed.name || skillId, description: parsed.description || "", version: parsed.version || "1.0.0", category: parsed.category || "", skillPrompt: parsed.body || "", useSkills: Array.isArray(parsed.useSkills) ? parsed.useSkills : [], usePhysicalSkills: Array.isArray(parsed.usePhysicalSkills) ? parsed.usePhysicalSkills : [], userInputs: Array.isArray(parsed.userInputs) ? parsed.userInputs : [], fullContent: raw });
          return true;
        } catch {}
      }
      json(res, { error: "Skill not found" }, 404);
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // PUT /api/skills/:id — create or update
  const putMatch = req.method === "PUT" && path.match(/^\/api\/skills\/([\w.-]+)$/);
  if (putMatch) {
    const skillId = putMatch[1];
    try {
      const { kind = "input-prompt", content } = JSON.parse(await readBody(req));
      if (!content || !skillId) { json(res, { error: "Missing content or skillId" }, 400); return true; }
      const baseRoot = kind === "physical-skill" ? PATHS.PHYSICAL_SKILL_ROOT : kind === "skill-pool" ? PATHS.SKILL_POOL_ROOT : PATHS.INPUT_PROMPT_ROOT;
      const skillDir = join(baseRoot, skillId);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), content, "utf-8");
      json(res, { ok: true, id: skillId, kind });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // DELETE /api/skills/:id
  const delMatch = req.method === "DELETE" && path.match(/^\/api\/skills\/([\w.-]+)$/);
  if (delMatch) {
    const skillId = delMatch[1];
    try {
      let deleted = false;
      for (const root of ROOTS) {
        const skillDir = join(root, skillId);
        try { await rm(skillDir, { recursive: true, force: true }); deleted = true; } catch {}
      }
      json(res, deleted ? { ok: true } : { error: "Not found" }, deleted ? 200 : 404);
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // GET /api/paaw/skills/:appId/:skillId/inputs — get skill userInputs
  const inputsMatch = path.match(/^\/api\/paaw\/skills\/([^/]+)\/([^/]+)\/inputs$/);
  if (req.method === "GET" && inputsMatch) {
    try {
      const [, appId, skillId] = inputsMatch;
      let content;
      try { content = await readFile(join(PATHS.APPS_ROOT, appId, "skills", skillId, "SKILL.md"), "utf-8"); }
      catch { try { content = await readFile(join(PATHS.SKILL_POOL_ROOT, skillId, "SKILL.md"), "utf-8"); } catch { json(res, { error: "Skill not found" }, 404); return true; } }
      const parsed = parseSkillFrontmatter(content);
      json(res, { skillId, appId, userInputs: parsed.userInputs || [] });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  return false;
}
