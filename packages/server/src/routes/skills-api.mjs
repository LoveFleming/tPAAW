/**
 * Skills CRUD API
 * Routes: /api/skills, /api/skills/:id, /api/skill-app/:id, /api/skill-builder/build-files
 */

import { readdir, readFile, writeFile, mkdir, rm, stat } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { join, resolve, dirname } from "path";
import {
  yaml,
  PAAW_ROOT, INPUT_PROMPT_ROOT, PHYSICAL_SKILL_ROOT, SKILL_POOL_ROOT,
  readBody,
} from "./shared.mjs";
import { resolveDefaultModel } from "../lib/llm-utils.mjs";
import { DATA_HOME } from "../data-home.mjs";

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

  // ── POST /api/skills/import-zip — import skill from zip（Management Skills 頁）──
  // zip 內含一個 skill 資料夾（或根層直接放 SKILL.md / inputs.json）。
  // 可選 ?kind=physical-skill|input-prompt|skill-pool、?id=<skill-id>
  // 預設：含 SKILL.md → physical-skill；只有 inputs.json → input-prompt
  if (req.method === "POST" && req.url?.match(/^\/api\/skills\/import-zip(?:\?.*)?$/)) {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const buf = Buffer.concat(chunks);
      if (buf.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Empty body — 上傳 zip 檔案" }));
        return true;
      }
      if (buf.length > 20 * 1024 * 1024) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "zip 太大（上限 20MB）" }));
        return true;
      }

      const AdmZip = (await import("adm-zip")).default;
      const zip = new AdmZip(buf);
      const urlObj = new URL(req.url, "http://localhost");
      const kindParam = urlObj.searchParams.get("kind");
      const idParam = urlObj.searchParams.get("id");

      // 收集檔案 entries（跳過目錄、垃圾檔）
      const JUNK = new Set([".DS_Store", "__MACOSX"]);
      const entries = zip.getEntries().filter(e => {
        if (e.isDirectory) return false;
        const parts = e.entryName.split("/");
        return !parts.some(p => JUNK.has(p));
      });
      if (entries.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "zip 裡沒有檔案" }));
        return true;
      }

      // zip-slip 防護 + 偵測共同根資料夾
      let commonRoot = null;
      for (const e of entries) {
        const name = e.entryName;
        if (name.startsWith("/") || name.split("/").includes("..")) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `不合法的路徑: ${name}` }));
          return true;
        }
        const top = name.split("/")[0];
        commonRoot = commonRoot === null ? top : (commonRoot === top ? commonRoot : null);
        if (commonRoot === null && name.includes("/")) {
          // 多個不同頂層 + 有子目錄 = 混亂結構，仍允續（以根層檔案為準）
        }
      }
      const hasSubdirs = entries.some(e => e.entryName.includes("/"));
      const rootFolder = hasSubdirs && entries.every(e => e.entryName.split("/")[0] === commonRoot) ? commonRoot : null;
      const stripPrefix = rootFolder ? rootFolder + "/" : "";
      const files = entries.map(e => ({
        path: e.entryName.slice(stripPrefix.length),
        data: e.getData(),
      })).filter(f => f.path.length > 0);

      const names = new Set(files.map(f => f.path));
      const hasSkillMd = names.has("SKILL.md");
      const hasInputs = names.has("inputs.json");
      if (!hasSkillMd && !hasInputs) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "zip 裡找不到 SKILL.md 或 inputs.json（可放在根層或單一資料夾內）" }));
        return true;
      }

      // skill id：?id= > SKILL.md frontmatter > 資料夾名 > zip 檔名
      let skillId = idParam;
      if (!skillId && hasSkillMd) {
        const raw = files.find(f => f.path === "SKILL.md").data.toString("utf-8");
        const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        const idm = fm && fm[1].match(/^id:\s*(.+)$/m);
        if (idm) skillId = idm[1].trim();
      }
      if (!skillId && !hasInputs) skillId = rootFolder;
      if (!skillId && hasInputs) {
        try { skillId = JSON.parse(files.find(f => f.path === "inputs.json").data.toString("utf-8")).skillId; } catch {}
      }
      if (!skillId) {
        const cd = req.headers["content-disposition"] || "";
        const m = cd.match(/filename="?([^";]+)\.zip"?/i);
        if (m) skillId = m[1].replace(/[^\w.-]/g, "-");
      }
      if (!skillId || !/^[\w.-]+$/.test(skillId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "無法決定 skill id（可加 ?id= 指定）" }));
        return true;
      }

      const kind = kindParam || (hasSkillMd ? "physical-skill" : "input-prompt");
      const targetRoot = kind === "input-prompt" ? INPUT_PROMPT_ROOT
        : kind === "skill-pool" ? SKILL_POOL_ROOT
        : PHYSICAL_SKILL_ROOT;
      const skillDir = join(targetRoot, skillId);
      await mkdir(skillDir, { recursive: true });
      for (const f of files) {
        const dest = join(skillDir, f.path);
        if (!dest.startsWith(skillDir)) continue; // 雙保險
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, f.data);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: `Skill「${skillId}」已從 zip 匯入（${files.length} 檔案）`, skillId, kind, files: files.length }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `zip 匯入失敗: ${err.message}` }));
    }
    return true;
  }

  // ── GET /api/skill-builder/build-files ──
  // Also accept legacy /api/skill-lab/build-files for backward compat
  if (req.method === "GET" && (req.url?.startsWith("/api/skill-builder/build-files") || req.url?.startsWith("/api/skill-lab/build-files"))) {
    try {
      const skillsDir = join(DATA_HOME, "skills");
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

      // Use resolveLLMConfig for consistent provider + fallback chain resolution
      const { resolveLLMConfig } = await import("../lib/paaw-agent-loop.mjs");
      let llm;
      try {
        llm = resolveLLMConfig(PAAW_ROOT, model || undefined);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Failed to load provider config: ${err.message}` }));
        return true;
      }

      // Build system context from generate-specific rules (NOT build phase)
      // generate phase has its own rules for creating from scratch
      const { contextEngine } = await import("../context-engine.mjs");
      const ctx = await contextEngine.build({ target: "skill-builder", phase: "generate" });
      const systemPrompt = ctx.systemPrompt || "";

      // Load generate prompt template (user-facing prompt template)
      let genPrompt = "";
      try { genPrompt = readFileSync(resolve(DATA_HOME, "ai-settings/skill-builder/generate/generate-prompt.md"), "utf-8").trim(); } catch {}
      if (!genPrompt) genPrompt = "請根據以下需求，產出完整的 SKILL.md：";

      const userMessage = `${genPrompt}\n\n${requirement}`;

      console.log(`[SkillBuilder] AI generate — requirement: ${requirement.slice(0, 80)}... model: ${llm.model}, provider: ${llm.providerId}`);

      const result = await callLLMWithRetry(llm.apiUrl, llm.headers, {
        model: llm.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: llm.maxTokens || 16384,
        temperature: 0.7,
      }, {
        disableThinking: true, // skill 執行=deterministic 腳本輸出（2026-08-30）
        maxRetries: 3,
        timeoutMs: 900_000,
        validateContent: true,
        caller: "skill-builder",
        agentId: "skill-builder",
        fallbacks: llm.fallbacks || [],
      });

      let content = (result.content || "").trim();
      console.log(`[SkillBuilder] AI generate result — ${content.length} chars, preview: ${content.slice(0, 100)}`);
      // Strip markdown code fences if AI wrapped output (handle ```yaml, ```markdown, ```md, etc.)
      content = content.replace(/^```(?:[a-zA-Z]+)?\n?/m, "").replace(/\n?```$/m, "").trim();
      // Also strip leading non-frontmatter lines (e.g. stray "yaml" after fence removal)
      content = content.replace(/^(?!---)\s*\w+\s*\n(?=---)/, "").trim();

      // ── Quality check: ensure required sections exist ──
      const requiredSections = ["purpose", "steps", "output", "guardrails", "validation"];
      const missingSections = requiredSections.filter(s => {
        const hasAt = content.includes(`@@@${s}@@@`);
        const hasHash = content.includes(`## ${s.charAt(0).toUpperCase() + s.slice(1)}`);
        return !hasAt && !hasHash;
      });
      if (missingSections.length > 0) {
        console.log(`[SkillBuilder] Missing sections: ${missingSections.join(", ")}, appending defaults`);
        const defaults = {
          validation: `\n@@@validation@@@\n1. 結果格式符合 Output Contract 定義\n2. 所有必填欄位都有值\n3. 無安全違規（guardrails 未觸發）`,
          guardrails: `\n@@@guardrails@@@\n- 只處理使用者提供的輸入，不存取外部系統\n- 不執行有安全風險的操作`,
          output: `\n@@@output@@@\n輸出模式：both\n結果直接顯示，如指定 output_path 則同時存檔`,
          steps: `\n@@@steps@@@\n### Tool Access\n- read_file, write_file\n\n### Execution Steps\n1. 讀取使用者輸入\n2. 根據 Purpose 執行處理\n3. 格式化輸出\n\n### Business Rules\n- 確保輸出格式一致\n\n### Error Handling\n- 輸入為空：提示使用者提供必要資訊\n- 處理失敗：回傳錯誤訊息`,
          purpose: `\n@@@purpose@@@\n根據使用者需求執行指定任務`,
        };
        for (const s of missingSections) {
          if (defaults[s]) content += defaults[s];
        }
        console.log(`[SkillBuilder] After patch: ${content.length} chars`);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ content, systemPrompt, userMessage }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
}
