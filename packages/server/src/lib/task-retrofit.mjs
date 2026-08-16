/**
 * task-retrofit.mjs — 上線前品質補強（feature map 版）
 *
 * 2026-08-16 Fleming 定調：
 * - bootstrap 階段 task 走短版 pipeline（spec→implement→commit），快速看功能
 * - 上線前一次補品質債（review/test/qa/docs）
 * - 補強單位從 feature map 建（代碼現況），不從歷史 task 建
 *   （早期 task 的產出可能已被後來的 task 蓋掉）
 *
 * 使用者：paaw-agent-loop.mjs 的 task_retrofit tool + coding-releases routes
 */

import { readFile, writeFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const FULL = ["spec", "implement", "review", "test", "qa", "docs", "commit"];

function loadFeatures(cwd) {
  const featuresFile = join(cwd, ".paaw", "features", "FEATURES.json");
  if (!existsSync(featuresFile)) return { error: "no-features-file" };
  try {
    const fdata = JSON.parse(readFileSync(featuresFile, "utf-8"));
    return {
      features: (Array.isArray(fdata) ? fdata : fdata.features || []),
      updatedAt: fdata?.updatedAt || null,
    };
  } catch (e) {
    return { error: `FEATURES.json parse 失敗: ${e.message}` };
  }
}

async function loadTasks(cwd) {
  const tasksFile = join(cwd, ".paaw", "tasks", "TASKS.json");
  if (!existsSync(tasksFile)) return { error: "no-tasks-file" };
  const data = JSON.parse(await readFile(tasksFile, "utf-8"));
  return { data, tasks: Array.isArray(data) ? data : data.tasks };
}

function isOpen(t) {
  return !["resolved", "closed", "released", "rejected"].includes(t.status);
}

/**
 * 品質債現況：active feature × 測試/文檔覆蓋 × 未結案補強 task
 */
export async function qualityDebtSummary(cwd) {
  const f = loadFeatures(cwd);
  if (f.error) return { ok: false, error: f.error };
  const t = await loadTasks(cwd);
  if (t.error) return { ok: false, error: t.error };
  const { tasks } = t;

  const openRetrofits = tasks
    .filter(x => x.source?.type === "feature-retrofit" && isOpen(x))
    .map(x => ({ taskId: x.id, featureId: x.source.retrofitFor, title: x.title, status: x.status }));
  const retroByFeature = new Map();
  for (const r of openRetrofits) {
    if (!retroByFeature.has(r.featureId)) retroByFeature.set(r.featureId, []);
    retroByFeature.get(r.featureId).push(r);
  }

  const active = f.features.filter(x => x.status !== "deprecated");
  const features = active.map(x => {
    const hasTests = (x.tests?.length || 0) > 0;
    const hasDocs = Boolean(x.documentation && String(x.documentation).trim());
    return {
      id: x.id,
      name: x.name,
      codeFiles: x.codeFiles?.length || 0,
      hasTests,
      hasDocs,
      openRetrofit: (retroByFeature.get(x.id) || []).length,
    };
  });

  return {
    ok: true,
    featuresUpdatedAt: f.updatedAt,
    totalFeatures: f.features.length,
    activeFeatures: active.length,
    noTests: features.filter(x => !x.hasTests).length,
    noDocs: features.filter(x => !x.hasDocs).length,
    openRetrofitTasks: openRetrofits.length,
    features,
  };
}

/**
 * 執行補強：每個 active feature 建一張全版 pipeline task
 * （spec/implement 預 done refer feature 現況；已有 tests/docs 的階段預 done）
 * 冪等：該 feature 已有未結案 retrofit task 就跳過
 */
export async function runTaskRetrofit(cwd, opts = {}) {
  const f = loadFeatures(cwd);
  if (f.error === "no-features-file") {
    return { ok: false, error: "找不到 .paaw/features/FEATURES.json — 先跑 feature map 掃描再補強。" };
  }
  if (f.error) return { ok: false, error: f.error };

  const t = await loadTasks(cwd);
  if (t.error) return { ok: false, error: "No tasks file." };
  const { data, tasks } = t;
  const now = new Date().toISOString();

  const wanted = opts.featureIds?.length ? new Set(opts.featureIds) : null;
  const invalid = wanted ? [...wanted].filter(id => !f.features.some(x => x.id === id)) : [];
  if (invalid.length) return { ok: false, error: `未知 feature id：${invalid.join(", ")}` };
  const features = f.features.filter(x => x.status !== "deprecated" && (!wanted || wanted.has(x.id)));
  if (features.length === 0) {
    return { ok: false, error: `沒有符合條件的 feature（active${wanted ? " + featureIds 過濾" : ""}）。FEATURES.json 共 ${f.features.length} 個。` };
  }

  // 反查脈絡：哪些 task 動過這個 feature 的檔案（只當 description 脈絡，不是補強單位）
  const fileToTasks = new Map();
  for (const x of tasks) {
    const files = [...(x.changes?.filesModified || []), ...(x.changes?.filesAdded || [])];
    for (const file of files) {
      if (!fileToTasks.has(file)) fileToTasks.set(file, []);
      fileToTasks.get(file).push(x.id);
    }
  }

  const openRetrofitFor = new Set(
    tasks
      .filter(x => x.source?.type === "feature-retrofit" && isOpen(x))
      .map(x => x.source?.retrofitFor)
      .filter(Boolean)
  );

  let nextNum = Math.max(0, ...tasks.map(x => parseInt((x.id || "").replace(/^TASK-/, "")) || 0));
  const created = [];
  const skipped = [];
  for (const feat of features) {
    if (openRetrofitFor.has(feat.id)) { skipped.push(feat.id); continue; }
    const hasTests = (feat.tests?.length || 0) > 0;
    const hasDocs = Boolean(feat.documentation && String(feat.documentation).trim());
    const related = [...new Set((feat.codeFiles || []).flatMap(cf => fileToTasks.get(cf) || []))].slice(0, 5);
    nextNum++;
    const id = `TASK-${String(nextNum).padStart(3, "0")}`;
    const pipe = {
      spec:      { status: "done", by: "agent", at: now, note: `feature ${feat.id} 已存在，不重做規格` },
      implement: { status: "done", by: "agent", at: now, note: "既有實作（feature map 現況）" },
      review:    { status: "pending" },
      test:      hasTests ? { status: "done", by: "agent", at: now, note: `已有測試：${(feat.tests || []).join(", ")}` } : { status: "pending" },
      qa:        { status: "pending" },
      docs:      hasDocs ? { status: "done", by: "agent", at: now, note: "documentation 已存在" } : { status: "pending" },
      commit:    { status: "pending" },
    };
    const needPhases = FULL.filter(ph => pipe[ph].status === "pending");
    tasks.push({
      id,
      title: `【品質補強】${feat.id} ${feat.name}`,
      type: "test",
      status: "open",
      priority: opts.priority || "high",
      parentId: null,
      description: `Release retrofit — 上線前品質補強（從 feature map 建立）。
Feature：${feat.id} ${feat.name} — ${feat.description || ""}
代碼檔案：
${(feat.codeFiles || []).map(cf => "- " + cf).join("\n") || "(從 FEATURES.json 查無檔案，先重跑 feature 掃描)"}
需補階段：${needPhases.join(" → ")}${hasTests ? "（已有測試，不重補 test 階段）" : ""}${hasDocs ? "（docs 已存在）" : ""}
驗收：review 看現況代碼問題、關鍵路徑補測試、qa 驗收、docs 補文件。不重做實作。${related.length ? `\n相關歷史 task（脈絡參考）：${related.join(", ")}` : ""}`,
      labels: ["release-retrofit", ...(feat.tags || [])],
      assignee: null,
      createdAt: now,
      updatedAt: now,
      createdBy: "agent",
      source: { type: "feature-retrofit", retrofitFor: feat.id },
      spec: {
        description: `補 ${needPhases.join("/")} for feature ${feat.id}`,
        acceptanceCriteria: [
          "review 完成（問題清單或 approve 紀錄）",
          "關鍵路徑測試補齊且通過",
          "qa 驗證 feature 功能正常",
          "docs 更新（README/API/changelog）",
        ],
        fileScope: feat.codeFiles || [],
        outOfScope: ["重新實作功能", "大幅重構"],
      },
      pipeline: pipe,
      pipelinePhases: FULL,
      pipelineMode: "full",
      changes: { filesAdded: [], filesModified: [], filesDeleted: [] },
      git: { baseCommit: null, branch: null, staged: false, committedSha: null },
      notes: [{ text: `由 task_retrofit 自動生成，來源 feature ${feat.id}`, at: now, by: "agent" }],
      discussion: [],
    });
    created.push({ id, featureId: feat.id, featureName: feat.name, needPhases });
  }

  if (created.length > 0) {
    data.updatedAt = now;
    const tasksFile = join(cwd, ".paaw", "tasks", "TASKS.json");
    await writeFile(tasksFile, JSON.stringify(data, null, 2), "utf-8");
  }

  const lines = [`✅ Release retrofit（feature map 版）：掃到 ${features.length} 個 active feature，新建 ${created.length} 個品質補強 task`];
  if (skipped.length) lines.push(`（${skipped.length} 個已有未結案 retrofit，略過：${skipped.join(", ")}）`);
  if (created.length) {
    lines.push("新建：");
    for (const c of created) lines.push(`- ${c.id}（${c.featureId} ${c.featureName}${c.needPhases.length < 4 ? "，補 " + c.needPhases.join("/") : ""}）`);
  } else {
    lines.push("（沒有需要補的）");
  }
  return { ok: true, scanned: features.length, created, skipped, message: lines.join("\n") };
}
