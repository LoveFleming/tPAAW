/**
 * Test Signals — 測試自足性判定（語言無關）單元測試
 * 用合成 fixture 驗 py / go / java / ts / rust 五語言，證明「加語言 = 加資料 row」
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyTestFile, isTestPath, languageOf, computeTestSignals, loadTestSignalTables, validateTables } from "../../packages/server/src/lib/test-signals.mjs";

let root;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "tsig-"));
  const w = (p, c) => { mkdirSync(join(root, p, ".."), { recursive: true }); writeFileSync(join(root, p), c); };

  // TS：hermetic（純函式 + mock）
  w("src/fmt.ts", "export const fmt = (x: string) => x.trim();\n");
  w("src/fmt.test.ts", "import { fmt } from './fmt';\njest.mock('./x');\ntest('t', () => expect(fmt(' a ')).toBe('a'));\n");
  // TS：needs-key（讀 env key）
  w("src/auth.ts", "export const k = process.env.STRIPE_API_KEY;\n");
  w("src/auth.test.ts", "import { k } from './auth';\ntest('k', () => expect(k).toBeDefined());\n");
  // TS：needs-network（依賴檔硬寫外部端點）
  w("src/api/globals.ts", "export const BASE = 'https://api.vendor.dev/v1';\n");
  w("src/api/call.ts", "import { BASE } from './globals';\nexport const go = () => BASE;\n");
  w("src/api/call.test.ts", "import { go } from './call';\ntest('go', () => expect(go()).toBeTruthy());\n");

  // Python：hermetic（unittest.mock）
  w("py/test_util.py", "from unittest.mock import patch\n\ndef test_ok():\n    assert True\n");
  // Python：needs-network（requests）
  w("py/test_live.py", "import requests\n\ndef test_live():\n    assert requests.get('https://api.example.org/x')\n");
  // Python：needs-service（redis）
  w("py/test_cache.py", "import os\n\ndef test_cache():\n    os.environ.get('REDIS_URL')\n    assert True\n");

  // Go：hermetic（httptest mock）
  w("go/util_test.go", "package u\n\nimport \"testing\"\nimport \"net/http/httptest\"\n\nfunc TestUtil(t *testing.T) { _ = httptest.NewServer(nil) }\n");
  // Go：needs-network（真 http.Get 到外部）
  w("go/live_test.go", "package u\n\nimport \"testing\"\nimport \"net/http\"\n\nfunc TestLive(t *testing.T) { http.Get(\"https://api.stripe.com/v1\") }\n");

  // Java：hermetic（Mockito）
  w("java/src/test/java/CalcTest.java", "import org.mockito.Mockito;\npublic class CalcTest { @Test public void ok() {} }\n");
  // Java：needs-key
  w("java/src/test/java/KeyTest.java", "public class KeyTest { String k = System.getenv(\"OPENAI_API_KEY\"); }\n");

  // Rust：hermetic（in-process harness）
  w("rs/src/tests/harness.rs", "pub struct Harness;\n");
  w("rs/src/tests/cache.rs", "use crate::tests::harness::Harness;\n#[tokio::test]\nasync fn t() { let _ = Harness; }\n");
  // Rust：needs-service（redis）
  w("rs/src/tests/redis.rs", "use crate::tests::harness::Harness;\n#[tokio::test]\nasync fn t() { redis::Client::open(\"redis://localhost\"); }\n");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("test-signals：語言無關偵測", () => {
  it("測試檔慣例表涵蓋多語言", () => {
    expect(isTestPath("src/fmt.test.ts")).toBe(true);
    expect(isTestPath("py/test_util.py")).toBe(true);
    expect(isTestPath("go/util_test.go")).toBe(true);
    expect(isTestPath("java/src/test/java/CalcTest.java")).toBe(true);
    expect(isTestPath("rs/src/tests/cache.rs")).toBe(true);
    expect(isTestPath("src/fmt.ts")).toBe(false);
  });

  it("語言判定（extension 表，加語言只改 JSON）", () => {
    expect(languageOf("a.py")).toBe("py");
    expect(languageOf("a.go")).toBe("go");
    expect(languageOf("a.rs")).toBe("rust");
    expect(languageOf("a.java")).toBe("java");
    expect(languageOf("a.tsx")).toBe("ts");
  });

  const c = (p) => classifyTestFile(root, p).hermeticity;

  it("TS：hermetic / needs-key / needs-network（依賴 reach）三態都對", () => {
    expect(c("src/fmt.test.ts")).toBe("hermetic");
    expect(c("src/auth.test.ts")).toBe("needs-key");
    expect(c("src/api/call.test.ts")).toBe("needs-network");
  });

  it("Python：mock→hermetic、requests→needs-network、REDIS_URL→needs-service", () => {
    expect(c("py/test_util.py")).toBe("hermetic");
    expect(c("py/test_live.py")).toBe("needs-network");
    expect(c("py/test_cache.py")).toBe("needs-service");
  });

  it("Go：httptest→hermetic、真 http.Get→needs-network", () => {
    expect(c("go/util_test.go")).toBe("hermetic");
    expect(c("go/live_test.go")).toBe("needs-network");
  });

  it("Java：Mockito→hermetic、System.getenv key→needs-key", () => {
    expect(c("java/src/test/java/CalcTest.java")).toBe("hermetic");
    expect(c("java/src/test/java/KeyTest.java")).toBe("needs-key");
  });

  it("Rust：in-process harness→hermetic、redis→needs-service", () => {
    expect(c("rs/src/tests/cache.rs")).toBe("hermetic");
    expect(c("rs/src/tests/redis.rs")).toBe("needs-service");
  });

  it("summary 統計 + byFeature 彙總", () => {
    const files = ["src/fmt.test.ts", "src/auth.test.ts", "src/api/call.test.ts", "py/test_util.py"];
    const r = computeTestSignals(root, files, {
      featureIds: ["F-001", "F-002"],
      featureTests: [["src/fmt.test.ts", "src/api/call.test.ts"], ["src/auth.test.ts"]],
    });
    expect(r.summary.total).toBe(4);
    expect(r.summary.hermetic).toBe(2);
    expect(r.byFeature["F-001"].hermetic).toEqual(["src/fmt.test.ts"]);
    expect(r.byFeature["F-001"]["needs-network"]).toEqual(["src/api/call.test.ts"]);
    expect(r.byFeature["F-002"]["needs-key"]).toEqual(["src/auth.test.ts"]);
  });

  it("確定論：同輸入兩次結果相同", () => {
    const a = computeTestSignals(root, ["src/api/call.test.ts"]);
    const b = computeTestSignals(root, ["src/api/call.test.ts"]);
    expect({ ...a, generatedAt: 0 }).toEqual({ ...b, generatedAt: 0 });
  });

  it("表真的從 data/test-signals 載入（非硬編）", () => {
    const t = loadTestSignalTables(true);
    expect(Object.keys(t.hermeticity.languages)).toEqual(expect.arrayContaining(["ts", "py", "go", "java", "rust"]));
  });

  it("資料表健檢：所有 pattern 都是合法 regex（防靜默壞 pattern）", () => {
    expect(validateTables()).toEqual([]);
  });
});
