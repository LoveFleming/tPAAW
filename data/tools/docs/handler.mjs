/**
 * Docs / Runbook Tool Provider Handler
 *
 * Tools: read_runbook, list_runbooks
 *
 * Runbooks are stored in: data/runbooks/
 * Supports: .md, .txt, .json files
 * Frontmatter (YAML) parsed for metadata: name, category, severity, tags
 */

const { existsSync, readFileSync, readdirSync, statSync } = await import("fs");
const { resolve, join, extname, basename } = await import("path");

const PAAW_ROOT = process.env.PAAW_ROOT || resolve(import.meta.dirname, "../../../../../");
const RUNBOOKS_DIR = resolve(PAAW_ROOT, "data/runbooks");

function parseFrontmatter(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return { meta: {}, body: content };
  const meta = {};
  const fmText = fmMatch[1];
  for (const line of fmText.split("\n")) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) {
      let val = m[2].trim();
      if (val.startsWith("[") && val.endsWith("]")) {
        val = val.slice(1, -1).split(",").map(s => s.trim());
      }
      meta[m[1]] = val;
    }
  }
  return { meta, body: fmMatch[2] || content };
}

function scanRunbooks() {
  if (!existsSync(RUNBOOKS_DIR)) return [];
  const results = [];
  function scan(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (![".md", ".txt", ".json"].includes(ext)) continue;
        try {
          const raw = readFileSync(fullPath, "utf-8");
          const { meta, body } = ext === ".json"
            ? { meta: JSON.parse(raw), body: raw }
            : parseFrontmatter(raw);
          results.push({
            path: fullPath.replace(RUNBOOKS_DIR + "/", ""),
            name: meta.name || basename(entry.name, ext),
            file: entry.name,
            category: meta.category || "general",
            severity: meta.severity || "",
            tags: Array.isArray(meta.tags) ? meta.tags : [],
            summary: meta.summary || body.slice(0, 100).replace(/\n/g, " ").trim(),
            body,
          });
        } catch {}
      }
    }
  }
  scan(RUNBOOKS_DIR);
  return results;
}

function searchRunbooks(keyword, runbooks) {
  const kw = keyword.toLowerCase();
  return runbooks.filter(rb => {
    const searchText = [
      rb.name, rb.category, rb.summary,
      Array.isArray(rb.tags) ? rb.tags.join(" ") : "",
      rb.body,
    ].join(" ").toLowerCase();
    return searchText.includes(kw);
  });
}

export default async function handler(args, ctx) {
  try {
    const runbooks = scanRunbooks();

    if (runbooks.length === 0) {
      return {
        text: "⚠️ 尚無 Runbook 文件。請在 data/runbooks/ 目錄建立 SOP 文件（.md 格式）。\n\n範例格式：\n```markdown\n---\nname: payment-troubleshooting\ncategory: kubernetes\nseverity: high\ntags: [payment, connection-pool, database]\nsummary: payment-service connection pool 耗盡排查\n---\n\n# SOP: payment-service 排查\n\n## 症狀\n...\n## 步驟\n1. ...\n```",
      };
    }

    // list_runbooks
    if (!args.keyword && !args.name) {
      let filtered = runbooks;
      if (args.category) {
        filtered = runbooks.filter(rb => rb.category === args.category);
      }
      const lines = filtered.map(rb => {
        const sev = rb.severity ? `[${rb.severity.toUpperCase()}] ` : "";
        return `📖 ${sev}${rb.name} (${rb.category})\n   ${rb.summary}\n   📁 ${rb.path}`;
      });
      return {
        text: `找到 ${filtered.length} 個 runbook：\n\n${lines.join("\n\n")}`,
        data: { count: filtered.length, runbooks: filtered.map(r => ({ name: r.name, category: r.category, path: r.path })) },
      };
    }

    // read_runbook by name
    if (args.name) {
      const found = runbooks.find(rb =>
        rb.name === args.name ||
        rb.file === args.name ||
        rb.file === `${args.name}.md` ||
        rb.file === `${args.name}.txt`
      );
      if (!found) {
        return { text: `❌ 找不到 runbook: ${args.name}` };
      }
      return {
        text: `📖 **${found.name}** (${found.category})\n📁 ${found.path}\n\n${found.body}`,
        data: found,
      };
    }

    // search by keyword
    if (args.keyword) {
      const matches = searchRunbooks(args.keyword, runbooks);
      if (matches.length === 0) {
        return { text: `❌ 找不到跟「${args.keyword}」相關的 runbook` };
      }
      if (matches.length === 1) {
        const rb = matches[0];
        return {
          text: `📖 **${rb.name}** (${rb.category})\n📁 ${rb.path}\n\n${rb.body}`,
          data: rb,
        };
      }
      const lines = matches.map(rb => `📖 ${rb.name} (${rb.category}) — ${rb.summary}\n   📁 ${rb.path}`);
      return {
        text: `找到 ${matches.length} 個相關 runbook：\n\n${lines.join("\n\n")}\n\n用 read_runbook(name=\"...\") 讀取特定 runbook。`,
        data: { count: matches.length, matches: matches.map(r => ({ name: r.name, path: r.path })) },
      };
    }

    return { text: "請提供 keyword 或 name 參數" };
  } catch (err) {
    return { text: `❌ 讀取 runbook 失敗：${err.message}`, error: true };
  }
}
