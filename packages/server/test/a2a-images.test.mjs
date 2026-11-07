// 2026-08-30：a2a 貼圖 — extractImages 路徑驗證測試
// 跑法：node packages/server/test/a2a-images.test.mjs
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}

// a2a.mjs 有 export extractImages — 測真函數
const mod = await import("../src/routes/a2a.mjs");
const extractImages = mod.extractImages;
if (typeof extractImages !== "function") {
  console.error("❌ a2a.mjs 沒 export extractImages"); process.exit(1);
}

console.log("== extractImages 驗證 ==");
const mk = (paths) => ({ role: "user", parts: [{ type: "text", text: "hi" }, ...paths.map(p => ({ type: "image", path: p }))] });
check("合法路徑通過", JSON.stringify(extractImages(mk(["uploads/1759152000000-abc123.jpg"]))) === JSON.stringify(["uploads/1759152000000-abc123.jpg"]));
check("拒絕 ../ 穿越", extractImages(mk(["../etc/passwd"])).length === 0);
check("拒絕 uploads/../x.jpg", extractImages(mk(["uploads/../x.jpg"])).length === 0);
check("拒絕絕對路徑", extractImages(mk(["/etc/x.jpg"])).length === 0);
check("拒絕 data/uploads/x（非 uploads/ 開頭）", extractImages(mk(["data/uploads/x.jpg"])).length === 0);
check("混合：合法保留、非法丟棄", JSON.stringify(extractImages(mk(["uploads/a.png", "../evil"]))) === JSON.stringify(["uploads/a.png"]));
check("去重", JSON.stringify(extractImages(mk(["uploads/a.png", "uploads/a.png"]))) === JSON.stringify(["uploads/a.png"]));
check("上限 4 張", extractImages(mk(["uploads/1.jpg","uploads/2.jpg","uploads/3.jpg","uploads/4.jpg","uploads/5.jpg"])).length === 4);
check("無 parts → 空陣列", extractImages({ role: "user" }).length === 0);
check("null → 空陣列", extractImages(null).length === 0);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
