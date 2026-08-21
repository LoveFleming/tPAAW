/**
 * release-unit/qa.mjs — 新人 12 問 deterministic 引擎（R5）
 *
 * 鐵律：No answer without evidence。
 *   每個回答 = 簡答 + evidence blocks（file / file:line / commit / ADR / task / api / release / stat）
 *   找不到證據 → 明講 noEvidence: true，不編故事。
 *
 * 零 LLM：intent 用關鍵詞規則分類（12 類 + generic fallback），
 * 事實全部來自程式產物：R2 model / R4 handover state / git / DECISIONS.md /
 * package.json / releases / symbol-index。generic fallback 走 askCodebase（BM25）。
 *
 * 註：company Windows 不保證有 grep — 行號查找用純 JS 逐行掃（跨平台紀律）。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { shellExec } from "../shell-exec.mjs";
import { loadReleaseUnitModel, queryModelByFeature, queryModelByFile, queryModelByApi } from "./model.mjs";
import { askCodebase } from "./ask.mjs";

const EV = {
  doc: (ref, detail) => ({ type: "doc", ref, detail }),
  file: (ref, detail) => ({ type: "file", ref, detail }),
  commit: (ref, detail) => ({ type: "commit", ref, detail: detail?.slice(0, 120) }),
  adr: (ref, detail) => ({ type: "adr", ref, detail: detail?.slice(0, 120) }),
  task: (ref, detail) => ({ type: "task", ref, detail: detail?.slice(0, 120) }),
  api: (ref, detail) => ({ type: "api", ref, detail }),
  release: (ref, detail) => ({ type: "release", ref, detail: detail?.slice(0, 120) }),
  stat: (ref, detail) => ({ type: "stat", ref, detail }),
};

// ── 小工具 ──

async function _git(root, cmd) {
  try {
    const { stdout } = await shellExec(cmd, { cwd: root, timeout: 10_000 });
    return (stdout || "").trim();
  } catch { return ""; }
}

function _readJson(file, fb) {
  if (!existsSync(file)) return fb;
  try { return JSON.parse(readFileSync(file, "utf-8")); } catch { return fb; }
}

function _findLine(root, relFile, needle, limit = 3) {
  // 純 JS 行掃描（跨平台；symbol-index 沒有行號，這裡補）
  const abs = join(root, relFile);
  if (!existsSync(abs)) return [];
  try {
    const lines = readFileSync(abs, "utf-8").split("\n");
    const out = [];
    for (let i = 0; i < lines.length && out.length < limit; i++) {
      if (lines[i].includes(needle)) out.push({ line: i + 1, text: lines[i].trim().slice(0, 120) });
    }
    return out;
  } catch { return []; }
}

function _extractRoutePath(q) {
  const m = String(q).match(/(\/[a-z0-9\-]+(?:\/[a-z0-9\-:*.]+){1,6})/i);
  return m ? m[1] : null;
}

function _extractFilePath(q) {
  const m = String(q).match(/([\w.\-]+(?:\/[\w.\-]+)+\.(?:mjs|js|ts|tsx|jsx|json|md))/);
  return m ? m[1].replace(/\\/g, "/") : null;
}

function _matchFeature(model, q) {
  const qs = String(q).toLowerCase();
  const feats = model.features || [];
  // 1. 直接 id
  const idm = qs.match(/f-?(\d{1,3})\b/);
  if (idm) {
    const id = `F-${String(idm[1]).padStart(3, "0")}`;
    const hit = feats.find(f => f.id.toLowerCase() === id.toLowerCase());
    if (hit) return hit;
  }
  // 2. 名稱子字串（取最長命中）
  let best = null;
  for (const f of feats) {
    const name = String(f.name || "").toLowerCase();
    if (name.length >= 2 && qs.includes(name)) {
      if (!best || name.length > String(best.name).length) best = f;
    }
  }
  if (best) return best;
  // 3. token 重疊評分（「coding app」vs「Coding IDE」— 單字命中也算，常見詞要求 2 個以上）
  const qToks = new Set(qs.match(/[a-z0-9]{2,}/g) || []);
  let bestScore = 0;
  for (const f of feats) {
    const nToks = String(f.name || "").toLowerCase().match(/[a-z0-9]{2,}/g) || [];
    let score = 0;
    for (const nt of new Set(nToks)) {
      if (!qToks.has(nt)) continue;
      if (nt.length >= 5) score += 2;
      else if (nt.length >= 4) score += 1;
      // 長度 2-3 的詞只記件數，單獨命中不足以判定
      else if (nt.length <= 3) score += 0.5;
    }
    if (score > bestScore) { bestScore = score; best = f; }
  }
  // 門檻：至少一個 4+ 字元詞命中（score>=1），或兩個短詞（score>=1）
  return bestScore >= 1 ? best : null;
}

function _tokens(q) {
  return [...new Set(String(q).toLowerCase().match(/[a-z0-9_]{2,}/g) || [])];
}

// ── Intent handlers：回傳 { summary, bullets, evidence, noEvidence? , followUps?} ──

async function _projectPurpose(root, model) {
  const proj = _readJson(join(root, "package.json"), {});
  const ev = [];
  const projMd = join(root, ".paaw", "project", "PROJECT.md");
  const legacyMd = join(root, ".paaw", "PROJECT.md");
  const mdFile = existsSync(projMd) ? projMd : (existsSync(legacyMd) ? legacyMd : null);
  if (mdFile) {
    const head = readFileSync(mdFile, "utf-8").split("\n").slice(0, 8).join(" ").slice(0, 200);
    ev.push(EV.doc(".paaw/project/PROJECT.md", head));
  }
  if (proj.name) ev.push(EV.doc("package.json", `${proj.name}${proj.version ? "@" + proj.version : ""} — ${proj.description || "(無 description)"}`));
  ev.push(EV.stat("release-unit-model", `${model.summary.features} features · ${model.summary.apis} APIs · ${model.summary.files} code files`));
  if (!ev.length) return { noEvidence: true, summary: "找不到 PROJECT.md / package.json 描述" };
  return {
    summary: `${proj.name || "此專案"}：${model.summary.features} 個 features、${model.summary.apis} 個 API、${model.summary.tests} 個測試映射。`,
    evidence: ev,
  };
}

function _listApis(model) {
  const apis = model.apis || [];
  if (!apis.length) return { noEvidence: true, summary: "model 內沒有 API 資料（api-function-map 未掃或過期）" };
  const byFile = new Map();
  for (const a of apis) {
    if (!byFile.has(a.file)) byFile.set(a.file, []);
    byFile.get(a.file).push(`${a.method} ${a.path}`);
  }
  const top = [...byFile.entries()].sort((x, y) => y[1].length - x[1].length).slice(0, 8);
  return {
    summary: `共 ${apis.length} 個 API，分布在 ${byFile.size} 個檔案。前幾名：`,
    bullets: top.map(([f, list]) => `${f}（${list.length}）: ${list.slice(0, 4).join(" · ")}`),
    evidence: [EV.stat("api-function-map.json", `${apis.length} routes scanned`), ...top.slice(0, 4).map(([f]) => EV.file(f, "API 定義檔"))],
  };
}

function _findFeature(model, feature) {
  if (!feature) return { noEvidence: true, summary: "問題裡找不到對應的 feature 名稱或 ID" };
  const q = queryModelByFeature(model, feature.id);
  return {
    summary: `${feature.id} ${feature.name}：${feature.fileCount} 個檔案、${feature.apiCount} 個 API、${feature.testCount} 個測試、最近 ${feature.changeCount} 次變更。`,
    bullets: (feature.files || []).slice(0, 6).map(f => f),
    evidence: [
      ...((q?.apis || []).slice(0, 3).map(a => EV.api(a, `${feature.id} 對應 API`))),
      ...(feature.files || []).slice(0, 3).map(f => EV.file(f, `${feature.id} 成員檔案`)),
      EV.stat("FILE-FEATURES.json", `${feature.id} → ${feature.fileCount} files mapped`),
    ],
    followUps: [`${feature.name} 上次為什麼修改？`, `${feature.name} 有測試嗎？`],
  };
}

async function _whyDesign(root, model, q) {
  const file = join(root, ".paaw", "DECISIONS.md");
  if (!existsSync(file)) return { noEvidence: true, summary: "沒有 .paaw/DECISIONS.md — 找不到設計決策記錄" };
  const md = readFileSync(file, "utf-8");
  const blocks = [];
  const re = /^## (ADR-\d+):\s*(.+)$/gm;
  let m;
  const heads = [];
  while ((m = re.exec(md)) !== null) heads.push({ id: m[1], title: m[2], start: m.index });
  for (let i = 0; i < heads.length; i++) {
    const end = i + 1 < heads.length ? heads[i + 1].start : md.length;
    blocks.push({ ...heads[i], body: md.slice(heads[i].start, end) });
  }
  if (!blocks.length) return { noEvidence: true, summary: "DECISIONS.md 存在但沒有可解析的 ADR 條目" };
  // 用剩餘 token 評分（扣掉 why 詞）
  const toks = _tokens(q).filter(t => !["why", "設計", "當初"].includes(t));
  const scored = blocks.map(b => {
    const hay = (b.title + " " + b.body.slice(0, 1500)).toLowerCase();
    let s = 0;
    for (const t of toks) if (hay.includes(t)) s += t.length >= 4 ? 3 : 1;
    return { b, s };
  }).sort((x, y) => y.s - x.s);
  if (!scored.length || scored[0].s === 0) {
    return {
      noEvidence: true,
      summary: `DECISIONS.md 有 ${blocks.length} 條 ADR，但沒有一條跟問題關鍵詞相符。`,
      evidence: [EV.doc(".paaw/DECISIONS.md", `${blocks.length} ADRs — 用關鍵詞再問一次`)],
    };
  }
  const top = scored.slice(0, 3).filter(x => x.s > 0);
  return {
    summary: `最相關的 ${top.length} 條決策記錄：`,
    bullets: top.map(({ b }) => `${b.id} — ${b.title}`),
    evidence: top.map(({ b }) => EV.adr(b.id, b.title)),
  };
}

async function _apiLastChange(root, model, q) {
  const route = _extractRoutePath(q);
  if (!route) return { noEvidence: true, summary: "問題裡沒有 API 路徑（例如 /api/ru/model）" };
  const api = queryModelByApi(model, "GET", route) || queryModelByApi(model, "POST", route);
  if (!api) return { noEvidence: true, summary: `api-function-map 裡找不到 ${route}（可能是舊掃描 — 跑重掃機械層）` };
  const last = await _git(root, `git log -1 --format='%h|%aI|%s' -- ${JSON.stringify(api.file)}`);
  const ev = [EV.api(`${api.method} ${api.path}`, `定義於 ${api.file}`)];
  if (!last) {
    return { summary: `${route} 定義在 ${api.file}，但 git log 查不到修改記錄（新檔或未 commit）。`, evidence: ev };
  }
  const [hash, date, ...rest] = last.split("|");
  ev.push(EV.commit(hash, `${date?.slice(0, 10)} ${rest.join("|")}`));
  // 追加 ADR 線索
  return {
    summary: `${route} 上次修改：${date?.slice(0, 10)} — ${rest.join("|").slice(0, 80)}`,
    bullets: [`定義檔：${api.file}`, `歸屬 features：${api.featureIds.join(", ") || "(未映射)"}`],
    evidence: ev,
    followUps: ["為什麼當初這樣設計？"],
  };
}

async function _dangerousPlaces(root, model) {
  const hot = model.knowledgeGaps?.hotUnmappedFiles || [];
  const noTests = model.knowledgeGaps?.featuresWithoutTests || [];
  const ev = [];
  const bullets = [];
  if (hot.length) {
    bullets.push(`常改但無 feature 認領：${hot.slice(0, 3).map(h => `${h.file}（${h.commits} commits）`).join("、")}`);
    ev.push(EV.stat("git log × FILE-FEATURES", `hot-unmapped top: ${hot[0].file} ${hot[0].commits} commits`));
    ev.push(EV.file(hot[0].file, "最高風險：高改動 + 無歸屬"));
  }
  if (noTests.length) {
    bullets.push(`無測試保護的 features：${noTests.slice(0, 5).join("、")}（共 ${noTests.length} 個）`);
    ev.push(EV.stat("model.knowledgeGaps", `${noTests.length} features without tests`));
  }
  // 最近 30 天修復型 commit 比例 = 不穩定訊號
  const fixes = (model.changes || []).filter(c => c.kind === "fix");
  if (fixes.length >= 3) {
    bullets.push(`近期 ${fixes.length} 個 fix commits，例如 ${fixes[0].hash} ${fixes[0].subject.slice(0, 50)}`);
    ev.push(EV.commit(fixes[0].hash, fixes[0].subject));
  }
  if (!bullets.length) return { summary: "以現有證據看不出明顯風險點。", evidence: [EV.stat("model", "no risk signals")] };
  return { summary: "風險訊號（依證據強度排序）：", bullets, evidence: ev };
}

async function _fieldOrigin(root, model, q) {
  // 抓 identifier：問題裡最長的、存在 symbol-index 的 token
  const si = _readJson(join(root, ".paaw", "code-intelligence", "symbol-index.json"), null);
  const byName = si?.byName;
  if (!byName) return { noEvidence: true, summary: "沒有 symbol-index.json（機械層未掃）" };
  const cands = (String(q).match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || [])
    .filter(w => !["api", "the", "where", "from", "what", "哪裡", "field"].includes(w.toLowerCase()))
    .sort((a, b) => b.length - a.length);
  let sym = null, word = null;
  for (const w of cands) {
    if (byName[w]) { sym = byName[w]; word = w; break; }
    // case-insensitive 掃
    const k = Object.keys(byName).find(name => name.toLowerCase() === w.toLowerCase());
    if (k) { sym = byName[k]; word = k; break; }
  }
  if (!sym) {
    // fallback：BM25 内容搜索（identifier 可能是物件欄位而非 symbol）
    const word2 = word || cands[0] || String(q);
    const r = await askCodebase(root, word2, { maxHits: 4 });
    const hits = (r.hits || []).filter(h => h.kind !== "test");
    if (hits.length) {
      const out = [];
      for (const h of hits.slice(0, 3)) {
        const lines = _findLine(root, h.file, word2, 1);
        if (lines.length) out.push(EV.file(`${h.file}:${lines[0].line}`, lines[0].text.slice(0, 60)));
        else out.push(EV.file(h.file, (h.snippet || "").slice(0, 60)));
      }
      return { summary: `\`${word2}\` 不是頂層 symbol，但內容搜索命中：`, bullets: hits.slice(0, 3).map(h => h.file), evidence: out };
    }
    return { noEvidence: true, summary: `symbol-index 與內容搜索都找不到（試過：${cands.slice(0, 3).join(", ")}）` };
  }
  const defs = sym.slice(0, 3);
  const ev = [];
  const bullets = [];
  for (const d of defs) {
    const lines = _findLine(root, d.file, word, 2);
    for (const ln of lines.slice(0, 1)) {
      ev.push(EV.file(`${d.file}:${ln.line}`, `${d.kind} ${word} — ${ln.text.slice(0, 60)}`));
      bullets.push(`${d.file}:${ln.line}（${d.kind}）`);
    }
    if (!lines.length) ev.push(EV.file(d.file, `${d.kind} ${word}（行號未定位）`));
  }
  return {
    summary: `\`${word}\` 定義在：`,
    bullets,
    evidence: ev,
  };
}

async function _fileImpact(root, model, q) {
  const file = _extractFilePath(q);
  if (!file) return { noEvidence: true, summary: "問題裡沒有檔案路徑" };
  const fq = queryModelByFile(model, file);
  const dg = _readJson(join(root, ".paaw", "code-intelligence", "dependency-graph.json"), { edges: [] });
  const revDeps = (dg.edges || []).filter(e => e.to === file).map(e => e.from).slice(0, 8);
  const fwdDeps = (dg.edges || []).filter(e => e.from === file).map(e => e.to).slice(0, 8);
  const ev = [];
  const bullets = [];
  if (fq.featureIds.length) {
    bullets.push(`屬於 features：${fq.featureIds.join("、")}`);
    ev.push(EV.stat("FILE-FEATURES.json", `${file} → ${fq.featureIds.join(", ")}`));
  }
  if (fq.apis.length) {
    bullets.push(`承載 API：${fq.apis.slice(0, 4).join(" · ")}`);
    ev.push(EV.api(fq.apis[0], `${file} 內`));
  }
  if (revDeps.length) {
    bullets.push(`被這些檔案 import：${revDeps.slice(0, 5).join("、")}`);
    ev.push(EV.stat("dependency-graph", `${revDeps.length} 個反向依賴（上游）`));
  }
  if (fq.tests.length) {
    bullets.push(`測試：${fq.tests.map(t => t.file).join("、")}`);
  }
  const last = await _git(root, `git log -1 --format='%h|%aI|%s' -- ${JSON.stringify(file)}`);
  if (last) {
    const [hash, date, ...r] = last.split("|");
    ev.push(EV.commit(hash, `${date?.slice(0, 10)} ${r.join("|")}`));
  }
  if (!bullets.length) {
    return {
      noEvidence: true,
      summary: `${file} 在 model / dependency-graph 裡都沒有關聯資料（可能未被掃進）`,
      evidence: last ? [EV.commit(last.split("|")[0], last)] : [],
    };
  }
  return { summary: `改 \`${file}\` 會影響：`, bullets, evidence: ev };
}

async function _deploy(root) {
  const pkg = _readJson(join(root, "package.json"), {});
  const scripts = pkg.scripts || {};
  const relDir = join(root, ".paaw", "releases");
  const releases = [];
  if (existsSync(relDir)) {
    for (const f of readdirSync(relDir).filter(x => x.endsWith(".json")).sort().reverse().slice(0, 3)) {
      const r = _readJson(join(relDir, f), null);
      if (r) releases.push(r);
    }
  }
  const ev = [];
  const bullets = [];
  const common = ["dev", "start", "build", "test"];
  for (const s of common) {
    if (scripts[s]) { bullets.push(`npm run ${s} — ${scripts[s]}`); ev.push(EV.doc("package.json", `scripts.${s}: ${scripts[s]}`)); }
  }
  for (const r of releases) {
    ev.push(EV.release(r.id || "?", `${r.releasedAt || "?"} ${r.title || ""}`));
  }
  if (releases.length) bullets.push(`最近 release：${releases.map(r => `${r.releasedAt?.slice(0, 10) || "?"} ${r.id}`).join("、")}`);
  if (!bullets.length) return { noEvidence: true, summary: "package.json 沒有部署相關 scripts，也沒有 release 記錄" };
  return { summary: "啟動 / 部署線索（依 package.json 與 release 記錄）：", bullets, evidence: ev };
}

async function _rollback(root) {
  const relDir = join(root, ".paaw", "releases");
  const releases = [];
  if (existsSync(relDir)) {
    for (const f of readdirSync(relDir).filter(x => x.endsWith(".json")).sort().reverse().slice(0, 3)) {
      const r = _readJson(join(relDir, f), null);
      if (r) releases.push(r);
    }
  }
  const ev = [];
  const bullets = [];
  for (const r of releases) ev.push(EV.release(r.id || "?", `${r.releasedAt || "?"} ${r.title || ""} taskId=${r.taskId || "?"}`));
  if (releases.length) bullets.push(`還原點（releases）：${releases.map(r => r.id).join("、")}`);
  // git 層還原指令
  const head = await _git(root, "git rev-parse --short HEAD");
  const prev = await _git(root, "git rev-parse --short HEAD~1");
  if (prev) {
    bullets.push(`git 還原：` + `git revert HEAD（產生反向 commit）或 git reset --hard ${prev}（本地硬退，先確認已 push 狀態）`);
    ev.push(EV.commit(prev, "上一個 commit（還原目標）"));
    if (head) ev.push(EV.commit(head, "目前 HEAD"));
  }
  if (!bullets.length) return { noEvidence: true, summary: "沒有 release 記錄也沒有 git 歷史可還原" };
  return { summary: "Rollback 線索：", bullets, evidence: ev };
}

async function _productionIssues(root) {
  // R4 handover-state 的 issues 段（自動保鮮）
  const st = _readJson(join(root, ".paaw", "handover-state.json"), null);
  const issues = st?.issues || [];
  const ev = [];
  if (issues.length) {
    for (const i of issues.slice(0, 5)) ev.push(EV.task(i.source, `[${i.type}] ${i.detail}`));
    return {
      summary: `目前有 ${issues.length} 個待處理訊號：`,
      bullets: issues.slice(0, 6).map(i => `[${i.type}] ${i.source} — ${i.detail}`),
      evidence: ev,
    };
  }
  // fallback：repairLoop / blocked tasks
  const tasks = _readJson(join(root, ".paaw", "tasks", "TASKS.json"), { tasks: [] }).tasks || [];
  const bad = tasks.filter(t => (t.repairLoop?.count || 0) > 0 || /blocked/i.test(String(t.status || "")));
  if (bad.length) {
    for (const t of bad.slice(0, 5)) ev.push(EV.task(t.id, `repairLoop=${t.repairLoop?.count ?? 0} status=${t.status}`));
    return { summary: `${bad.length} 個 task 帶修復/阻塞記錄：`, bullets: bad.map(t => `${t.id}（${t.status}${t.repairLoop ? `, repair×${t.repairLoop.count}` : ""}）`), evidence: ev };
  }
  return { noEvidence: true, summary: "handover-state 與 TASKS 裡都沒有 issue / repair / blocked 記錄", evidence: [EV.stat("handover-state.json", "issues: 0")] };
}

function _techDebt(root, model) {
  const g = model.knowledgeGaps || {};
  const ev = [];
  const bullets = [];
  if (g.hotUnmappedFiles?.length) {
    bullets.push(`高改動無歸屬：${g.hotUnmappedFiles.slice(0, 3).map(h => `${h.file}（${h.commits}）`).join("、")}`);
    ev.push(EV.file(g.hotUnmappedFiles[0].file, `${g.hotUnmappedFiles[0].commits} commits 未映射 feature`));
  }
  if (g.featuresWithoutTests?.length) {
    bullets.push(`${g.featuresWithoutTests.length} 個 features 無測試：${g.featuresWithoutTests.slice(0, 5).join("、")}`);
    ev.push(EV.stat("model.knowledgeGaps", "featuresWithoutTests"));
  }
  if (g.apisWithoutFeature?.length) {
    bullets.push(`${g.apisWithoutFeature.length} 個 API 無 feature 歸屬`);
    ev.push(EV.stat("model.knowledgeGaps", "apisWithoutFeature"));
  }
  if (!bullets.length) return { noEvidence: true, summary: "model 沒有抓到技術債訊號" };
  return { summary: "技術債（證據在 model.knowledgeGaps）：", bullets, evidence: ev };
}

// ── Intent 分類（規則順序 = 優先序）──

const INTENTS = [
  { id: "api-last-change", re: /(上次|最近|when|last).*(改|修|change|modif)|為什麼.*修改/, fn: _apiLastChange },
  { id: "field-origin", re: /(欄位|字段|field|變數|variable).*(哪|from|where|來)|where.*defined|定義在哪/, fn: _fieldOrigin },
  { id: "file-impact", re: /(影響|impact|改.*會怎樣|動.*會|affect)/, fn: _fileImpact },
  { id: "dangerous", re: /(危險|風險|danger|risk|hotspot|最容易壞|常出錯)/, fn: _dangerousPlaces },
  { id: "tech-debt", re: /(技術債|tech.*debt|debt|債)/, fn: _techDebt },
  { id: "production-issues", re: /(production|線上|issue|bug|incident|出錯|故障)/, fn: _productionIssues },
  { id: "rollback", re: /(rollback|回滾|回退|還原|revert)/, fn: _rollback },
  { id: "deploy", re: /(部署|deploy|上線|怎麼跑|啟動|start|run)/, fn: _deploy },
  { id: "why-design", re: /(為什麼|why|當初|設計.*原因|decision|adr)/, fn: _whyDesign },
  { id: "list-apis", re: /(有哪些|清單|list|all).*(api)|(api).*(有哪些|清單|list|all)/i, fn: (r, m) => _listApis(m) },
  { id: "find-feature", re: /(功能|feature).*(在哪|where|哪個)|找.*(功能|feature)/, fn: (r, m, q) => _findFeature(m, _matchFeature(m, q)) },
  { id: "project-purpose", re: /(做什麼|什麼專案|purpose|簡介|about|介绍)/, fn: _projectPurpose },
];

/**
 * 問答入口。
 * @returns { question, intent, matched, summary, bullets, evidence, noEvidence, followUps, modelGeneratedAt }
 */
export async function answerQuestion(projectRoot, question) {
  const q = String(question || "").trim();
  if (!q) return { question: "", intent: "empty", matched: false, summary: "空的問題", evidence: [], noEvidence: true };
  const model = await loadReleaseUnitModel(projectRoot);

  // file-impact / api-last-change 需要先確認問題真的帶標的，否則讓給別的 intent
  const intents = INTENTS.map(i => ({ ...i, hit: i.re.test(q) })).filter(i => i.hit);
  let handler = null, intent = "generic";
  for (const i of intents) {
    if (i.id === "file-impact" && !_extractFilePath(q)) continue;
    if (i.id === "api-last-change" && !(_extractRoutePath(q) || "").startsWith("/")) continue;
    handler = i.fn; intent = i.id; break;
  }

  let out;
  if (handler) {
    out = await handler(projectRoot, model, q) || {};
  } else {
    // generic：BM25 檢索層（askCodebase）
    const r = await askCodebase(projectRoot, q, { maxHits: 6 });
    const hits = r.hits || [];
    if (hits.length) {
      out = {
        summary: `關鍵詞命中 ${hits.length} 個檔案（BM25）：`,
        bullets: hits.slice(0, 5).map(h => `${h.file}（score ${h.score}）`),
        evidence: hits.slice(0, 5).map(h => EV.file(h.file, (h.snippet || "").slice(0, 80))),
      };
    } else {
      out = { noEvidence: true, summary: "找不到證據：關鍵詞在 codebase 與文件都沒有命中。" };
    }
    intent = "generic-search";
  }

  return {
    question: q,
    intent,
    matched: intent !== "generic-search",
    summary: out.summary || "",
    bullets: out.bullets || [],
    evidence: out.evidence || [],
    noEvidence: !!out.noEvidence,
    followUps: out.followUps || [],
    modelGeneratedAt: model.generatedAt,
  };
}

export const QA_INTENT_IDS = INTENTS.map(i => i.id);
