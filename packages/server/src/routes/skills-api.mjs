/**
 * Skills CRUD API
 * Routes: /api/skills, /api/skills/:id, /api/skill-app/:id, /api/skill-lab/build-files
 */

import { readdir, readFile, writeFile, mkdir, rm, stat } from "fs/promises";
import { existsSync } from "fs";
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

  // ── GET /api/skill-lab/build-files ──
  if (req.method === "GET" && req.url?.startsWith("/api/skill-lab/build-files")) {
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
        const provider = pCfg.providers[pCfg.active];
        const llmModel = model || pCfg.defaultModel || provider?.models?.[0]?.id || "glm-5.1";
        const baseURL = provider.baseURL.replace(/\/+$/, "");
        const headers = { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` };
        if (pCfg.active === "openrouter") { headers["HTTP-Referer"] = "https://paaw.ai"; headers["X-Title"] = "PAAW"; }
        llm = { apiUrl: `${baseURL}/chat/completions`, headers, model: llmModel };
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Failed to load provider config: ${err.message}` }));
        return true;
      }

      // Load skill format rules for consistent output
      let skillFormat = "";
      try {
        const { readFile: rf } = await import("fs/promises");
        const fmtPath = join(PAAW_ROOT, "data/ai-settings/skill-builder/skill-format.md");
        skillFormat = await rf(fmtPath, "utf-8");
      } catch {}

      const systemPrompt = `你是 PAAW Skill 建構專家。根據使用者的需求描述，產出完整的 SKILL.md 內容。

${skillFormat ? `### Skill Format Rules\n${skillFormat}` : ""}

### Output Rules
- 輸出必須是完整的 SKILL.md 檔案內容，包含 YAML frontmatter 和 markdown body
- frontmatter 必須包含: id, name, version, description, userInputs
- body 必須包含以下 section（用 @@@section@@@ 分隔）：
  @@@purpose@@@ — 這個 Skill 做什麼
  @@@inputs@@@ — 需要什麼輸入（可省略，已在 frontmatter 定義）
  @@@steps@@@ — 執行步驟
  @@@output@@@ — 輸出格式
  @@@error_handling@@@ — 錯誤處理
  @@@guardrails@@@ — 安全限制
  @@@validation@@@ — 驗證規則
- 每個 section 都要寫實際內容，不要留空
- 語言：繁體中文
- id 用英文 kebab-case
- 只輸出 SKILL.md 內容，不加任何解釋或 markdown code fence
- 不要使用任何工具，直接輸出文字`;

      const result = await callLLMWithRetry(llm.apiUrl, llm.headers, {
        model: llm.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `請根據以下需求，產出完整的 SKILL.md：\n\n${requirement}` },
        ],
        max_tokens: 8192,
        temperature: 0.7,
      }, {
        maxRetries: 3,
        timeoutMs: 90_000,
        validateContent: true,
      });

      let content = (result.content || "").trim();
      // Strip markdown code fences if AI wrapped output
      content = content.replace(/^```(?:markdown|md)?\n?/m, "").replace(/\n?```$/m, "").trim();

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
