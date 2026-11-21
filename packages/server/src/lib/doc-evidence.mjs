/**
 * doc-evidence.mjs — 文件生成的共同證據包（2026-11-21 Fleming）
 *
 * 目的：AI 寫文件（Prod Spec / DFO / Release Info）不只讀 code，也要讀
 *   - task（.paaw/tasks/TASKS.json + .paaw/specs/*.md）— 知道「為什麼做、做過什麼」
 *   - ADR / 決策（.paaw/decisions/DECISIONS.md、docs/adr/**）— 對齊已定調的架構決策
 *   - changelog / known issues / next actions — 近期變動與已知問題
 *   - 人的備註（PROJECT.md USER 區）— 人補的上下文
 * 原則：有什麼讀什麼，不切字數（Fleming 2026-11-21：「字數限制拿掉才不會遺漏」）
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
// 不在這裡 import project-md（避免循環依賴）— 直接抓 USER 區 marker

const HARD_CAP = 400_000; // 單檔上限（防 100MB log 炸 context；正常文件遠小於此）

function readText(p) {
  try {
    const st = statSync(p);
    if (!st.isFile() || st.size === 0) return null;
    const s = readFileSync(p, "utf-8");
    return s.length > HARD_CAP ? s.slice(0, HARD_CAP) + "\n…（檔案過大已截斷）" : s;
  } catch { return null; }
}

/** 找 ADR：.paaw/decisions/DECISIONS.md + docs/adr/*.md + docs/decisions/*.md */
function collectAdr(root) {
  const out = [];
  const decisions = readText(join(root, ".paaw", "decisions", "DECISIONS.md"));
  if (decisions && decisions.trim()) out.push({ label: "ADR / 技術決策（.paaw/decisions/DECISIONS.md）", content: decisions });
  for (const dir of [join(root, "docs", "adr"), join(root, "docs", "decisions"), join(root, "adr")]) {
    if (!existsSync(dir)) continue;
    try {
      const files = readdirSync(dir).filter(f => /\.(md|mdx|txt)$/i.test(f)).slice(0, 40);
      if (!files.length) continue;
      const parts = files.map(f => {
        const c = readText(join(dir, f));
        return c ? `### ${f}\n${c}` : null;
      }).filter(Boolean);
      if (parts.length) out.push({ label: `ADR 文件（${dir.replace(root + "/", "")}）`, content: parts.join("\n\n") });
    } catch {}
  }
  return out;
}

/** task：TASKS.json（標題/狀態/摘要）+ .paaw/specs/*.md（task 規格） */
function collectTasks(root) {
  const out = [];
  const raw = readText(join(root, ".paaw", "tasks", "TASKS.json"));
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : (parsed.tasks || []);
      // 只保留對文件有幫助的欄位，避免 token 全花在 runtime 欄位
      const slim = list.slice(-80).map(t => ({
        id: t.id, title: t.title, status: t.status, type: t.type,
        summary: typeof t.summary === "string" ? t.summary : undefined,
        description: typeof t.description === "string" ? t.description.slice(0, 1200) : undefined,
        feature: t.feature || t.featureId, createdAt: t.createdAt, completedAt: t.completedAt,
        files: Array.isArray(t.filesChanged) ? t.filesChanged.slice(0, 20) : undefined,
      }));
      if (slim.length) out.push({ label: "TASKS（.paaw/tasks/TASKS.json，最近 80 筆）", content: JSON.stringify(slim, null, 1) });
    } catch {
      out.push({ label: "TASKS（.paaw/tasks/TASKS.json，原始）", content: raw });
    }
  }
  const specsDir = join(root, ".paaw", "specs");
  if (existsSync(specsDir)) {
    try {
      const files = readdirSync(specsDir).filter(f => /\.(md|json)$/i.test(f));
      const picked = files.slice(-30);
      const parts = picked.map(f => {
        const c = readText(join(specsDir, f));
        return c ? `### ${f}\n${c}` : null;
      }).filter(Boolean);
      if (parts.length) out.push({ label: "TASK SPECS（.paaw/specs/）", content: parts.join("\n\n") });
    } catch {}
  }
  return out;
}

/**
 * 收齊文件寫作證據
 * @param {string} root project root
 * @param {{skip?: string[]}} opts skip: "tasks" | "adr" | "docs" | "human"
 * @returns {Array<{label: string, content: string}>}
 */
export function collectDocEvidence(root, opts = {}) {
  const skip = new Set(opts.skip || []);
  const parts = [];

  if (!skip.has("tasks")) parts.push(...collectTasks(root));
  if (!skip.has("adr")) parts.push(...collectAdr(root));

  if (!skip.has("docs")) {
    for (const [rel, label] of [
      [".paaw/changelog/CHANGELOG.md", "CHANGELOG（.paaw/changelog/CHANGELOG.md）"],
      [".paaw/actions/KNOWN-ISSUES.md", "KNOWN ISSUES（.paaw/actions/KNOWN-ISSUES.md）"],
      [".paaw/actions/NEXT-ACTIONS.md", "NEXT ACTIONS（.paaw/actions/NEXT-ACTIONS.md）"],
      ["README.md", "README.md"],
    ]) {
      const c = readText(join(root, rel));
      if (c && c.trim()) parts.push({ label, content: c });
    }
  }

  if (!skip.has("human")) {
    for (const rel of [".paaw/project/PROJECT.md", ".paaw/PROJECT.md"]) {
      const c = readText(join(root, rel));
      if (!c) continue;
      const um = c.match(/<!-- USER:START[^>]*-->([\s\S]*?)<!-- USER:END -->/);
      const user = (um ? um[1] : "").trim();
      if (user) parts.push({ label: "人的備註（PROJECT.md User Remarks）", content: user });
      break;
    }
  }

  return parts;
}

/** 轉成 prompt 區塊字串（空 → ""） */
export function docEvidenceBlock(root, opts = {}) {
  const parts = collectDocEvidence(root, opts);
  if (!parts.length) return "";
  return parts.map(p => `--- ${p.label} ---\n${p.content}`).join("\n\n");
}
