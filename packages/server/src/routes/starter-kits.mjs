/**
 * Starter Kits — REQ-STARTER-KIT-001（2026-10-31 Fleming）
 *
 *   GET    /api/starter-kits              — 列出所有已匯入 kit
 *   POST   /api/starter-kits              — 匯入 kit（JSON {name, language, description, fileBase64}，tar.gz）
 *   DELETE /api/starter-kits/:id          — 刪除 kit
 *   GET    /api/starter-kits/:id/files    — kit 內容檔案清單（含 KIT-ADAPT.md 有無）
 *   POST   /api/coding-project/from-kit   — 用 kit 建新專案（解壓 + {{PROJECT_NAME}} + .paaw init）
 *
 * 設計定調（Fleming 2026-10-31）：
 * - kit 檔 = tar.gz（Linux/macOS 優先，不做 zip）
 * - 存放：<DATA_HOME>/starter-kits/<id>/kit.tar.gz + kit.json（metadata）
 * - 建專案不碰 git（人先建 repo clone 好；目錄非 git repo 也不擋）
 * - 決定性段：解壓 + {{PROJECT_NAME}} 替換；各 kit 特有調整 = AI adaptation（照 KIT-ADAPT.md）
 */
import { readFile, writeFile, mkdir, readdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import { DATA_HOME } from "../data-home.mjs";
import { readBody } from "./context.mjs";
import { createPaawProject } from "../lib/paaw-project.mjs";

const execFileP = promisify(execFile);
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const KITS_DIR = resolve(DATA_HOME, "starter-kits");
await mkdir(KITS_DIR, { recursive: true });

const MAX_KIT_BODY_BYTES = 96 * 1024 * 1024; // base64 上限 96MB（原檔約 70MB）
const TEXT_EXTS = new Set([".json", ".md", ".txt", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".yml", ".yaml", ".env", ".example", ".gitignore", ".npmrc", ".editorconfig", ".html", ".css", ".scss", ".sh", ".py", ".go", ".rs", ".java", ".toml", ".xml", ".sql"]);

function _kitId(name) {
  const slug = String(name || "kit").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "kit";
  return `${slug}`;
}

async function _listKitDirs() {
  const out = [];
  for (const d of await readdir(KITS_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    try {
      const meta = JSON.parse(await readFile(join(KITS_DIR, d.name, "kit.json"), "utf-8"));
      out.push(meta);
    } catch { /* 壞目錄跳過 */ }
  }
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

/** tar -tzf 列內容；回傳 {files, rootDir, hasAdapt} */
async function _inspectTar(tarPath) {
  const { stdout } = await execFileP("tar", ["-tzf", tarPath], { maxBuffer: 16 * 1024 * 1024 });
  const entries = stdout.split("\n").map(s => s.trim()).filter(Boolean);
  const topLevel = new Set(entries.map(e => e.split("/")[0]).filter(Boolean));
  const rootDir = topLevel.size === 1 && [...topLevel][0] !== "." ? [...topLevel][0] : null;
  const strip = rootDir ? rootDir.length + 1 : 0;
  const files = entries.filter(e => !e.endsWith("/")).map(e => e.slice(strip));
  const hasAdapt = files.some(f => f === "KIT-ADAPT.md" || f.endsWith("/KIT-ADAPT.md"));
  return { files, rootDir, hasAdapt, fileCount: files.length };
}

export default async function starterKitsRoute(req, res) {
  const url = req.url || "";
  const method = req.method || "GET";

  const _json = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  // ── GET list ──
  if (url.startsWith("/api/starter-kits") && method === "GET" && url.split("?")[0] === "/api/starter-kits") {
    _json(200, { kits: await _listKitDirs() });
    return;
  }

  // ── GET :id/files ──
  const fm = url.split("?")[0].match(/^\/api\/starter-kits\/([^/]+)\/files$/);
  if (fm && method === "GET") {
    const dir = join(KITS_DIR, fm[1]);
    if (!existsSync(join(dir, "kit.json"))) { _json(404, { error: "kit not found" }); return; }
    const tarPath = join(dir, "kit.tar.gz");
    try {
      const info = await _inspectTar(tarPath);
      const adapt = info.files.find(f => f === "KIT-ADAPT.md" || f.endsWith("/KIT-ADAPT.md"));
      const adaptContent = adapt ? await (async () => {
        const tmp = join(dir, "_adapt_tmp");
        await mkdir(tmp, { recursive: true });
        await execFileP("tar", ["-xzf", tarPath, "-C", tmp, adapt]);
        const { readFile: rf } = await import("fs/promises");
        const content = await rf(join(tmp, adapt), "utf-8");
        await rm(tmp, { recursive: true, force: true });
        return content.slice(0, 8000);
      })() : null;
      _json(200, { id: fm[1], files: info.files, hasAdapt: info.hasAdapt, adaptContent });
    } catch (err) {
      _json(400, { error: `tar inspect failed: ${err.message}` });
    }
    return;
  }

  // ── DELETE :id ──
  const dm = url.split("?")[0].match(/^\/api\/starter-kits\/([^/]+)$/);
  if (dm && dm[1] && method === "DELETE") {
    const dir = join(KITS_DIR, dm[1]);
    if (!existsSync(join(dir, "kit.json"))) { _json(404, { error: "kit not found" }); return; }
    await rm(dir, { recursive: true, force: true });
    _json(200, { ok: true });
    return;
  }

  // ── POST import（JSON base64）──
  if (url.split("?")[0] === "/api/starter-kits" && method === "POST") {
    let body;
    try {
      const raw = await new Promise((ok, bad) => {
        let chunks = [], total = 0;
        req.on("data", c => { total += c.length; if (total > MAX_KIT_BODY_BYTES) { bad(new Error("body too large")); req.destroy(); } else chunks.push(c); });
        req.on("end", () => ok(Buffer.concat(chunks)));
        req.on("error", bad);
      });
      body = JSON.parse(raw.toString("utf-8"));
    } catch (err) {
      _json(400, { error: `bad request: ${err.message}` });
      return;
    }
    const name = String(body.name || "").trim();
    const fileB64 = String(body.fileBase64 || "");
    if (!name || !fileB64) { _json(400, { error: "Missing name or fileBase64" }); return; }

    let id = _kitId(name);
    let dir = join(KITS_DIR, id);
    let n = 2;
    while (existsSync(dir)) { id = `${_kitId(name)}-${n++}`; dir = join(KITS_DIR, id); }
    await mkdir(dir, { recursive: true });

    try {
      const tarPath = join(dir, "kit.tar.gz");
      await writeFile(tarPath, Buffer.from(fileB64, "base64"));
      const info = await _inspectTar(tarPath);
      if (!info.fileCount) throw new Error("tar.gz 內容是空的");
      const meta = {
        id, name,
        language: String(body.language || "").trim() || null,
        description: String(body.description || "").trim() || null,
        tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 10) : [],
        createdAt: new Date().toISOString(),
        fileCount: info.fileCount,
        rootDir: info.rootDir,
        hasAdapt: info.hasAdapt,
      };
      await writeFile(join(dir, "kit.json"), JSON.stringify(meta, null, 2), "utf-8");
      _json(200, { ok: true, kit: meta });
    } catch (err) {
      await rm(dir, { recursive: true, force: true }); // 失敗清乾淨
      _json(400, { error: `import failed: ${err.message}` });
    }
    return;
  }

  // ── POST /api/coding-project/from-kit ──
  if (url.split("?")[0] === "/api/coding-project/from-kit" && method === "POST") {
    const body = JSON.parse(await readBody(req) || "{}");
    const kitId = String(body.kitId || "");
    const projectName = String(body.name || "").trim();
    // 兩種模式：targetDir（既有目錄，例如已 clone 的 repo）| parentDir+name（建新目錄）
    const targetDir = body.targetDir ? resolve(String(body.targetDir)) : null;

    if (!kitId || !projectName) { _json(400, { error: "Missing kitId or name" }); return; }

    const kitDir = join(KITS_DIR, kitId);
    const kitMetaPath = join(kitDir, "kit.json");
    if (!existsSync(kitMetaPath)) { _json(404, { error: "kit not found" }); return; }
    const kit = JSON.parse(await readFile(kitMetaPath, "utf-8"));

    let projectDir;
    if (targetDir) {
      if (!existsSync(targetDir)) { _json(400, { error: "targetDir 不存在", path: targetDir }); return; }
      projectDir = targetDir;
      // 目錄已存在內容 → 只有 .paaw/ 與空目錄可蓋，其他檔案存在就擋（防誤炸既有專案）
      const existing = (await readdir(projectDir)).filter(f => f !== ".git" && f !== ".paaw");
      if (existing.length) { _json(409, { error: "目標目錄不是空的", path: targetDir, existing: existing.slice(0, 10) }); return; }
    } else {
      const parentDir = String(body.parentDir || "");
      if (!parentDir) { _json(400, { error: "Missing targetDir or parentDir" }); return; }
      if (projectName.includes("/") || projectName.includes("\\") || projectName.includes("..")) { _json(400, { error: "Invalid project name" }); return; }
      projectDir = join(resolve(parentDir), projectName);
      if (existsSync(projectDir)) { _json(409, { error: "Directory already exists", path: projectDir }); return; }
      await mkdir(projectDir, { recursive: true });
    }

    // 解壓 kit（strip 巢狀根）
    const tarPath = join(kitDir, "kit.tar.gz");
    const args = ["-xzf", tarPath, "-C", projectDir];
    if (kit.rootDir) args.push("--strip-components=1", kit.rootDir);
    try {
      await execFileP("tar", args, { maxBuffer: 16 * 1024 * 1024 });
    } catch (err) {
      _json(500, { error: `extract failed: ${err.message}` });
      return;
    }

    // {{PROJECT_NAME}} 替換（文字檔、<1MB；不碰 .git）
    let replaced = 0;
    const _walk = async (d) => {
      const { readdir: rd, stat: st, readFile: rf, writeFile: wf } = await import("fs/promises");
      const { extname } = await import("path");
      for (const f of await rd(d, { withFileTypes: true })) {
        if (f.name === ".git" || f.name === "node_modules") continue;
        const p = join(d, f.name);
        if (f.isDirectory()) { await _walk(p); continue; }
        const ext = extname(f.name).toLowerCase();
        const noExt = [".gitignore", ".env", ".npmrc", ".editorconfig", ".env.example"].includes(f.name);
        if (!TEXT_EXTS.has(ext) && !noExt) continue;
        try {
          const s = await st(p);
          if (s.size > 1024 * 1024) continue;
          const content = await rf(p, "utf-8");
          if (content.includes("{{PROJECT_NAME}}")) {
            await wf(p, content.split("{{PROJECT_NAME}}").join(projectName), "utf-8");
            replaced++;
          }
        } catch { /* 二進制誤判成 utf-8 就跳過 */ }
      }
    };
    await _walk(projectDir);

    // .paaw init（不碰 git — 定調：版控是人先建好的）
    if (body.initPaaw !== false) {
      const newPaaw = createPaawProject(projectDir);
      await newPaaw.init();
    }

    // ru_info：一 RU 一行基本資訊（description = 需求草稿）
    try { const { upsertRuInfo } = await import("../lib/coding-db/ru-info.repo.mjs"); upsertRuInfo(projectDir, { name: projectName, description: body.description || null }); } catch {}

    const isGit = existsSync(join(projectDir, ".git"));

    // AI Adaptation — 建立時自動跑（2026-10-31 Fleming 定調：init 時做，不是丟給 developer chat）
    // 兩段式（事實靠程式、理解靠 AI）：
    //   段1 程式+單發 LLM（必成功）：package.json/README 改名 + REQUIREMENTS.md/PROJECT.md 產出
    //   段2 developer agent（best-effort）：npm install + build 驗證 + KIT-ADAPT.md 特有調整
    let adaptation = null;
    if (body.runAdaptation !== false) {
      const steps = [];
      try {
        const PAAW_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");
        const { writeFile: wf } = await import("fs/promises");

        // ── 段1a：deterministic 改名 ──
        const pkgPath = join(projectDir, "package.json");
        if (existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
            pkg.name = projectName.toLowerCase().replace(/\s+/g, "-");
            pkg.description = body.description ? String(body.description).slice(0, 200) : (pkg.description || "");
            await wf(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
            steps.push(`package.json name → ${pkg.name}`);
          } catch {}
        }
        const readmePath = join(projectDir, "README.md");
        if (existsSync(readmePath)) {
          try {
            let rm = await readFile(readmePath, "utf-8");
            rm = rm.replace(/^#\s+.*$/m, `# ${projectName}`);
            await wf(readmePath, rm, "utf-8");
            steps.push("README 標題已改");
          } catch {}
        }

        // ── 段1b：單發 LLM 產 REQUIREMENTS.md + PROJECT.md（無工具、快、必成功）──
        try {
          const { resolveLLMConfig } = await import("../lib/paaw-agent-loop.mjs");
          const { callLLMWithRetry } = await import("../lib/llm-utils.mjs");
          const llm = resolveLLMConfig(projectDir, undefined, []);
          const r1 = await callLLMWithRetry(llm.apiUrl, llm.headers, {
            model: llm.model,
            messages: [
              { role: "system", content: "你是專案初始化助理。輸出 JSON：{\"requirementsMd\": \"完整 REQUIREMENTS.md 內容\", \"projectMd\": \"完整 PROJECT.md 內容\"}，不要其他文字。" },
              { role: "user", content: `新專案「${projectName}」剛從 Starter Kit「${kit.name}」建立。\n需求草稿：${body.description || "（未填 — REQUIREMENTS.md 只放標題與待補說明，不猜方向）"}\n\nREQUIREMENTS.md：編號需求列表（REQ-001…），每條一行描述+補充細節，推測標 [推測]。\nPROJECT.md：名稱、一句話定位、技術棧、目錄結構說明、現況（剛從 kit 建立）。\n技術棧參考 package.json：${existsSync(pkgPath) ? (await readFile(pkgPath, "utf-8")).slice(0, 1200) : "（無）"}` },
            ],
            temperature: 0.3,
            max_tokens: 8192,
          }, { maxRetries: 2, timeoutMs: 180000, caller: "kit-adapt-md", agentId: "coding.developer", disableThinking: true });
          const jm = String(r1?.content || "").match(/\{[\s\S]*\}/);
          if (jm) {
            const md = JSON.parse(jm[0]);
            if (md.requirementsMd) await wf(join(projectDir, "REQUIREMENTS.md"), String(md.requirementsMd), "utf-8");
            if (md.projectMd) await wf(join(projectDir, "PROJECT.md"), String(md.projectMd), "utf-8");
            steps.push("REQUIREMENTS.md + PROJECT.md 已產出");
          }
        } catch (e) { steps.push(`⚠️ 需求文件產出失敗：${String(e.message || e).slice(0, 100)}`); }

        // ── 段2：developer agent — npm install + build 驗證 + KIT-ADAPT 特有調整（best-effort，不擋建立）──
        let agentSummary = "";
        let agentOk = true;
        try {
          const { dateTimeContextBlock } = await import("../lib/llm-utils.mjs");
          const { runAgentLoop } = await import("../lib/paaw-agent-loop.mjs");
          const crewFile = existsSync(join(DATA_HOME, "crews", "coding.developer.json"))
            ? join(DATA_HOME, "crews", "coding.developer.json")
            : resolve(PAAW_ROOT, "packages/modules/coding/crews/coding.developer.json");
          const crewDef = JSON.parse(await readFile(crewFile, "utf-8"));
          const adaptPrompt = `專案「${projectName}」剛從 Starter Kit「${kit.name}」建立，改名與需求文件已完成。請只做這兩件事（這是建立時的自動 adaptation，沒有其他人在場，做完就回報）：

1. ${kit.hasAdapt ? "讀根目錄 KIT-ADAPT.md 照指引調整（這個 kit 的改寫說明）" : "快速看一下 repo 結構，刪掉明顯與需求無關的範例（拿不準就保留，不要大改）"}
2. 安裝依賴（npm install 或偵測到的套件管理器）並驗證 build（package.json 的 build script；沒有就跑 type-check 或至少 node 能載入）

需求：${body.description || "（未填 — 不猜方向，只做最小清理）"}
完成後 3 行內回報：做了什麼、build 結果、（若有）遺留問題。`;

          const r2 = await runAgentLoop({
            cwd: projectDir,
            rootDir: PAAW_ROOT,
            systemPrompt: dateTimeContextBlock() + "\n" + (crewDef.rolePrompt || ""),
            prompt: adaptPrompt,
            agentId: "coding.developer",
            maxTurns: 30,
            timeout: 0,
          });
          agentOk = !!r2?.success && !r2?.partial;
          agentSummary = String(r2?.content || "").slice(0, 2500);
          steps.push(`agent 驗證 ${agentOk ? "✅" : "⚠️"}（${r2?.turns || 0} turns）`);
        } catch (e) { agentOk = false; agentSummary = String(e.message || e).slice(0, 300); steps.push("⚠️ agent 驗證未跑成"); }

        adaptation = {
          success: true,
          steps,
          agentOk,
          summary: `【程式段】\n${steps.map(x => "- " + x).join("\n")}\n\n【Agent 段】\n${agentSummary || "（無輸出）"}`,
        };
      } catch (err) {
        adaptation = { success: false, error: String(err.message || err).slice(0, 500) };
      }
    }

    _json(200, {
      ok: true,
      path: projectDir,
      name: projectName,
      kit: { id: kit.id, name: kit.name, hasAdapt: kit.hasAdapt },
      projectNameReplaced: replaced,
      isGitRepo: isGit,
      hint: isGit ? null : "⚠️ 此目錄不是 git repo（不影響建立，僅提醒）",
      adaptation,
    });
    return;
  }

  return false;
}
