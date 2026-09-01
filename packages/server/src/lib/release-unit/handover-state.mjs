/**
 * release-unit/handover-state.mjs — Handover State 正規化（R4）
 *
 * 目標：「任何時刻 AI 停掉，人打開 workspace 就能接手」。
 *
 * 與 coding-handover.mjs bundle 的差別：bundle 是 on-demand 快照（人按才生成），
 * handover state 是**持續保鮮**的自動刷新 — task 每次變動（saveTasks/commit/dispatch）
 * fire-and-forget 重算，隨時落地兩份檔案：
 *   .paaw/handover-state.json — machine-readable（R5 Q&A 可引用）
 *   .paaw/HANDOVER.md         — human-readable（新人接手讀這份）
 *
 * 六段結構（north star R4）：
 *   currentState / workingPlan / changes / issues / decisions / nextAction
 *
 * 全部 deterministic（git + 檔案聚合），零 LLM。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { shellExec } from "../shell-exec.mjs";

const DECISIONS_RE = /^## (ADR-\d+):\s*(.+)$/gm;

// ── git helpers（全部防禦：無 git 環境回 null）──

async function _git(root, cmd) {
  try {
    const { stdout } = await shellExec(cmd, { cwd: root, timeout: 10_000 });
    return (stdout || "").trim();
  } catch { return null; }
}

async function _gitLines(root, cmd) {
  const out = await _git(root, cmd);
  return out === null ? [] : out.split("\n").filter(Boolean);
}

// ── Builders ──

async function _currentState(root) {
  const branch = await _git(root, "git rev-parse --abbrev-ref HEAD");
  const headSha = await _git(root, "git rev-parse --short HEAD");
  const statusLines = await _gitLines(root, "git status --porcelain -uall");
  const unpushed = await _gitLines(root, "git log @{u}..HEAD --oneline --no-decorate 2>/dev/null || git log origin/dev..HEAD --oneline --no-decorate 2>/dev/null || true");
  return {
    branch, headSha,
    dirtyCount: statusLines.length,
    dirtyFiles: statusLines.slice(0, 30),
    unpushedCount: unpushed.length,
    unpushedCommits: unpushed.slice(0, 10),
  };
}

function _pipelineNext(task) {
  const order = ["spec", "implement", "review", "test", "qa", "docs", "commit"];
  const pl = task.pipeline || {};
  const inProgress = order.find(p => pl[p]?.status === "in_progress");
  if (inProgress) return { phase: inProgress, status: "in_progress", next: `finish ${inProgress}` };
  const pending = order.find(p => !pl[p] || pl[p].status === "pending");
  if (pending) return { phase: pending, status: "pending", next: `run ${pending}` };
  return { phase: null, status: "done", next: null };
}

function _workingPlan(tasks) {
  const active = tasks
    .filter(t => !["resolved", "done", "cancelled", "closed", "close", "ignore"].includes(String(t.status || "").toLowerCase()))
    .slice(0, 12)
    .map(t => {
      const pn = _pipelineNext(t);
      return {
        id: t.id, title: (t.title || t.spec?.title || "").slice(0, 100),
        status: t.status, priority: t.priority || null,
        phase: pn.phase, phaseStatus: pn.status, next: pn.next,
      };
    });
  return { activeTasks: active, activeCount: active.length };
}

async function _changes(root) {
  const recent = await _gitLines(root, "git log -10 --format='%h|%aI|%s'");
  return {
    recentCommits: recent.map(l => {
      const [hash, date, ...rest] = l.split("|");
      return { hash, date, subject: rest.join("|").slice(0, 120) };
    }),
  };
}

function _issues(tasks) {
  const issues = [];
  for (const t of tasks) {
    // 1. pipeline 卡住：in_progress 超过 1 天未動
    const pl = t.pipeline || {};
    for (const [phase, st] of Object.entries(pl)) {
      if (st?.status === "in_progress" && st.at) {
        const ageH = (Date.now() - new Date(st.at).getTime()) / 3_600_000;
        if (ageH > 24) issues.push({ type: "stalled-phase", source: t.id, detail: `${phase} in_progress ${ageH.toFixed(0)}h（${st.at.slice(0, 16)}）` });
      }
    }
    // 2. repair loop 曾觸發
    if (t.repairLoop?.count > 0) issues.push({ type: "repair-loop", source: t.id, detail: `修復循環 ${t.repairLoop.count} 次` });
    // 3. review boundary 有 out-of-scope 檔案未決
    if (t.reviewBoundary?.summary?.hasUnexpected) {
      const n = t.reviewBoundary.summary.unexpected;
      issues.push({ type: "scope-violation", source: t.id, detail: `${n} 個 out-of-scope 檔案待人決策` });
    }
    // 4. task 標記 blocked
    if (/blocked/i.test(String(t.status || ""))) issues.push({ type: "blocked", source: t.id, detail: t.status });
  }
  return issues.slice(0, 20);
}

function _decisions(root) {
  const file = join(root, ".paaw", "DECISIONS.md");
  if (!existsSync(file)) return { file: null, recent: [] };
  try {
    const md = readFileSync(file, "utf-8");
    const entries = [];
    let m;
    const re = new RegExp(DECISIONS_RE.source, "gm");
    while ((m = re.exec(md)) !== null) {
      entries.push({ id: m[1], title: m[2].slice(0, 120) });
    }
    // 找每條 ADR 的日期（下一行 ±日期:）
    const withDates = entries.map((e, i) => {
      const startIdx = md.indexOf(`## ${e.id}:`);
      const chunk = md.slice(startIdx, startIdx + 400);
      const dm = chunk.match(/\*\*日期\*\*:\s*([\d-]+)/);
      return { ...e, date: dm?.[1] || null };
    });
    return { file: ".paaw/DECISIONS.md", count: withDates.length, recent: withDates.slice(-5).reverse() };
  } catch { return { file: ".paaw/DECISIONS.md", recent: [] }; }
}

function _nextAction(state, plan, issues) {
  // Derivation chain：未 commit > 未 push > in_progress > 有 issue > 下一 phase > idle
  if (state.dirtyCount > 0) {
    return { step: "commit", reason: `${state.dirtyCount} 個未提交檔案`, detail: state.dirtyFiles.slice(0, 5) };
  }
  if (state.unpushedCount > 0) {
    return { step: "push", reason: `${state.unpushedCount} 個本地 commit 未 push`, detail: state.unpushedCommits.slice(0, 3) };
  }
  const running = plan.activeTasks.find(t => t.phaseStatus === "in_progress");
  if (running) {
    return { step: "continue-phase", reason: `${running.id} ${running.phase} 進行中`, detail: running.title };
  }
  const scopeIssue = issues.find(i => i.type === "scope-violation");
  if (scopeIssue) {
    return { step: "review-boundary", reason: `${scopeIssue.source} 有 out-of-scope 變更待決策`, detail: scopeIssue.detail };
  }
  const nextPending = plan.activeTasks.find(t => t.phaseStatus === "pending" && t.next);
  if (nextPending) {
    return { step: "dispatch-phase", reason: `${nextPending.id} 下一階段：${nextPending.phase}`, detail: nextPending.title };
  }
  return { step: "idle", reason: "無進行中工作 — 檢查 backlog 或建新 task", detail: null };
}

// ── Main ──

export async function buildHandoverState(projectRoot) {
  const tasksFile = join(projectRoot, ".paaw", "tasks", "TASKS.json");
  let tasks = [];
  if (existsSync(tasksFile)) {
    try {
      const d = JSON.parse(readFileSync(tasksFile, "utf-8"));
      tasks = Array.isArray(d) ? d : (d.tasks || []);
    } catch { /* keep empty */ }
  }
  const initialized = existsSync(join(projectRoot, ".paaw"));
  const currentState = await _currentState(projectRoot);
  const workingPlan = _workingPlan(tasks);
  const changes = await _changes(projectRoot);
  const issues = _issues(tasks);
  const decisions = _decisions(projectRoot);
  const nextAction = _nextAction(currentState, workingPlan, issues);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    initialized,
    currentState,
    workingPlan,
    changes,
    issues,
    decisions,
    nextAction,
  };
}

/** 落地 JSON + 人類可讀 MD */
export async function writeHandoverState(projectRoot, state = null) {
  const st = state || await buildHandoverState(projectRoot);
  const dir = join(projectRoot, ".paaw");
  if (!existsSync(dir)) return st; // 未初始化專案不寫
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "handover-state.json"), JSON.stringify(st, null, 2), "utf-8");
    writeFileSync(join(dir, "HANDOVER.md"), renderHandoverMd(st), "utf-8");
  } catch { /* 唯讀環境照樣回傳 */ }
  return st;
}

/** 人類可讀版（六段結構） */
export function renderHandoverMd(st) {
  const L = [];
  const s = st.currentState;
  L.push("# HANDOVER — 交接狀態");
  L.push("");
  L.push(`> 生成：${st.generatedAt} · 自動保鮮（task 變動即更新）· 下一步：**${st.nextAction.step}** — ${st.nextAction.reason}`);
  L.push("");
  L.push("## 1. 現在的狀態（currentState）");
  L.push("");
  L.push(`- Branch: \`${s.branch ?? "?"}\` @ \`${s.headSha ?? "?"}\``);
  L.push(`- 未提交檔案: **${s.dirtyCount}**${s.dirtyCount ? " ⚠️" : " ✅"}`);
  if (s.dirtyCount) L.push("  - " + s.dirtyFiles.slice(0, 10).join("\n  - "));
  L.push(`- 未 push commits: **${s.unpushedCount}**${s.unpushedCount ? " ⚠️" : " ✅"}`);
  if (s.unpushedCount) L.push("  - " + s.unpushedCommits.slice(0, 5).join("\n  - "));
  L.push("");
  L.push("## 2. 進行中的工作（workingPlan）");
  L.push("");
  if (st.workingPlan.activeTasks.length) {
    for (const t of st.workingPlan.activeTasks) {
      L.push(`- **${t.id}** [${t.status}] ${t.title}`);
      L.push(`  - pipeline: ${t.phase ?? "—"}（${t.phaseStatus}）→ 下一動：${t.next ?? "—"}`);
    }
  } else L.push("_(沒有進行中的 task)_");
  L.push("");
  L.push("## 3. 最近變更（changes）");
  L.push("");
  if (st.changes.recentCommits.length) {
    for (const c of st.changes.recentCommits) L.push(`- \`${c.hash}\` ${c.date?.slice(0, 10) ?? ""} ${c.subject}`);
  } else L.push("_(無 git 歷史)_");
  L.push("");
  L.push("## 4. 待處理問題（issues）");
  L.push("");
  if (st.issues.length) {
    for (const i of st.issues) L.push(`- ⚠️ [${i.type}] **${i.source}** — ${i.detail}`);
  } else L.push("✅ _無卡關_");
  L.push("");
  L.push("## 5. 最近決策（decisions）");
  L.push("");
  if (st.decisions.recent?.length) {
    for (const d of st.decisions.recent) L.push(`- \`${d.id}\` ${d.date ?? ""} ${d.title}`);
    L.push(`_完整 ADR：${st.decisions.file}_`);
  } else L.push("_(尚未有 ADR 記錄)_");
  L.push("");
  L.push("## 6. 下一步（nextAction）");
  L.push("");
  L.push(`> **${st.nextAction.step}** — ${st.nextAction.reason}`);
  if (st.nextAction.detail) {
    const d = st.nextAction.detail;
    L.push(Array.isArray(d) ? "```\n" + d.join("\n") + "\n```" : `> ${d}`);
  }
  return L.join("\n");
}

/** 讀現有 handover state；缺檔或過期（HEAD/TASKS 變了）→ 重建落地 */
export async function loadHandoverState(projectRoot) {
  const file = join(projectRoot, ".paaw", "handover-state.json");
  if (existsSync(file)) {
    try {
      const st = JSON.parse(readFileSync(file, "utf-8"));
      // 過期判定：HEAD 或 TASKS.json mtime 比 generatedAt 新
      const tasksFile = join(projectRoot, ".paaw", "tasks", "TASKS.json");
      const staleByTasks = existsSync(tasksFile) && new Date(statSync(tasksFile).mtimeMs).toISOString() > st.generatedAt;
      if (!staleByTasks) {
        const head = await _git(projectRoot, "git rev-parse --short HEAD");
        if (!head || head === st.currentState?.headSha) return { ...st, stale: false };
      }
    } catch { /* fallthrough rebuild */ }
  }
  return writeHandoverState(projectRoot);
}

// ── Auto-refresh（debounced fire-and-forget）──

const _pending = new Map(); // root -> timer

/** task/pipeline 變動後呼叫 — 2 秒 debounce 聚焦同批寫入，再落一次檔 */
export function scheduleHandoverRefresh(projectRoot) {
  if (!projectRoot) return;
  const prev = _pending.get(projectRoot);
  if (prev) clearTimeout(prev);
  _pending.set(projectRoot, setTimeout(() => {
    _pending.delete(projectRoot);
    writeHandoverState(projectRoot).catch(() => {});
  }, 2_000));
}
