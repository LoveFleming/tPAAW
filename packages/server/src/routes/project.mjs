/**
 * Project Route — .paaw/ project knowledge API
 *
 * Endpoints:
 *   GET    /api/coding-project/context?path=...        — Get full .paaw/ context
 *   POST   /api/coding-project/init?path=...           — Initialize .paaw/ directory
 *   GET    /api/coding-project/tree?path=...           — Get .paaw/ directory tree
 *   GET    /api/coding-project/sessions?path=...       — List sessions
 *   GET    /api/coding-project/sessions/:filename?path=... — Read specific session
 *   GET    /api/coding-project/standards?path=...      — List standards
 *   GET    /api/coding-project/standards/:name?path=...— Read standard
 *   PUT    /api/coding-project/standards/:name?path=...— Write standard
 *   GET    /api/coding-project/decisions?path=...      — Read decisions
 *   POST   /api/coding-project/decisions?path=...      — Add decision
 *   GET    /api/coding-project/changelog?path=...      — Read changelog
 *   GET    /api/coding-project/file?path=...&file=...  — Read any .paaw/ file
 *   PUT    /api/coding-project/file?path=...&file=...  — Write any .paaw/ file
 *   POST   /api/coding-project/generate-overview?path=... — Auto-generate PROJECT.md
 */

import { readFile, writeFile, readdir, mkdir, unlink } from "fs/promises";
import { existsSync, readFileSync as readSync } from "fs";
import { resolve, join, dirname } from "path";
import { exec as execCb } from "child_process";
import { createPaawProject } from "../lib/paaw-project.mjs";
import { callLLMWithRetry } from "../lib/llm-utils.mjs";

// ── LLM Call Helper for project routes ──
// Resolves provider config and calls LLM with proper 4-arg signature
async function callProjectLLM(rootDir, body, opts = {}) {
  // rootDir here is the paawRoot (PAAW server root, NOT user's project root)
  // providers.json lives at {PAAW_ROOT}/data/config/providers.json
  // Since paawRoot is computed as 5 dirs up from this file,
  // it resolves to the PAAW server root
  const providersFile = join(rootDir, "data", "config", "providers.json");
  let providerConfig;
  try { providerConfig = JSON.parse(readSync(providersFile, "utf8")); } catch { return { content: null }; }
  const providerId = providerConfig.active || "zai";
  const model = body.model || providerConfig.defaultModel || "glm-5.1";
  const provider = providerConfig.providers[providerId];
  if (!provider?.apiKey || provider.apiKey === "na") { return { content: null }; }
  const apiUrl = `${provider.baseURL.replace(/\/+$/, "")}/chat/completions`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
    ...(providerId === "openrouter" ? { "HTTP-Referer": "https://paaw.ai", "X-Title": "PAAW" } : {}),
  };
  const reqBody = {
    model,
    messages: body.messages,
    temperature: body.temperature ?? 0.3,
    max_tokens: body.maxTokens ?? 4000,
  };
  return callLLMWithRetry(apiUrl, headers, reqBody, {
    maxRetries: opts.maxRetries ?? 3,
    timeoutMs: opts.timeoutMs ?? 60_000,
    validateContent: true,
    sanitize: true,
  });
}

// ── Query parser ──

function parseQuery(url) {
  const u = new URL(url, "http://localhost");
  const params = {};
  u.searchParams.forEach((v, k) => { params[k] = v; });
  return params;
}

// ── Route Handler ──

export default async function projectRoute(req, res) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = parseQuery(rawUrl);

  // All routes start with /api/coding-project
  if (!url.startsWith("/api/coding-project")) return false;

  const projectPath = q.path;
  if (!projectPath) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing 'path' query parameter" }));
    return true;
  }

  const root = resolve(projectPath);
  const paaw = createPaawProject(root);

  try {
    // ── GET /api/coding-project/context ──
    if (url.startsWith("/api/coding-project/context") && method === "GET") {
      const ctx = await paaw.loadContext();
      if (!ctx) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: ".paaw/ not initialized", initialized: false }));
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ initialized: true, ...ctx }));
      return true;
    }

    // ── POST /api/coding-project/init ──
    if (url.startsWith("/api/coding-project/init") && method === "POST") {
      const result = await paaw.init();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // ── GET /api/coding-project/tree ──
    if (url.startsWith("/api/coding-project/tree") && method === "GET") {
      const tree = await paaw.listTree();
      if (!tree) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: ".paaw/ not initialized" }));
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(tree));
      return true;
    }

    // ── GET /api/coding-project/sessions/:filename ──
    const sessionMatch = url.match(/^\/api\/project\/sessions\/([^?]+)/);
    if (sessionMatch && method === "GET") {
      const content = await paaw.readSession(decodeURIComponent(sessionMatch[1]));
      if (content === null) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
      } else {
        res.writeHead(200, { "Content-Type": "text/markdown" });
        res.end(content);
      }
      return true;
    }

    // ── GET /api/coding-project/sessions ──
    if (url.startsWith("/api/coding-project/sessions") && method === "GET") {
      const sessions = await paaw.listSessions();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(sessions));
      return true;
    }

    // ── GET /api/coding-project/standards ──
    if (url.startsWith("/api/coding-project/standards") && !url.match(/\/api\/project\/standards\/[^?]+/) && method === "GET") {
      const standards = await paaw.listStandards();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(standards));
      return true;
    }

    // ── GET/PUT /api/coding-project/standards/:name ──
    const stdMatch = url.match(/^\/api\/project\/standards\/([^?]+)/);
    if (stdMatch) {
      const name = decodeURIComponent(stdMatch[1]);
      if (method === "GET") {
        const content = await paaw.readStandard(name);
        if (content === null) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Standard not found" }));
        } else {
          res.writeHead(200, { "Content-Type": "text/markdown" });
          res.end(content);
        }
        return true;
      }
      if (method === "PUT") {
        const body = await readBody(req);
        const result = await paaw.writeStandard(name, body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return true;
      }
    }

    // ── GET /api/coding-project/decisions ──
    if (url.startsWith("/api/coding-project/decisions") && method === "GET") {
      const content = await paaw.readFile("DECISIONS.md");
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(content || "");
      return true;
    }

    // ── POST /api/coding-project/decisions ──
    if (url.startsWith("/api/coding-project/decisions") && method === "POST") {
      const body = JSON.parse(await readBody(req));
      const result = await paaw.addDecision(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // ── GET /api/coding-project/changelog ──
    if (url.startsWith("/api/coding-project/changelog") && method === "GET") {
      const content = await paaw.readFile("CHANGELOG.md");
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(content || "");
      return true;
    }

    // ── GET /api/coding-project/file ──
    if (url.startsWith("/api/coding-project/file") && method === "GET" && q.file) {
      const content = await paaw.readFile(q.file);
      if (content === null) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "File not found" }));
      } else {
        res.writeHead(200, { "Content-Type": "text/markdown" });
        res.end(content);
      }
      return true;
    }

    // ── PUT /api/coding-project/file ──
    if (url.startsWith("/api/coding-project/file") && method === "PUT" && q.file) {
      const body = await readBody(req);
      const result = await paaw.writeFile(q.file, body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // ── POST /api/coding-project/generate-overview ──
    if (url.startsWith("/api/coding-project/generate-overview") && method === "POST") {
      // Ensure .paaw/ exists first
      if (!paaw.exists) await paaw.init();
      const content = await paaw.generateProjectOverview();
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(content);
      return true;
    }

    // ── GET /api/coding-project/templates ──
    if (url.startsWith("/api/coding-project/templates") && method === "GET") {
      const templatesDir = resolve(join(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..", "data", "templates", "standards"));
      const templates = [];
      try {
        const entries = await readdir(templatesDir);
        for (const name of entries.filter(f => f.endsWith(".md")).sort()) {
          const content = await readFile(join(templatesDir, name), "utf-8");
          // Extract title from first heading
          const titleLine = content.split("\n").find(l => l.startsWith("# "));
          const title = titleLine ? titleLine.replace(/^#\s*/, "") : name.replace(".md", "");
          templates.push({ name, title, preview: content.slice(0, 200) });
        }
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(templates));
      return true;
    }

    // ── GET /api/coding-project/templates/:name ──
    const tplMatch = url.match(/^\/api\/project\/templates\/([^?]+)/);
    if (tplMatch && method === "GET") {
      const templatesDir = resolve(join(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..", "data", "templates", "standards"));
      const name = decodeURIComponent(tplMatch[1]);
      const filePath = join(templatesDir, name);
      try {
        const content = await readFile(filePath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/markdown" });
        res.end(content);
      } catch {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Template not found" }));
      }
      return true;
    }

    // ── POST /api/coding-project/import-template ──
    if (url.startsWith("/api/coding-project/import-template") && method === "POST") {
      const body = JSON.parse(await readBody(req));
      const templateName = body.template; // e.g. "typescript.md"
      const targetName = body.target || templateName; // save as
      if (!templateName) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing 'template' field" }));
        return true;
      }
      const templatesDir = resolve(join(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..", "data", "templates", "standards"));
      try {
        const content = await readFile(join(templatesDir, templateName), "utf-8");
        // Ensure .paaw/ exists
        if (!paaw.exists) await paaw.init();
        await paaw.writeStandard(targetName, content);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, name: targetName, size: content.length }));
      } catch {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Template not found" }));
      }
      return true;
    }

    // ── POST /api/coding-project/generate-standards ──
    // Uses LLM to analyze codebase and generate coding standards
    if (url.startsWith("/api/coding-project/generate-standards") && method === "POST") {
      if (!paaw.exists) await paaw.init();
      const generated = await generateStandardsFromCodebase(root);
      if (generated) {
        await paaw.writeStandard("auto-generated.md", generated);
      }
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(generated || "# Failed to generate standards");
      return true;
    }

    // ── GET /api/coding-project/all ──
    // Returns everything needed for the right-panel tabs in one call
    if (url.startsWith("/api/coding-project/all") && method === "GET") {
      if (!paaw.exists) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ initialized: false }));
        return true;
      }
      const [context, sessions, standards, decisions, changelog] = await Promise.all([
        paaw.loadContext(),
        paaw.listSessions(),
        paaw.listStandards(),
        paaw.readFile("DECISIONS.md"),
        paaw.readFile("CHANGELOG.md"),
      ]);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        initialized: true,
        context,
        sessions,
        standards,
        decisions,
        changelog,
      }));
      return true;
    }

    // ── GET /api/coding-project/health ──
    if (url.startsWith("/api/coding-project/health") && method === "GET") {
      const health = await collectProjectHealth(root, paaw);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(health));
      return true;
    }

    // ── Snapshot endpoints ──

    // POST /api/coding-project/snapshot — create manual snapshot
    if (url.startsWith("/api/coding-project/snapshot") && method === "POST" && !url.includes("/restore")) {
      const { PaawSnapshot } = await import("../lib/paaw-snapshot.mjs");
      const snap = new PaawSnapshot(root, paaw.paawDir);
      if (!paaw.exists) await paaw.init();
      const body = JSON.parse(await readBody(req) || "{}");
      const result = await snap.create(body.label || "manual");
      await snap.cleanup(50);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // GET /api/coding-project/snapshots — list snapshots
    if (url.startsWith("/api/coding-project/snapshots") && method === "GET") {
      const { PaawSnapshot } = await import("../lib/paaw-snapshot.mjs");
      const snap = new PaawSnapshot(root, paaw.paawDir);
      const list = await snap.list();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(list));
      return true;
    }

    // POST /api/coding-project/snapshot/restore — restore file from snapshot
    if (url.startsWith("/api/coding-project/snapshot/restore") && method === "POST") {
      const { PaawSnapshot } = await import("../lib/paaw-snapshot.mjs");
      const snap = new PaawSnapshot(root, paaw.paawDir);
      const body = JSON.parse(await readBody(req));
      const result = await snap.restoreFile(body.snapshot, body.file);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // ── Git tracking strategy ──

    // GET /api/coding-project/git-strategy — get .paaw gitignore status
    if (url.startsWith("/api/coding-project/git-strategy") && method === "GET") {
      const gitignorePath = join(root, ".gitignore");
      let paawTracked = true;
      let gitignoreContent = "";
      if (existsSync(gitignorePath)) {
        gitignoreContent = readSync(gitignorePath, "utf-8");
        paawTracked = !gitignoreContent.includes(".paaw/");
      }
      // Check if .paaw/ is already committed
      let committed = false;
      try {
        const check = await runShellCmd(`git ls-files .paaw/`, root, 5000);
        committed = check.trim().length > 0;
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ paawTracked, committed, gitignoreHasPaaw: !paawTracked }));
      return true;
    }

    // PUT /api/coding-project/git-strategy — set strategy
    if (url.startsWith("/api/coding-project/git-strategy") && method === "PUT") {
      const body = JSON.parse(await readBody(req));
      const strategy = body.strategy; // "track" | "ignore" | "branch"
      const gitignorePath = join(root, ".gitignore");
      let gitignoreContent = existsSync(gitignorePath) ? readSync(gitignorePath, "utf-8") : "";

      if (strategy === "ignore") {
        if (!gitignoreContent.includes(".paaw/")) {
          gitignoreContent = gitignoreContent.trimEnd() + "\n# PAAW AI-Native IDE\n.paaw/\n";
          await writeFile(gitignorePath, gitignoreContent, "utf-8");
        }
      } else if (strategy === "track") {
        // Remove .paaw/ from gitignore if present
        gitignoreContent = gitignoreContent
          .replace(/^\.paaw\/$/gm, "")
          .replace(/^# PAAW AI-Native IDE$/gm, "")
          .replace(/\n{3,}/g, "\n\n");
        await writeFile(gitignorePath, gitignoreContent, "utf-8");
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, strategy }));
      return true;
    }

    // ── AI Initialize — multi-step project knowledge auto-fill ──

    // POST /api/coding-project/ai-initial
    if (url.startsWith("/api/coding-project/ai-initial") && method === "POST") {
      const steps = [
        { id: "scan", name: "🔍 掃描專案結構", promptFile: "scan-project.md" },
        { id: "api-spec", name: "📝 產出 API Spec", promptFile: "gen-api-spec.md" },
        { id: "error-mapping", name: "🐛 產出 Error Mapping", promptFile: "gen-error-mapping.md" },
        { id: "test-payload", name: "🧪 產出 API Test Payload", promptFile: "gen-test-payload.md" },
        { id: "standards", name: "📏 產出 Coding Standards", promptFile: "gen-standards.md" },
        { id: "faq", name: "🤖 產出 HelpDesk FAQ", promptFile: "gen-faq.md" },
        { id: "overview", name: "📊 產出 PROJECT.md", promptFile: "gen-overview.md" },
      ];

      // SSE stream — send progress as each step completes
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        // Ensure .paaw/ exists
        await paaw.init();

        // Gather project info for context
        let projectContext = `Project root: ${root}\n`;
        try {
          const pkg = JSON.parse(readSync(join(root, "package.json"), "utf-8"));
          projectContext += `Package: ${pkg.name || "unknown"}\nDependencies: ${Object.keys(pkg.dependencies || {}).join(", ")}\n`;
        } catch {}

        // Get file tree
        try {
          const treeOutput = await runShellCmd("find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.paaw/*' -not -name '*.map' | head -200", root);
          projectContext += `\nFile tree:\n${treeOutput}`;
        } catch {}

        // Get recent git log
        try {
          const gitLog = await runShellCmd("git log --oneline -20", root);
          projectContext += `\nRecent git log:\n${gitLog}`;
        } catch {}

        // Load prompt templates
        const promptsDir = resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..", "data", "prompts", "ai-initial");
        const loadPrompt = (filename) => {
          try { return readSync(resolve(promptsDir, filename), "utf-8"); } catch { return ""; }
        };

        // Check project-level overrides in .paaw/prompts/ai-initial/
        const loadProjectPrompt = (filename) => {
          const overridePath = join(root, ".paaw", "prompts", "ai-initial", filename);
          if (existsSync(overridePath)) {
            try { return readSync(overridePath, "utf-8"); } catch {}
          }
          return loadPrompt(filename);
        };

        // Accumulate context from previous steps
        let scanResult = "";
        let apiSpecResult = "";
        let errorMappingResult = "";

        for (const step of steps) {
          sendEvent("step_start", { step: step.id, name: step.name });

          const promptTemplate = loadProjectPrompt(step.promptFile);
          if (!promptTemplate) {
            sendEvent("step_skip", { step: step.id, name: step.name, reason: "Prompt template not found" });
            continue;
          }

          // Build full prompt with accumulated context
          let fullPrompt = promptTemplate;
          fullPrompt += `\n\n--- PROJECT CONTEXT ---\n${projectContext}`;
          if (scanResult) fullPrompt += `\n\n--- SCAN RESULTS ---\n${scanResult}`;
          if (step.id === "api-spec" || step.id === "test-payload" || step.id === "error-mapping") {
            // These steps benefit from scan results
          }
          if (apiSpecResult && (step.id === "test-payload" || step.id === "faq" || step.id === "overview")) {
            fullPrompt += `\n\n--- API SPEC ---\n${apiSpecResult}`;
          }
          if (errorMappingResult && (step.id === "faq" || step.id === "overview")) {
            fullPrompt += `\n\n--- ERROR MAPPING ---\n${errorMappingResult}`;
          }

          // Call LLM
          try {
            const paawRoot = resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..");
            const result = await callProjectLLM(paawRoot, {
              messages: [{ role: "user", content: fullPrompt }],
              temperature: 0.2,
              maxTokens: 4000,
            });

            const content = result.content || "";

            // Store results
            if (step.id === "scan") {
              scanResult = content;
            } else if (step.id === "api-spec") {
              apiSpecResult = content;
              await paaw.writeFile("specs/api-contract.md", content);
            } else if (step.id === "error-mapping") {
              errorMappingResult = content;
              // Save error mapping table
              const mappingMatch = content.match(/\|.*Code.*\|.*Type.*\|.*\n([\s\S]*?)(?=\n[^|]|$)/);
              if (mappingMatch) {
                await paaw.writeFile("specs/error-codes.md", content);
              } else {
                await paaw.writeFile("specs/error-codes.md", content);
              }
              // Extract individual runbooks from content
              const runbookMatches = [...content.matchAll(/## Runbook[:\s]+(\d+).*?\n([\s\S]*?)(?=\n## Runbook|\n---|$)/g)];
              for (const rm of runbookMatches) {
                await paaw.writeFile(`runbook/${rm[1]}.md`, `# Runbook: ${rm[1]}\n\n${rm[2].trim()}`);
              }
            } else if (step.id === "test-payload") {
              // Parse JSON test payloads and save individually
              await paaw.writeFile("test-payloads/all-payloads.json", content);
              // Try to parse and save individual payloads
              try {
                const payloads = JSON.parse(content);
                if (Array.isArray(payloads)) {
                  for (const p of payloads) {
                    const slug = (p.endpoint || p.name || "unknown").replace(/[^a-zA-Z0-9-]/g, "-");
                    await paaw.writeFile(`test-payloads/${slug}.json`, JSON.stringify(p, null, 2));
                  }
                } else if (payloads.endpoint) {
                  const slug = payloads.endpoint.replace(/[^a-zA-Z0-9-]/g, "-");
                  await paaw.writeFile(`test-payloads/${slug}.json`, JSON.stringify(payloads, null, 2));
                }
              } catch {
                // If LLM didn't return valid JSON, save raw content
              }
            } else if (step.id === "standards") {
              await paaw.writeFile("standards/coding-style.md", content);
            } else if (step.id === "faq") {
              await paaw.writeFile("helpdesk/faq.md", content);
            } else if (step.id === "overview") {
              await paaw.writeFile("PROJECT.md", content);
            }

            sendEvent("step_done", {
              step: step.id,
              name: step.name,
              size: content.length,
              preview: content.slice(0, 200),
            });
          } catch (err) {
            sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
          }
        }

        sendEvent("done", { message: "AI Initialize complete" });
      } catch (err) {
        sendEvent("error", { error: err.message });
      }

      res.end();
      return true;
    }

// ── Domain AI — specialized AI per area ──

    // POST /api/coding-project/domain-ai — run a domain AI
    if (url.startsWith("/api/coding-project/domain-ai") && method === "POST") {
      const { domain, prompt, history } = JSON.parse(await readBody(req));
      const validDomains = ["spec", "test", "bug", "docs", "maintain"];
      if (!validDomains.includes(domain)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Invalid domain: ${domain}. Valid: ${validDomains.join(", ")}` }));
        return true;
      }

      // SSE stream
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        // Load domain system prompt
        const promptsBase = resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..", "data", "prompts");
        const domainPromptDir = join(promptsBase, `${domain}-ai`);
        const systemPromptFile = resolve(promptsBase, "domain-ai-system.md");
        let systemPrompt = "";
        try { systemPrompt = readSync(systemPromptFile, "utf-8"); } catch {}

        // Load all domain prompts
        let domainContext = "";
        try {
          const domainFiles = await readdir(domainPromptDir);
          for (const f of domainFiles.filter(f => f.endsWith(".md")).sort()) {
            domainContext += `\n--- ${f} ---\n${readSync(resolve(domainPromptDir, f), "utf-8")}`;
          }
        } catch {}

        // Check project-level overrides
        const projectPromptDir = join(root, ".paaw", "prompts", `${domain}-ai`);
        if (existsSync(projectPromptDir)) {
          try {
            const pFiles = await readdir(projectPromptDir);
            for (const f of pFiles.filter(f => f.endsWith(".md")).sort()) {
              domainContext += `\n--- PROJECT OVERRIDE: ${f} ---\n${readSync(resolve(projectPromptDir, f), "utf-8")}`;
            }
          } catch {}
        }

        // Load relevant .paaw/ context based on domain
        let paawContext = "";
        const domainPaawFiles = {
          spec: ["specs/api-contract.md", "specs/error-codes.md", "specs/node-contract.md", "specs/flow-spec.md"],
          test: ["specs/api-contract.md", "test-payloads/all-payloads.json"],
          bug: ["specs/error-codes.md", "DECISIONS.md"],
          docs: ["PROJECT.md", "helpdesk/faq.md", "CHANGELOG.md"],
          maintain: ["CODING-STANDARDS.md", "DECISIONS.md"],
        };
        for (const f of domainPaawFiles[domain] || []) {
          const content = await paaw.readFile(f);
          if (content) paawContext += `\n=== ${f} ===\n${content.slice(0, 3000)}\n`;
        }

        // Also load standards dir for maintain
        if (domain === "maintain") {
          const stdFiles = await paaw.listStandards();
          for (const sf of stdFiles) {
            const c = await paaw.readStandard(sf.name);
            if (c) paawContext += `\n=== standards/${sf.name} ===\n${c.slice(0, 1500)}\n`;
          }
        }

        // Load runbooks for bug
        if (domain === "bug") {
          const rbDir = join(paaw.paawDir, "runbook");
          if (existsSync(rbDir)) {
            try {
              const rbFiles = await readdir(rbDir);
              for (const rf of rbFiles.filter(f => f.endsWith(".md")).slice(0, 10)) {
                const c = await readFile(join(rbDir, rf), "utf-8");
                paawContext += `\n=== runbook/${rf} ===\n${c.slice(0, 1000)}\n`;
              }
            } catch {}
          }
        }

        // Build full system prompt
        const fullSystemPrompt = `${systemPrompt}\n\n## Your Domain: ${domain.toUpperCase()}\n${domainContext}\n\n## Project Knowledge\n${paawContext}`;

        // Build messages
        const messages = [{ role: "system", content: fullSystemPrompt }];
        // Add history
        if (Array.isArray(history)) {
          for (const m of history.slice(-10)) {
            messages.push({ role: m.role, content: m.content });
          }
        }
        messages.push({ role: "user", content: prompt });

        // Call LLM
        const paawRoot = resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..");
        const result = await callProjectLLM(paawRoot, {
          messages,
          temperature: 0.3,
          maxTokens: 4000,
        });

        sendEvent("done", { content: result.content || "" });
      } catch (err) {
        sendEvent("error", { error: err.message });
      }
      res.end();
      return true;
    }

    // GET /api/coding-project/status — Code Status Dashboard scores
    if (url.startsWith("/api/coding-project/status") && method === "GET") {
      try {
        const scores = await paaw.computeStatus();
        if (!scores) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ initialized: false, scores: null }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ initialized: true, scores }));
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // POST /api/coding-project/ai-fix — targeted fix for a specific area
    if (url.startsWith("/api/coding-project/ai-fix") && method === "POST") {
      const { area } = JSON.parse(await readBody(req));
      const areaPrompts = {
        spec: ["scan-project.md", "gen-api-spec.md", "gen-error-mapping.md"],
        test: ["scan-project.md", "gen-test-payload.md"],
        bug: ["gen-error-mapping.md"],
        docs: ["gen-faq.md", "gen-overview.md"],
        maintain: ["gen-standards.md"],
      };
      const prompts = areaPrompts[area] || [];
      if (prompts.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Unknown area: ${area}` }));
        return true;
      }

      // SSE stream
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        await paaw.init();

        let projectContext = `Project root: ${root}\n`;
        try {
          const pkg = JSON.parse(readSync(join(root, "package.json"), "utf-8"));
          projectContext += `Package: ${pkg.name || "unknown"}\n`;
        } catch {}
        try {
          const treeOutput = await runShellCmd("find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.paaw/*' -not -name '*.map' | head -200", root);
          projectContext += `\nFile tree:\n${treeOutput}`;
        } catch {}

        const promptsDir = resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..", "data", "prompts", "ai-initial");
        const loadPrompt = (filename) => {
          const overridePath = join(root, ".paaw", "prompts", "ai-initial", filename);
          if (existsSync(overridePath)) {
            try { return readSync(overridePath, "utf-8"); } catch {}
          }
          try { return readSync(resolve(promptsDir, filename), "utf-8"); } catch { return ""; }
        };

        // Load existing .paaw context for the fix
        const existingSpec = await paaw.readFile("specs/api-contract.md");
        const existingErrors = await paaw.readFile("specs/error-codes.md");

        for (const pf of prompts) {
          const stepName = pf.replace(/\.md$/, "");
          sendEvent("step_start", { step: stepName, name: `🔧 Fixing ${area}: ${stepName}` });

          const promptTemplate = loadPrompt(pf);
          if (!promptTemplate) {
            sendEvent("step_skip", { step: stepName, reason: "Prompt not found" });
            continue;
          }

          let fullPrompt = promptTemplate + `\n\n--- PROJECT CONTEXT ---\n${projectContext}`;
          if (existingSpec) fullPrompt += `\n\n--- EXISTING API SPEC ---\n${existingSpec}`;
          if (existingErrors) fullPrompt += `\n\n--- EXISTING ERROR MAPPING ---\n${existingErrors}`;
          fullPrompt += `\n\n--- INSTRUCTION ---\nOnly fill in gaps. Do not regenerate content that already exists and is correct.`;

          try {
            const paawRoot = resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..");
            const result = await callProjectLLM(paawRoot, {
              messages: [{ role: "user", content: fullPrompt }],
              temperature: 0.2,
              maxTokens: 4000,
            });
            const content = result.content || "";

            // Save based on prompt type
            if (pf.includes("api-spec")) await paaw.writeFile("specs/api-contract.md", content);
            else if (pf.includes("error-mapping")) {
              await paaw.writeFile("specs/error-codes.md", content);
              const runbookMatches = [...content.matchAll(/## Runbook[:\s]+(\d+).*?\n([\s\S]*?)(?=\n## Runbook|\n---|$)/g)];
              for (const rm of runbookMatches) {
                await paaw.writeFile(`runbook/${rm[1]}.md`, `# Runbook: ${rm[1]}\n\n${rm[2].trim()}`);
              }
            } else if (pf.includes("test-payload")) await paaw.writeFile("test-payloads/all-payloads.json", content);
            else if (pf.includes("standards")) await paaw.writeFile("standards/coding-style.md", content);
            else if (pf.includes("faq")) await paaw.writeFile("helpdesk/faq.md", content);
            else if (pf.includes("overview")) await paaw.writeFile("PROJECT.md", content);
            else if (pf.includes("scan")) { /* scan result used as context only */ }

            sendEvent("step_done", { step: stepName, size: content.length, preview: content.slice(0, 200) });
          } catch (err) {
            sendEvent("step_error", { step: stepName, error: err.message });
          }
        }

        // Recompute scores after fix
        const newScores = await paaw.computeStatus();
        sendEvent("done", { message: `${area} fix complete`, scores: newScores });
      } catch (err) {
        sendEvent("error", { error: err.message });
      }
      res.end();
      return true;
    }

    // GET /api/coding-project/prompts — list all AI Initial prompts
    if (url.startsWith("/api/coding-project/prompts") && method === "GET" && !url.includes("/prompts/")) {
      const promptsDir = resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..", "data", "prompts", "ai-initial");
      const projectPromptsDir = join(root, ".paaw", "prompts", "ai-initial");
      try {
        const files = existsSync(promptsDir) ? await readdir(promptsDir) : [];
        const prompts = [];
        for (const f of files.filter(f => f.endsWith(".md")).sort()) {
          const content = readSync(resolve(promptsDir, f), "utf-8");
          const hasOverride = existsSync(resolve(projectPromptsDir, f));
          let overrideContent = null;
          if (hasOverride) {
            try { overrideContent = readSync(resolve(projectPromptsDir, f), "utf-8"); } catch {}
          }
          prompts.push({
            filename: f,
            name: f.replace(/\.md$/, ""),
            defaultContent: content,
            customContent: overrideContent,
            activeContent: overrideContent || content,
            hasOverride,
            size: (overrideContent || content).length,
          });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(prompts));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // GET /api/coding-project/prompts/:filename — read specific prompt
    if (url.match(/\/api\/coding-project\/prompts\/[\w-]+\.md$/) && method === "GET") {
      const filename = url.split("/prompts/").pop();
      const projectPromptsDir = join(root, ".paaw", "prompts", "ai-initial");
      const projectFile = resolve(projectPromptsDir, filename);
      if (existsSync(projectFile)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ filename, content: readSync(projectFile, "utf-8"), source: "project" }));
      } else {
        const defaultDir = resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..", "data", "prompts", "ai-initial");
        const defaultFile = resolve(defaultDir, filename);
        if (existsSync(defaultFile)) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ filename, content: readSync(defaultFile, "utf-8"), source: "default" }));
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Prompt not found" }));
        }
      }
      return true;
    }

    // PUT /api/coding-project/prompts/:filename — save custom prompt
    if (url.match(/\/api\/coding-project\/prompts\/[\w-]+\.md$/) && method === "PUT") {
      const filename = url.split("/prompts/").pop();
      const { content } = JSON.parse(await readBody(req));
      if (!content) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing content" }));
        return true;
      }
      const projectPromptsDir = join(root, ".paaw", "prompts", "ai-initial");
      await mkdir(projectPromptsDir, { recursive: true });
      await writeFile(resolve(projectPromptsDir, filename), content, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, filename, source: "project" }));
      return true;
    }

    // DELETE /api/coding-project/prompts/:filename — remove custom prompt (revert to default)
    if (url.match(/\/api\/coding-project\/prompts\/[\w-]+\.md$/) && method === "DELETE") {
      const filename = url.split("/prompts/").pop();
      const projectPromptsDir = join(root, ".paaw", "prompts", "ai-initial");
      const projectFile = resolve(projectPromptsDir, filename);
      if (existsSync(projectFile)) {
        try { await unlink(projectFile); } catch {}
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, filename, reverted: true }));
      return true;
    }

// ── Recent projects (multi-project) ──

    // GET /api/coding-project/recent — list recently opened projects
    if (url.startsWith("/api/coding-project/recent") && method === "GET") {
      const recentPath = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..", "data", "config", "recent-projects.json");
      let recent = [];
      try {
        if (existsSync(recentPath)) recent = JSON.parse(readSync(recentPath, "utf-8"));
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(recent));
      return true;
    }

    // DELETE /api/coding-project/recent — remove a project from recent list
    if (url.startsWith("/api/coding-project/recent") && method === "DELETE") {
      const params = new URL(req.url, "http://localhost").searchParams;
      const removePath = params.get("path");
      const recentPath = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..", "data", "config", "recent-projects.json");
      let recent = [];
      try {
        if (existsSync(recentPath)) recent = JSON.parse(readSync(recentPath, "utf-8"));
      } catch {}
      if (removePath) {
        recent = recent.filter(r => r.path !== removePath);
        await mkdir(dirname(recentPath), { recursive: true });
        await writeFile(recentPath, JSON.stringify(recent, null, 2), "utf-8");
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(recent));
      return true;
    }

    // POST /api/coding-project/recent — add/update recent project
    if (url.startsWith("/api/coding-project/recent") && method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}");
      const recentPath = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..", "data", "config", "recent-projects.json");
      let recent = [];
      try {
        if (existsSync(recentPath)) recent = JSON.parse(readSync(recentPath, "utf-8"));
      } catch {}

      // Add or update
      const path = body.path || root;
      const name = body.name || path.split("/").pop();
      recent = recent.filter(r => r.path !== path);
      recent.unshift({ path, name, lastOpened: new Date().toISOString(), hasPaaw: existsSync(join(path, ".paaw")) });
      recent = recent.slice(0, 20); // keep last 20

      await mkdir(dirname(recentPath), { recursive: true });
      await writeFile(recentPath, JSON.stringify(recent, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(recent));
      return true;
    }

  } catch (err) {
    console.error("[project route] error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
    return true;
  }

  return false;
}

// ── Read request body ──

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ── Generate Standards from Codebase ──

async function generateStandardsFromCodebase(projectRoot) {
  // 1. Gather codebase info
  const samples = [];
  const root = projectRoot;

  // Read package.json
  try {
    const pkg = JSON.parse(readSync(join(root, "package.json"), "utf-8"));
    samples.push(`package.json scripts: ${JSON.stringify(pkg.scripts || {})}`);
    samples.push(`dependencies: ${Object.keys(pkg.dependencies || {}).join(", ")}`);
    samples.push(`devDependencies: ${Object.keys(pkg.devDependencies || {}).join(", ")}`);
  } catch {}

  // Read a few source files as samples
  const sourcePatterns = [
    "packages/server/src/lib/*.mjs",
    "packages/ui/src/pages/*.tsx",
    "packages/ui/src/components/*.tsx",
  ];

  for (const pattern of sourcePatterns) {
    try {
      const { glob } = await import("fs/promises");
      // Use readdir as fallback
      const dir = join(root, pattern.replace(/\/[^/]+$/, ""));
      const ext = pattern.match(/\*\.(.+)$/)?.[1] || "mjs";
      if (existsSync(dir)) {
        const files = await readdir(dir);
        const matching = files.filter(f => f.endsWith(`.${ext}`)).slice(0, 3);
        for (const f of matching) {
          const content = readSync(join(dir, f), "utf-8");
          samples.push(`--- ${f} (first 600 chars) ---\n${content.slice(0, 600)}`);
        }
      }
    } catch {}
  }

  if (samples.length === 0) return null;

  // 2. Build prompt
  const prompt = `Analyze the following codebase samples and generate a comprehensive Coding Standards document in Markdown format.
Focus on:
1. File naming conventions used
2. Code style (indentation, quotes, semicolons)
3. Error handling patterns
4. Export patterns (ESM vs CJS)
5. Framework-specific conventions (React, Node.js)
6. Any existing patterns that should be standardized

Codebase samples:

${samples.join("\n\n")}

Output ONLY the markdown document, starting with # Coding Standards (Auto-Generated).`;

  // 3. Call LLM
  try {
    const rootDir = resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..");
    const result = await callProjectLLM(rootDir, {
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      maxTokens: 2000,
    });
    return result.content || null;
  } catch (err) {
    console.error("[project route] generate-standards error:", err.message);
    return null;
  }
}

// ── Shell helper ──

function runShellCmd(command, cwd, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    execCb(command, { cwd, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, shell: true,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", TERM: "dumb" }
    }, (err, stdout, stderr) => {
      resolve((stdout || "") + (stderr ? "\n" + stderr : ""));
    });
  });
}

// ── Collect Project Health ──

async function collectProjectHealth(root, paaw) {
  const health = {
    paawCompleteness: { initialized: paaw.exists, files: [], score: 0 },
    git: { branch: "", uncommitted: 0 },
    codeStats: { totalFiles: 0, totalLines: 0, languages: [] },
    sessions: { total: 0, recent: 0, successRate: 0 },
    dependencies: undefined,
  };

  // ── .paaw/ completeness ──
  const expectedFiles = ["PROJECT.md", "ARCHITECTURE.md", "DECISIONS.md", "CHANGELOG.md", "CODING-STANDARDS.md"];
  let existCount = 0;
  for (const f of expectedFiles) {
    const content = await paaw.readFile(f);
    const exists = content !== null;
    if (exists) existCount++;
    health.paawCompleteness.files.push({ name: f, exists, size: exists ? content.length : undefined });
  }
  // Check subdirs
  for (const d of ["sessions", "standards"]) {
    const dirPath = join(paaw.paawDir, d);
    const exists = existsSync(dirPath);
    if (exists) existCount++;
    health.paawCompleteness.files.push({ name: d + "/", exists });
  }
  health.paawCompleteness.score = Math.round((existCount / (expectedFiles.length + 2)) * 100);

  // ── Git health ──
  try {
    const branch = (await runShellCmd("git rev-parse --abbrev-ref HEAD", root, 3000)).trim();
    const status = await runShellCmd("git status --porcelain", root, 5000);
    const uncommitted = status.trim().split("\n").filter(Boolean).length;
    const logLine = (await runShellCmd("git log -1 --oneline --format=%h___%s___%cr", root, 3000)).trim();
    const remote = (await runShellCmd("git remote get-url origin", root, 3000)).trim();

    const [hash, ...rest] = logLine.split("___");
    const subject = rest[0] || "";
    const when = rest[1] || "";

    health.git = {
      branch,
      uncommitted,
      lastCommit: subject ? `${hash} ${subject}` : undefined,
      lastCommitDate: when || undefined,
      remote: remote || undefined,
    };
  } catch {}

  // ── Code stats ──
  try {
    const gitFiles = (await runShellCmd("git ls-files", root, 5000)).trim().split("\n").filter(Boolean);
    health.codeStats.totalFiles = gitFiles.length;

    // Count lines and languages
    const langCount = {};
    let totalLines = 0;
    const extMap = { ".js": "JavaScript", ".mjs": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript", ".jsx": "JavaScript", ".css": "CSS", ".html": "HTML", ".json": "JSON", ".md": "Markdown", ".py": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java", ".c": "C", ".cpp": "C++" };

    // Sample up to 500 files for performance
    const sample = gitFiles.slice(0, 500);
    for (const f of sample) {
      const ext = "." + (f.split(".").pop() || "");
      const lang = extMap[ext];
      if (lang) {
        langCount[lang] = (langCount[lang] || 0) + 1;
        try {
          const content = readSync(join(root, f), "utf-8");
          totalLines += content.split("\n").length;
        } catch {}
      } else if (!ext.includes("/")) {
        langCount[ext] = (langCount[ext] || 0) + 1;
      }
    }

    health.codeStats.totalLines = totalLines;

    // Language percentages
    const totalLangFiles = Object.values(langCount).reduce((a, b) => a + b, 0);
    health.codeStats.languages = Object.entries(langCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([lang, count]) => ({ lang, files: count, percent: Math.round((count / totalLangFiles) * 100) }));
  } catch {}

  // ── AI Sessions ──
  try {
    const sessions = await paaw.listSessions();
    health.sessions.total = sessions.length;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    health.sessions.recent = sessions.filter(s => new Date(s.modified).getTime() > sevenDaysAgo).length;

    // Calculate success rate from session content
    let successCount = 0;
    let checked = 0;
    for (const s of sessions.slice(0, 20)) {
      try {
        const content = await paaw.readSession(s.filename);
        if (content) {
          checked++;
          if (content.includes("✅ 成功")) successCount++;
        }
      } catch {}
    }
    health.sessions.successRate = checked > 0 ? Math.round((successCount / checked) * 100) : 0;
  } catch {}

  // ── Dependencies ──
  try {
    const pkgPath = join(root, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readSync(pkgPath, "utf-8"));
      const total = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length;
      health.dependencies = { total };
    }
  } catch {}

  return health;
}
