/**
 * Vision Phase 4 測試 — 舊圖降級 / 磁碟清理 / 多圖上限 / log 成本歸因
 * 跑法：node packages/server/test/vision-phase4.test.mjs
 */
import { strict as assert } from "assert";
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { messagesForModel, buildImageAttachmentMessage } from "../src/lib/vision-content.mjs";
import { pruneBrowserShots } from "../src/lib/browser-session.mjs";

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

const img = (n = 1) => Array.from({ length: n }, () => ({ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAA" } }));
const imgMsg = (role, text) => ({ role, content: [{ type: "text", text }, ...img()] });

// ── P4-1 舊圖降級：messagesForModel keepLastImages ──
console.log("─ messagesForModel 舊圖降級（vision model 也只留最後 K 張）");
t("5 則含圖歷史 + vision model → 只有最後 2 則留圖，其餘降級為佔位", () => {
  const msgs = [imgMsg("user", "q1"), imgMsg("user", "q2"), imgMsg("user", "q3"), imgMsg("user", "q4"), imgMsg("user", "q5")];
  const out = messagesForModel(msgs, true);
  const withImages = out.filter(m => Array.isArray(m.content) && m.content.some(p => p?.type === "image_url"));
  assert.equal(withImages.length, 2, "只留 2 則");
  assert.ok(withImages[0].content.some(p => p?.type === "text" && p.text.includes("q4")), "留的是 q4");
  assert.ok(withImages[1].content.some(p => p?.type === "text" && p.text.includes("q5")), "留的是 q5");
  const downgraded = out[0].content;
  assert.ok(downgraded.every(p => p.type !== "image_url"), "q1 圖被降級");
  assert.ok(downgraded.some(p => p.type === "text" && p.text.includes("舊")), "降級文字含『舊』提示");
});
t("非 vision model → 照舊全佔位（Phase 1 行為不變）", () => {
  const msgs = [imgMsg("user", "q1"), imgMsg("user", "q2")];
  const out = messagesForModel(msgs, false);
  assert.ok(out.every(m => !Array.isArray(m.content) || m.content.every(p => p.type !== "image_url")));
});
t("只有 2 則含圖 → 都保留（不降級）", () => {
  const msgs = [imgMsg("user", "q1"), imgMsg("user", "q2")];
  const out = messagesForModel(msgs, true);
  assert.equal(out.filter(m => Array.isArray(m.content) && m.content.some(p => p?.type === "image_url")).length, 2);
});
t("keepLastImages 可調（0 = 全降級）", () => {
  const msgs = [imgMsg("user", "q1")];
  const out = messagesForModel(msgs, true, { keepLastImages: 0 });
  assert.ok(out[0].content.every(p => p.type !== "image_url"));
});
t("純文字歷史 → 原陣列原樣回傳（零改動零成本）", () => {
  const msgs = [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }];
  assert.equal(messagesForModel(msgs, true), msgs);
});
t("不動原訊息（淺拷貝）", () => {
  const msgs = [imgMsg("user", "q1"), imgMsg("user", "q2"), imgMsg("user", "q3")];
  const before = JSON.stringify(msgs);
  messagesForModel(msgs, true);
  assert.equal(JSON.stringify(msgs), before, "原 messages 未被修改");
});
t("一則多圖 → 以訊息為單位判斷（保留名單內整則保留，名單外整則降級）", () => {
  const msgs = [
    { role: "user", content: [{ type: "text", text: "old" }, ...img(3)] }, // 3 圖一則（較舊）
    { role: "assistant", content: "ok" },
    { role: "user", content: [{ type: "text", text: "mid" }, ...img()] },
    { role: "user", content: [{ type: "text", text: "new" }, ...img()] },
  ];
  const out = messagesForModel(msgs, true); // keepLastImages=2 → 留 mid/new 兩則
  assert.ok(out[0].content.every(p => p.type !== "image_url"), "舊則 3 圖全降級");
  assert.ok(out[2].content.some(p => p?.type === "image_url"), "mid 保留");
  assert.ok(out[3].content.some(p => p?.type === "image_url"), "new 保留");
});

// ── P4-2 磁碟清理 ──
console.log("─ pruneBrowserShots");
const _dir = mkdtempSync(join(tmpdir(), "shots-"));
t("超量刪最舊、latest.png 永遠保留", () => {
  for (let i = 0; i < 7; i++) writeFileSync(join(_dir, `shot-${i}.png`), "x");
  writeFileSync(join(_dir, "latest.png"), "LATEST");
  const res = pruneBrowserShots(_dir, 3);
  const files = readdirSync(_dir).sort();
  assert.ok(files.includes("latest.png"), "latest.png 还在");
  assert.ok(files.includes("shot-6.png"), "最新的 shot 还在");
  assert.ok(!files.includes("shot-0.png"), "最舊的刪了");
  assert.ok(res.removed >= 4, `回報刪除數（removed=${res.removed}）`);
});
t("量不足 → 不刪", () => {
  const res = pruneBrowserShots(_dir, 50);
  assert.equal(res.removed, 0);
});
t("目錄不存在 → 不炸（removed 0）", () => {
  assert.equal(pruneBrowserShots(join(_dir, "nope"), 3).removed, 0);
});
rmSync(_dir, { recursive: true, force: true });

// ── P4-4 多圖上限 ──
console.log("─ buildImageAttachmentMessage maxImages");
t("6 張 → 只附最後 4 張 + label 註記省略", () => {
  const paths = [1, 2, 3, 4, 5, 6].map(i => {
    const p = join(tmpdir(), `p4m${i}-${Date.now()}.jpg`);
    writeFileSync(p, Buffer.from("/9j/4AAQSkZJRgABAQAAAgAAAgA=", "base64"));
    return p;
  });
  const m = buildImageAttachmentMessage(paths, "📸 截圖", { maxImages: 4 });
  const n = m.content.filter(p => p.type === "image_url").length;
  assert.equal(n, 4, "只附 4 張");
  assert.ok(m.content[0].text.includes("省略"), "label 有省略註記");
  paths.forEach(p => rmSync(p, { force: true }));
});
t("上限內 → 全附、label 原樣", () => {
  const p = join(tmpdir(), `p4s-${Date.now()}.jpg`);
  writeFileSync(p, Buffer.from("/9j/4AAQSkZJRg==","base64"));
  const m = buildImageAttachmentMessage([p], "📸 截圖");
  assert.ok(!m.content[0].text.includes("省略"));
  rmSync(p, { force: true });
});

console.log(`\n═══ Vision Phase 4: ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);
