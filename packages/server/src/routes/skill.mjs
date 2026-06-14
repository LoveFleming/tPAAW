/**
 * Skill routes — CRUD for skills (pool, input-prompt, physical-skill)
 */
import { readdir, readFile, writeFile, mkdir, rm, rename, stat } from "fs/promises";
import { join, resolve } from "path";
import { PATHS, readBody, json, urlPath, parseSkillFrontmatter } from "./context.mjs";

const ROOTS = [PATHS.INPUT_PROMPT_ROOT, PATHS.PHYSICAL_SKILL_ROOT, PATHS.SKILL_POOL_ROOT];
const ROOT_KINDS = ["input-prompt", "physical-skill", "skill-pool"];

// Recursive copy directory
async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      const content = await readFile(srcPath);
      await writeFile(destPath, content);
    }
  }
}

// List all files in a directory (relative paths)
async function listFiles(dir, prefix = "") {
  const results = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...await listFiles(join(dir, entry.name), rel));
      } else {
        results.push(rel);
      }
    }
  } catch {}
  return results;
}

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

  // POST /api/skills/:id/publish — clone entire skill dir from building/ to target
  const pubMatch = req.method === "POST" && path.match(/^\/api\/skills\/([\w.-]+)\/publish$/);
  if (pubMatch) {
    const skillId = pubMatch[1];
    try {
      const { target = "physical-skill" } = JSON.parse(await readBody(req));
      const srcDir = join(PATHS.BUILDING_ROOT, skillId);
      const targetRoot = target === "input-prompt" ? PATHS.INPUT_PROMPT_ROOT
        : target === "skill-pool" ? PATHS.SKILL_POOL_ROOT
        : PATHS.PHYSICAL_SKILL_ROOT;
      const destDir = join(targetRoot, skillId);

      // Check source SKILL.md exists
      try { await readFile(join(srcDir, "SKILL.md"), "utf-8"); }
      catch { json(res, { error: `Skill not found in building/: ${skillId}` }, 404); return true; }

      // Recursive copy entire directory
      await mkdir(destDir, { recursive: true });
      await copyDir(srcDir, destDir);

      // Extract userInputs from SKILL.md frontmatter → write to input-prompt/ (interface definition)
      const skillMd = await readFile(join(destDir, "SKILL.md"), "utf-8");
      const parsed = parseSkillFrontmatter(skillMd);
      if (parsed.userInputs && parsed.userInputs.length > 0) {
        const inputPromptDir = join(PATHS.INPUT_PROMPT_ROOT, skillId);
        await mkdir(inputPromptDir, { recursive: true });
        await writeFile(
          join(inputPromptDir, "inputs.json"),
          JSON.stringify({ skillId, userInputs: parsed.userInputs }, null, 2),
          "utf-8"
        );
      }

      // Keep original in building/ as source code
      json(res, {
        ok: true, id: skillId, kind: target,
        path: destDir, sourcePath: srcDir,
        files: await listFiles(destDir),
      });
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

  // GET /api/contexts/skill-builder/:file — get AI settings for skill builder
  const ctxMatch = req.method === "GET" && path.match(/^\/api\/contexts\/skill-builder\/([\w.-]+)$/);
  if (ctxMatch) {
    const fileName = ctxMatch[1];
    try {
      const content = await readFile(join(CONTEXT_ROOT, fileName), "utf-8");
      json(res, { content });
    } catch {
      json(res, { content: "" }, 404);
    }
    return true;
  }

  // PUT /api/contexts/skill-builder/:file — update AI settings
  const ctxPutMatch = req.method === "PUT" && path.match(/^\/api\/contexts\/skill-builder\/([\w.-]+)$/);
  if (ctxPutMatch) {
    const fileName = ctxPutMatch[1];
    try {
      const { content } = JSON.parse(await readBody(req));
      if (!content) { json(res, { error: "Missing content" }, 400); return true; }
      await mkdir(CONTEXT_ROOT, { recursive: true });
      await writeFile(join(CONTEXT_ROOT, fileName), content, "utf-8");
      json(res, { ok: true });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  return false;
}
