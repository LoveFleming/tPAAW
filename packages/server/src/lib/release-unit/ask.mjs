/**
 * release-unit/ask.mjs — 自然語言問 codebase（Tier 2 #14）
 *
 * 零 LLM 的檢索層：query 斷詞 → 檔名 + 內容 + .paaw 文件加權比對
 * （BM25-lite）→ 回傳 ranked context pack（檔案 + 命中片段）。
 * AI Agent 拿這包去回答，比裸 grep 省事、比 LLM 全文掃省 token。
 */

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { detectAdapter } from "./adapters.mjs";
import { walkSources } from "./dependencies.mjs";
import { isTestFile } from "./metrics.mjs";

const STOP = new Set(["the", "a", "an", "is", "are", "do", "does", "how", "what", "where",
  "which", "why", "can", "should", "i", "we", "you", "it", "this", "that", "of", "in", "on",
  "to", "for", "with", "and", "or", "not", "的", "了", "是", "在", "嗎", "怎麼", "什麼", "哪個"]);

/** 斷詞：英文拆字 + 駝峰 + 中文雙字 */
function tokenize(q) {
  const tokens = new Set();
  const words = String(q).match(/[A-Za-z_][A-Za-z0-9_]*|[\u4e00-\u9fff]+|\d+/g) || [];
  for (const w of words) {
    if (STOP.has(w.toLowerCase())) continue;
    tokens.add(w.toLowerCase());
    // 駝峰拆詞（verifyCommands → verify + commands）
    const camel = w.split(/(?=[A-Z])/).filter(p => p.length > 1);
    for (const c of camel) if (!STOP.has(c.toLowerCase())) tokens.add(c.toLowerCase());
    // 中文雙字滑窗
    if (/^[\u4e00-\u9fff]+$/.test(w) && w.length >= 2) {
      for (let i = 0; i < w.length - 1; i++) tokens.add(w.slice(i, i + 2));
    }
  }
  return [...tokens];
}

/** 檔名加權：路徑段命中 query 詞 → 高分 */
function pathScore(rel, tokens) {
  const segs = rel.toLowerCase().split(/[\\/]/).join(" ").split(/[.\s]+/);
  let s = 0;
  for (const t of tokens) {
    for (const seg of segs) {
      if (seg === t) s += 6;
      else if (seg.includes(t) && t.length >= 3) s += 2;
    }
  }
  return s;
}

/**
 * 問 codebase
 * @param {string} q 自然語言問題
 * @returns { question, tokens, hits: [{file, score, kind, snippet }], docHits: [{file, score, snippet}] }
 */
export async function askCodebase(root, q, opts = {}) {
  const tokens = tokenize(q);
  if (!tokens.length) return { question: q, tokens: [], hits: [], docHits: [], hint: "empty query" };

  const adapter = await detectAdapter(root);
  const files = await walkSources(root, adapter.sourceExts, opts.maxFiles);

  const hits = [];
  for (const f of files) {
    let content;
    try { content = await readFile(f.abs, "utf-8"); } catch { continue; }
    const lower = content.toLowerCase();
    let score = pathScore(f.rel, tokens) * 3; // 檔名命中最強
    const lines = content.split("\n");

    for (const t of tokens) {
      if (t.length < 2 && !/[\u4e00-\u9fff]/.test(t)) continue;
      let idx = 0, n = 0;
      const tl = t.toLowerCase();
      while ((idx = lower.indexOf(tl, idx)) !== -1 && n < 20) { n += 1; idx += tl.length; }
      if (n) score += Math.min(n, 8) * (t.length >= 4 ? 2 : 1); // 內容命中，長詞加權
    }
    if (score <= 0) continue;

    // 找最佳片段（第一個命中 token 所在行 ± 3 行）
    let snippet = null;
    outer: for (const t of tokens.sort((a, b) => b.length - a.length)) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(t)) {
          const from = Math.max(0, i - 2);
          snippet = lines.slice(from, from + 6).join("\n").slice(0, 600);
          break outer;
        }
      }
    }

    hits.push({
      file: f.rel,
      score,
      kind: isTestFile(f.rel) ? "test" : "source",
      loc: lines.length,
      snippet,
    });
  }
  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, opts.maxHits || 15);

  // .paaw 文件也搜（知識命中常比 code 命中更直接回答「為什麼」）
  const docHits = [];
  const paawDir = join(root, ".paaw");
  if (existsSync(paawDir)) {
    const docs = ["PROJECT.md", "ARCHITECTURE.md", "DECISIONS.md", "CONTEXT.md", "CHANGELOG.md",
      "project/CODING-STANDARDS.md", "CODING-STANDARDS.md"];
    for (const d of docs) {
      const f = join(paawDir, d);
      if (!existsSync(f)) continue;
      const content = await readFile(f, "utf-8").catch(() => null);
      if (!content) continue;
      const lower = content.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        const n = lower.split(t.toLowerCase()).length - 1;
        if (n) score += Math.min(n, 10) * 2;
      }
      if (score > 0) {
        // 片段：第一個命中的段落
        let snippet = null;
        for (const t of tokens.sort((a, b) => b.length - a.length)) {
          const i = lower.indexOf(t.toLowerCase());
          if (i >= 0) {
            const from = Math.max(0, i - 200);
            snippet = content.slice(from, from + 500);
            break;
          }
        }
        docHits.push({ file: `.paaw/${d}`, score, snippet });
      }
    }
    docHits.sort((a, b) => b.score - a.score);
  }

  return {
    question: q,
    tokens,
    hits: top,
    docHits: docHits.slice(0, 5),
    hint: top.length ? null : "沒有命中 — 換個關鍵字（檔名/函式名/模組名）試試",
  };
}
