/**
 * release-unit/architecture.mjs — 模組邊界視圖
 *
 * 把依賴圖依目錄分組（modules），算模組內/跨模組連結，
 * 找高耦合邊與樞紐檔 — 「改 A 不該碰 B」的邊界感從這裡來。
 */

import { buildDependencyGraph } from "./dependencies.mjs";

/** 檔案 → 模組 key（前兩層目錄；根目錄檔案自己一組） */
function moduleOf(file) {
  const segs = file.split("/");
  if (segs.length === 1) return "(root)";
  if (segs.length === 2) return segs[0];
  return `${segs[0]}/${segs[1]}`;
}

/**
 * 模組邊界視圖
 * @returns { modules: [{name, files, internalEdges, outgoing, incoming, coupling}],
 *            crossEdges: [{from, to, count, topEdge}], hubs: [{file, module, dependents}] }
 */
export async function architectureView(root, opts = {}) {
  const graph = await buildDependencyGraph(root, opts);

  const modFiles = {};
  for (const f of Object.keys(graph.deps)) {
    const m = moduleOf(f);
    (modFiles[m] ||= []).push(f);
  }

  // 邊統計
  const within = {};   // module → 內部邊數
  const cross = {};    // "from→to" → count
  const incoming = {}; // module → 被跨模組依賴次數
  for (const [f, targets] of Object.entries(graph.deps)) {
    const mf = moduleOf(f);
    for (const t of targets) {
      const mt = moduleOf(t);
      if (mf === mt) { within[mf] = (within[mf] || 0) + 1; continue; }
      const key = `${mf}→${mt}`;
      cross[key] = (cross[key] || 0) + 1;
      incoming[mt] = (incoming[mt] || 0) + 1;
    }
  }

  const modules = Object.entries(modFiles).map(([name, files]) => {
    const outgoing = Object.entries(cross)
      .filter(([k]) => k.startsWith(name + "→"))
      .reduce((s, [, n]) => s + n, 0);
    return {
      name,
      files: files.length,
      internalEdges: within[name] || 0,
      outgoing,                        // 我依賴別的模組幾次
      incoming: incoming[name] || 0,   // 別的模組依賴我幾次
      coupling: (within[name] || 0) + outgoing + (incoming[name] || 0),
    };
  }).sort((a, b) => b.coupling - a.coupling);

  const crossEdges = Object.entries(cross)
    .map(([k, count]) => {
      const [from, to] = k.split("→");
      // 找一條代表邊（這個 module pair 的第一條）
      let topEdge = null;
      for (const [f, targets] of Object.entries(graph.deps)) {
        if (moduleOf(f) !== from) continue;
        const hit = targets.find(t => moduleOf(t) === to);
        if (hit) { topEdge = `${f} → ${hit}`; break; }
      }
      return { from, to, count, topEdge };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);

  // 樞紐檔（被依賴最多 top 15）
  const hubs = Object.entries(graph.rdeps)
    .map(([f, deps]) => ({ file: f, module: moduleOf(f), dependents: deps.length }))
    .filter(h => h.dependents > 0)
    .sort((a, b) => b.dependents - a.dependents)
    .slice(0, 15);

  return {
    root: graph.root,
    adapter: graph.adapter,
    generatedAt: new Date().toISOString(),
    graphMeta: { fileCount: graph.fileCount, fromCache: graph.fromCache },
    modules,
    crossEdges,
    hubs,
  };
}
