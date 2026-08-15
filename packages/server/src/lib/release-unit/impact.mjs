/**
 * release-unit/impact.mjs — 改動影響分析引擎
 *
 * 給定一組改動檔案，在依賴圖上做 reverse BFS：
 * 誰直接/間接依賴這些檔案 → 會被影響的範圍。
 * changeType=delete 時另做 forward BFS（我依賴的東西會斷）。
 *
 * 零 LLM 成本 — 純圖計算（總計畫 §9：靜態分析不花 token）。
 */

import { buildDependencyGraph, normalizeFileKey } from "./dependencies.mjs";

/** BFS：從 seeds 沿 edgeMap 走，回傳 { node, depth }（depth=1 是直接依賴者） */
function bfs(seeds, edgeMap) {
  const visited = new Map(); // node → depth
  let frontier = [...seeds];
  let depth = 0;
  for (const s of seeds) visited.set(s, 0);
  while (frontier.length) {
    depth += 1;
    const next = [];
    for (const node of frontier) {
      for (const dep of edgeMap[node] || []) {
        if (!visited.has(dep)) {
          visited.set(dep, depth);
          next.push(dep);
        }
      }
    }
    frontier = next;
  }
  return visited;
}

/**
 * 影響分析
 * @param {string} root 專案根
 * @param {string[]} files 改動檔案（相對/絕對/檔名皆可，normalizeFileKey 容錯）
 * @param {object} opts { changeType: "modify"|"add"|"delete", refresh }
 */
export async function impactAnalysis(root, files, opts = {}) {
  const changeType = opts.changeType || "modify";
  const graph = await buildDependencyGraph(root, opts);

  const resolved = [];
  const unresolved = [];
  for (const f of files || []) {
    const key = normalizeFileKey(graph, f);
    if (key) resolved.push(key); else unresolved.push(String(f).replace(/\\/g, "/"));
  }

  // reverse BFS：誰依賴我（modify/add 都適用 — 我變了，依賴我的人受影響）
  const affected = bfs(resolved, graph.rdeps);
  for (const s of resolved) affected.delete(s);

  // forward BFS：我依賴誰（delete 時 = 我拿掉的東西會斷鏈；modify 時 = 參考脈絡）
  const downstream = bfs(resolved, graph.deps);
  for (const s of resolved) downstream.delete(s);

  const byDepth = {};
  for (const [node, depth] of affected) {
    (byDepth[depth] ||= []).push(node);
  }
  for (const k of Object.keys(byDepth)) byDepth[k].sort();

  const affectedList = [...affected.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([file, depth]) => ({ file, depth })); // depth 1 = 直接依賴者

  return {
    root: graph.root,
    changeType,
    generatedAt: new Date().toISOString(),
    graphMeta: { adapter: graph.adapter, fileCount: graph.fileCount, fromCache: graph.fromCache },
    changed: resolved,
    unresolved,
    affected: affectedList,          // [{file, depth}] — depth 1 = 直接依賴者
    affectedCount: affectedList.length,
    dependsOn: changeType === "delete"
      ? [...downstream.keys()].sort()  // 我依賴的東西（刪除後會斷）
      : [...downstream.keys()].sort().slice(0, 50), // 參考脈絡（最多列 50）
    hotspots: topHubs(graph, resolved, affectedList),
  };
}

/** 影響範圍內的樞紐檔（被最多人依賴的受害者 — 改動要特別小心） */
function topHubs(graph, changed, affected) {
  const inScope = new Set([...changed, ...affected.map(a => a.file)]);
  const counts = [];
  for (const f of inScope) {
    const n = (graph.rdeps[f] || []).length;
    if (n > 0) counts.push({ file: f, dependents: n });
  }
  return counts.sort((a, b) => b.dependents - a.dependents).slice(0, 10);
}
