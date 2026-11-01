/**
 * ui-features.repo — 前端 route-first feature map 基本契約
 * 一列 = 一個前端進入點（route）；apiCalls 是前後端 impact 橋樑。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveUiFeatures, readUiFeatures, findUiByApiCall } from "../../packages/server/src/lib/coding-db/ui-features.repo.mjs";

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ui-feat-"));
  mkdirSync(join(root, ".paaw"), { recursive: true });
});

describe("ui-features.repo", () => {
  it("route 必填：無 route 的列被丟掉", () => {
    const n = saveUiFeatures(root, [
      { id: "U20261101-001", route: "/practice", name: "練習頁" },
      { noRoute: true, name: "孤兒" },
    ]);
    expect(n).toBe(1);
    expect(readUiFeatures(root)).toHaveLength(1);
  });

  it("全量替換：第二次 save 清掉舊資料", () => {
    saveUiFeatures(root, [{ id: "U1", route: "/a", name: "A" }]);
    saveUiFeatures(root, [{ id: "U2", route: "/b", name: "B" }]);
    const all = readUiFeatures(root);
    expect(all).toHaveLength(1);
    expect(all[0].route).toBe("/b");
  });

  it("JSON 欄位（uiFlow/components/apiCalls）序列化來回", () => {
    saveUiFeatures(root, [{
      id: "U20261101-001", category: "練習", route: "/practice", name: "每日練習",
      uiFlow: [{ step: 1, action: "載入題目", component: "PracticePage" }],
      components: ["PracticePage.tsx"], stateMgmt: "local state",
      apiCalls: ["POST /api/learning/practice/generate"], codeFiles: ["pages/PracticePage.tsx"],
    }]);
    const [u] = readUiFeatures(root);
    expect(u.uiFlow[0].action).toBe("載入題目");
    expect(u.components).toEqual(["PracticePage.tsx"]);
    expect(u.apiCalls).toEqual(["POST /api/learning/practice/generate"]);
  });

  it("findUiByApiCall：後端 entry 反查前端 route（跨端 impact）", () => {
    saveUiFeatures(root, [
      { id: "U1", route: "/practice", name: "A", apiCalls: ["POST /api/learning/practice/generate"] },
      { id: "U2", route: "/wrong-book", name: "B", apiCalls: ["GET /api/wrong-book"] },
    ]);
    expect(findUiByApiCall(root, "POST /api/learning/practice/generate").map(u => u.route)).toEqual(["/practice"]);
    expect(findUiByApiCall(root, "GET /nope")).toEqual([]);
  });

  it("read 未初始化 db → 空 array 不炸", () => {
    rmSync(join(root, ".paaw", "coding.db"), { force: true });
    expect(readUiFeatures(join(root, "nope"))).toEqual([]);
  });
});
