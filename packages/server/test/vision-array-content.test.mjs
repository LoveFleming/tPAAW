/**
 * Vision Phase 1 地基測試 — array content 全鏈相容 + 佔位保護
 * 跑法：node packages/server/test/vision-array-content.test.mjs
 * 全部 PASS 才能改 loop（2026-08-30 Fleming 要求：改 LLM 互動不要帶 bug）
 */
import { strict as assert } from "assert";
import { contentToText, hasImages, estimateContentTokens, messagesForModel } from "../src/lib/vision-content.mjs";
import { estimateMessageTokens, shouldCompact } from "../src/lib/context-compaction.mjs";

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

const imgMsg = { role: "user", content: [
  { type: "text", text: "這個畫面哪裡壞了" },
  { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
]};
const plainMsg = { role: "user", content: "純文字訊息" };
const asstMsg = { role: "assistant", content: "回答內容" };

console.log("─ contentToText");
t("array → 文字 + 圖片標記", () => assert.ok(contentToText(imgMsg.content).includes("這個畫面哪裡壞了") && contentToText(imgMsg.content).includes("1 張圖")));
t("string 原樣回傳", () => assert.equal(contentToText("hello"), "hello"));
t("null → 空字串", () => assert.equal(contentToText(null), ""));
t("只有圖 → 只有標記", () => assert.equal(contentToText([{ type: "image_url", image_url: { url: "x" } }]), "[+1 張圖]"));

console.log("─ hasImages");
t("含圖 true", () => assert.equal(hasImages([imgMsg]), true));
t("純文字 false", () => assert.equal(hasImages([plainMsg, asstMsg]), false));
t("空陣列 false", () => assert.equal(hasImages([]), false));

console.log("─ estimateContentTokens");
t("array 含圖 > 純文字部分", () => assert.ok(estimateContentTokens(imgMsg.content) > 1500));
t("string 走 estimateTokens", () => assert.ok(estimateContentTokens("hello world 你好") > 3));

console.log("─ estimateMessageTokens（compaction 相容）");
t("含圖訊息不炸且計入圖 token", () => {
  const withImg = estimateMessageTokens([imgMsg]);
  const textOnly = estimateMessageTokens([{ role: "user", content: "這個畫面哪裡壞了" }]);
  assert.ok(withImg - textOnly >= 1500, `diff=${withImg - textOnly}`);
});
t("shouldCompact 含圖不炸", () => {
  const r = shouldCompact([imgMsg, asstMsg], 128000, 16384);
  assert.equal(typeof r.shouldCompact, "boolean");
});

console.log("─ messagesForModel（佔位保護）");
t("非 vision：圖換佔位、文字保留", () => {
  const out = messagesForModel([imgMsg], false);
  assert.ok(!hasImages(out));
  assert.equal(typeof out[0].content, "object"); // 仍是 array（text part 保留）
  const text = contentToText(out[0].content);
  assert.ok(text.includes("這個畫面哪裡壞了"));
  assert.ok(text.includes("不支援影像"));
});
t("vision model：原封不動", () => {
  const out = messagesForModel([imgMsg], true);
  assert.equal(hasImages(out), true);
});
t("無圖訊息：回傳原陣列", () => {
  const msgs = [plainMsg];
  assert.equal(messagesForModel(msgs, false), msgs);
});
t("原訊息不被改動（淺拷貝）", () => {
  messagesForModel([imgMsg], false);
  assert.equal(hasImages([imgMsg]), true);
});
t("混合訊息：只動含圖的", () => {
  const out = messagesForModel([plainMsg, imgMsg, asstMsg], false);
  assert.equal(out[0], plainMsg);
  assert.equal(out[2], asstMsg);
  assert.ok(!hasImages(out));
});

console.log(`\n${failed === 0 ? "🎉 ALL PASS" : "💥 FAILED"} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
