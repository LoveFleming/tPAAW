/**
 * Skills CRUD API
 * Routes: /api/skills, /api/skills/:id, /api/skill-app/:id, /api/skill-builder/build-files
 */

import { readdir, readFile, writeFile, mkdir, rm, stat } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import {
  yaml,
  PAAW_ROOT, INPUT_PROMPT_ROOT, PHYSICAL_SKILL_ROOT, SKILL_POOL_ROOT,
  readBody,
} from "./shared.mjs";

// ── Helper: parse YAML frontmatter from SKILL.md ──
function parseSkillFrontmatter(raw) {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return { body: raw };
  const body = raw.slice(fmMatch[0].length).trim();
  const fm = fmMatch[1];
  try {
    const parsed = yaml.load(fm, { schema: yaml.DEFAULT_SCHEMA });
    if (typeof parsed === "object" && parsed !== null) {
      return { ...parsed, body };
    }
  } catch {}
  return { body };
}

export { parseSkillFrontmatter };

export default async function skillsApiRoute(req, res) {
  // ── GET /api/skills — list all skills ──
  if (req.method === "GET" && req.url?.match(/^\/api\/skills(?:\?.*)?$/)) {
    try {
      const skills = [];
      const scanSkillsDir = async (root, kind) => {
        let dirs;
        try { dirs = await readdir(root); } catch { return; }
        for (const dir of dirs) {
          try {
            const s = await stat(join(root, dir));
            if (!s.isDirectory()) continue;
            const skillPath = join(root, dir, "SKILL.md");
            let raw, parsed, skillPathResolved = skillPath;
            try {
              raw = await readFile(skillPath, "utf-8");
              parsed = parseSkillFrontmatter(raw);
            } catch {
              const inputsJsonPath = join(root, dir, "inputs.json");
              const inputsRaw = await readFile(inputsJsonPath, "utf-8");
              const inputsData = JSON.parse(inputsRaw);
              parsed = { name: dir, description: "", userInputs: inputsData.userInputs || [] };
              raw = JSON.stringify(parsed, null, 2);
              skillPathResolved = inputsJsonPath;
            }
            skills.push({
              id: dir, kind,
              name: parsed.name || dir,
              description: parsed.description || "",
              version: parsed.version || "1.0.0",
              category: parsed.category || "",
              skillPrompt: "",
              skillPath: skillPathResolved,
              useSkills: Array.isArray(parsed.useSkills) ? parsed.useSkills : [],
              usePhysicalSkills: Array.isArray(parsed.usePhysicalSkills) ? parsed.usePhysicalSkills : [],
              userInputs: Array.isArray(parsed.userInputs) ? parsed.userInputs : [],
              fullContent: raw,
            });
          } catch {}
        }
      };
      await scanSkillsDir(INPUT_PROMPT_ROOT, "input-prompt");
      await scanSkillsDir(PHYSICAL_SKILL_ROOT, "physical-skill");
      await scanSkillsDir(SKILL_POOL_ROOT, "skill-pool");

      // Dedup by skill id
      const deduped = [];
      const seen = new Map();
      for (const sk of skills) {
        const existing = seen.get(sk.id);
        if (existing) {
          if (existing.userInputs.length === 0 && sk.userInputs.length > 0) existing.userInputs = sk.userInputs;
          if (!existing.hasApp && sk.hasApp) existing.hasApp = true;
          if (sk.kind === "physical-skill") existing.kind = "physical-skill";
        } else {
          seen.set(sk.id, sk);
          deduped.push(sk);
        }
      }
      skills.length = 0;
      skills.push(...deduped);

      // Check hasApp
      for (const sk of skills) {
        try {
          const base = sk.kind === "physical-skill" ? PHYSICAL_SKILL_ROOT : sk.kind === "skill-pool" ? SKILL_POOL_ROOT : INPUT_PROMPT_ROOT;
          await import("fs/promises").then(m => m.access(join(base, sk.id, "app.html")));
          sk.hasApp = true;
        } catch { sk.hasApp = false; }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(skills));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── GET /api/skills/:id — get single skill ──
  const skillGetMatch = req.method === "GET" && req.url?.match(/^\/api\/skills\/([\w.-]+)(?:\?.*)?$/);
  if (skillGetMatch) {
    const skillId = skillGetMatch[1];
    const inputsJsonPath = join(INPUT_PROMPT_ROOT, skillId, "inputs.json");
    let inputsData = null;
    try {
      inputsData = JSON.parse(await readFile(inputsJsonPath, "utf-8"));
    } catch {}

    if (inputsData) {
      const found = {
        id: skillId, kind: "input-prompt",
        name: inputsData.name || skillId,
        description: inputsData.description || "",
        version: "1.0.0",
        skillPath: inputsJsonPath,
        userInputs: Array.isArray(inputsData.userInputs) ? inputsData.userInputs : [],
        fullContent: "",
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(found));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Skill not found" }));
    }
    return true;
  }

  // ── PUT /api/skills/:id — create or update ──
  if (req.method === "PUT" && req.url?.match(/^\/api\/skills\/([\w.-]+)(?:\?.*)?$/)) {
    const skillId = req.url.match(/^\/api\/skills\/([\w.-]+)/)?.[1];
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw);
      const content = payload.content;
      const kind = payload.kind || "input-prompt";
      if (!content || !skillId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing content or skillId" }));
        return true;
      }
      const baseRoot = kind === "physical-skill" ? PHYSICAL_SKILL_ROOT : kind === "skill-pool" ? SKILL_POOL_ROOT : INPUT_PROMPT_ROOT;
      const skillDir = join(baseRoot, skillId);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), content, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, id: skillId, kind }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── DELETE /api/skills/:id — delete ──
  if (req.method === "DELETE" && req.url?.match(/^\/api\/skills\/([\w.-]+)(?:\?.*)?$/)) {
    const skillId = req.url.match(/^\/api\/skills\/([\w.-]+)/)?.[1];
    try {
      const roots = [INPUT_PROMPT_ROOT, PHYSICAL_SKILL_ROOT, SKILL_POOL_ROOT];
      let deleted = false;
      for (const root of roots) {
        const skillDir = join(root, skillId);
        try {
          await rm(skillDir, { recursive: true, force: true });
          deleted = true;
        } catch {}
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, deleted }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── GET /api/skill-app/:id — serve app.html from skill ──
  const skillAppMatch = req.method === "GET" && req.url?.match(/^\/api\/skill-app\/([\w.-]+)(?:\?.*)?$/);
  if (skillAppMatch) {
    const skillId = skillAppMatch[1];
    const roots = [PHYSICAL_SKILL_ROOT, INPUT_PROMPT_ROOT];
    try {
      for (const root of roots) {
        const appPath = join(root, skillId, "app.html");
        try {
          const content = await readFile(appPath, "utf-8");
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(content);
          return true;
        } catch {}
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "app.html not found for skill: " + skillId }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── GET /api/skills/:id/export — export single skill as bundle ──
  const exportMatch = req.method === "GET" && req.url?.match(/^\/api\/skills\/([\w.-]+)\/export(?:\?.*)?$/);
  if (exportMatch) {
    const skillId = exportMatch[1];
    const bundle = {
      manifest: "paaw-skill-v1",
      exportedAt: new Date().toISOString(),
      skill: null,
      inputs: null,
      appHtml: null,
      extraFiles: {},
    };
    try {
      // Search all three roots for the skill
      const roots = [
        { root: INPUT_PROMPT_ROOT, kind: "input-prompt" },
        { root: PHYSICAL_SKILL_ROOT, kind: "physical-skill" },
        { root: SKILL_POOL_ROOT, kind: "skill-pool" },
      ];
      let found = false;
      for (const { root, kind } of roots) {
        const skillDir = join(root, skillId);
        try {
          const entries = await readdir(skillDir);
          for (const entry of entries) {
            const filePath = join(skillDir, entry);
            const s = await stat(filePath);
            if (s.isFile()) {
              const content = await readFile(filePath, "utf-8");
              if (entry === "SKILL.md") {
                bundle.skill = content;
                bundle.kind = kind;
              } else if (entry === "inputs.json") {
                bundle.inputs = JSON.parse(content);
              } else if (entry === "app.html") {
                bundle.appHtml = content;
              } else {
                bundle.extraFiles[entry] = content;
              }
            }
          }
          found = true;
          break; // found in this root
        } catch {}
      }
      if (!bundle.skill && !bundle.inputs) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Skill not found: ${skillId}` }));
        return true;
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${skillId}-skill.json"`,
      });
      res.end(JSON.stringify(bundle, null, 2));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── POST /api/skills/import — import skill bundle ──
  if (req.method === "POST" && req.url?.match(/^\/api\/skills\/import(?:\?.*)?$/)) {
    try {
      const bundle = JSON.parse(await readBody(req));
      if (bundle.manifest !== "paaw-skill-v1") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid bundle format. Expected manifest: paaw-skill-v1" }));
        return true;
      }
      if (!bundle.skill && !bundle.inputs) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Bundle missing skill data (SKILL.md or inputs.json)" }));
        return true;
      }
      // Determine target root from bundle.kind or default to skill-pool
      const kind = bundle.kind || "skill-pool";
      const targetRoot = kind === "physical-skill" ? PHYSICAL_SKILL_ROOT
        : kind === "input-prompt" ? INPUT_PROMPT_ROOT
        : SKILL_POOL_ROOT;

      // Extract skill id from SKILL.md frontmatter or use a provided id
      let skillId = bundle.skillId;
      if (!skillId && bundle.skill) {
        const fmMatch = bundle.skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmMatch) {
          const idMatch = fmMatch[1].match(/^id:\s*(.+)$/m);
          if (idMatch) skillId = idMatch[1].trim();
        }
      }
      if (!skillId && bundle.inputs?.skillId) skillId = bundle.inputs.skillId;
      if (!skillId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Cannot determine skill id from bundle" }));
        return true;
      }

      const skillDir = join(targetRoot, skillId);
      await mkdir(skillDir, { recursive: true });

      if (bundle.skill) {
        await writeFile(join(skillDir, "SKILL.md"), bundle.skill, "utf-8");
      }
      if (bundle.inputs) {
        await writeFile(join(skillDir, "inputs.json"), JSON.stringify(bundle.inputs, null, 2), "utf-8");
      }
      if (bundle.appHtml) {
        await writeFile(join(skillDir, "app.html"), bundle.appHtml, "utf-8");
      }
      if (bundle.extraFiles) {
        for (const [filename, content] of Object.entries(bundle.extraFiles)) {
          await writeFile(join(skillDir, filename), content, "utf-8");
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: `Skill「${skillId}」imported successfully`, skillId, kind }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── GET /api/skill-builder/build-files ──
  // Also accept legacy /api/skill-lab/build-files for backward compat
  if (req.method === "GET" && (req.url?.startsWith("/api/skill-builder/build-files") || req.url?.startsWith("/api/skill-lab/build-files"))) {
    try {
      const skillsDir = join(PAAW_ROOT, "data/skills");
      const results = [];
      try {
        const buildingDir = join(skillsDir, "building");
        await mkdir(buildingDir, { recursive: true });
        const bEntries = await readdir(buildingDir, { withFileTypes: true });
        for (const entry of bEntries) {
          if (entry.isFile() && /\.md$/i.test(entry.name) && !entry.name.startsWith("_")) {
            results.push({ name: "building/" + entry.name, path: join(buildingDir, entry.name) });
          } else if (entry.isDirectory()) {
            const srcFile = join(buildingDir, entry.name, "skill-source.md");
            try { await readFile(srcFile, "utf-8"); results.push({ name: "building/" + entry.name + "/skill-source.md", path: srcFile }); } catch {}
          }
        }
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(results));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── POST /api/skills/ai-generate — AI generates SKILL.md from requirement ──
  if (req.method === "POST" && req.url?.match(/^\/api\/skills\/ai-generate(?:\?.*)?$/)) {
    try {
      const { requirement = "", model } = JSON.parse(await readBody(req));
      if (!requirement.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "requirement is required" }));
        return true;
      }

      // Use direct LLM call (not agent loop) — we just want text output
      const { callLLMWithRetry } = await import("../lib/llm-utils.mjs");

      // Resolve LLM config inline (resolveLLMConfig not exported from agent loop)
      const { readFileSync: readSync } = await import("fs");
      const { resolve: resolvePath } = await import("path");
      const providerConfigPath = resolvePath(PAAW_ROOT, "data/config/providers.json");
      let llm;
      try {
        const pCfg = JSON.parse(readSync(providerConfigPath, "utf-8"));
        let providerId = pCfg.active;
        let llmModel = model || pCfg.defaultModel || "glm-5.1";
        // Parse "providerId/modelId" format
        if (model && model.includes("/")) {
          const idx = model.indexOf("/");
          providerId = model.slice(0, idx);
          llmModel = model.slice(idx + 1);
        } else if (llmModel.includes("/")) {
          // Strip provider prefix from default model if present
          llmModel = llmModel.split("/").pop();
        }
        const provider = pCfg.providers[providerId];
        if (!provider) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Provider '${providerId}' not found in config` }));
          return true;
        }
        const baseURL = provider.baseURL.replace(/\/+$/, "");
        const headers = { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` };
        if (providerId === "openrouter") { headers["HTTP-Referer"] = "https://agent-orchestrator.ai"; headers["X-Title"] = "Agent Orchestrator"; }
        llm = { apiUrl: `${baseURL}/chat/completions`, headers, model: llmModel };
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Failed to load provider config: ${err.message}` }));
        return true;
      }

      // Build full system context via context-engine (reads data/ai-settings/skill-builder/{phase}/*.md)
      const { contextEngine } = await import("../context-engine.mjs");
      const ctx = await contextEngine.build({ target: "skill-builder", phase: "build" });
      const systemPrompt = ctx.systemPrompt || "";
      // Output rules and generate prompt are now in data/ai-settings/skill-builder/build/*.md

      // Load generate prompt template
      let genPrompt = "";
      try { genPrompt = readFileSync(resolve(PAAW_ROOT, "data/ai-settings/skill-builder/build/generate-prompt.md"), "utf-8").trim(); } catch {}
      if (!genPrompt) genPrompt = "請根據以下需求，產出完整的 SKILL.md：";

      const result = await callLLMWithRetry(llm.apiUrl, llm.headers, {
        model: llm.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `${genPrompt}\n\n${requirement}` },
        ],
        max_tokens: 8192,
        temperature: 0.7,
      }, {
        maxRetries: 3,
        timeoutMs: 90_000,
        validateContent: true,
      });

      let content = (result.content || "").trim();
      // Strip markdown code fences if AI wrapped output (handle ```yaml, ```markdown, ```md, etc.)
      content = content.replace(/^```(?:[a-zA-Z]+)?\n?/m, "").replace(/\n?```$/m, "").trim();
      // Also strip leading non-frontmatter lines (e.g. stray "yaml" after fence removal)
      content = content.replace(/^(?!---)\s*\w+\s*\n(?=---)/, "").trim();

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ content }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
}
