// exec-approvals — 審批卡決策（2026-10-09；2026-10-13 加：同指令批次結案）
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { requestApproval, decideApproval, consumeApproval, listApprovalHistory } from "../../packages/server/src/lib/exec-approvals.mjs";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "exec-apr-"));
});

describe("exec-approvals decideApproval", () => {
  // 2026-10-13：審批屬「發起的那個 agent」— 紀錄要帶 agentId，UI 才能只在該 crew 視窗顯示
  it("agentId：紀錄帶發起 agent，listApprovalHistory 讀得回來", () => {
    const cmd = "curl https://evil.example/x";
    const id = requestApproval(cmd, dir, "外部 URL", "developer");
    decideApproval(id, "deny");
    const hist = listApprovalHistory(dir, 10);
    expect(hist.length).toBe(1);
    expect(hist[0].agentId).toBe("developer");
    expect(hist[0].decided).toBe("deny");
    rmSync(dir, { recursive: true, force: true });
  });

  it("once：決策後同一條指令可消耗一次", () => {
    const cmd = "curl http://evil.example/x";
    const id = requestApproval(cmd, dir, "外部 URL");
    const r = decideApproval(id, "once");
    expect(r.ok).toBe(true);
    expect(r.command).toBe(cmd);
    expect(consumeApproval(cmd, dir)).toBe("once"); // 消耗掉
    expect(consumeApproval(cmd, dir)).toBeFalsy();  // 第二次就沒了
    rmSync(dir, { recursive: true, force: true });
  });

  it("always：寫入 <RU>/.paaw/exec-approvals.json", () => {
    const cmd = "npm run evil";
    const id = requestApproval(cmd, dir, "危險 script");
    const r = decideApproval(id, "always");
    expect(r.ok).toBe(true);
    const p = join(dir, ".paaw", "exec-approvals.json");
    expect(existsSync(p)).toBe(true);
    expect(JSON.parse(readFileSync(p, "utf-8"))[Object.keys(JSON.parse(readFileSync(p, "utf-8")))[0]].command).toBe(cmd);
    expect(consumeApproval(cmd, dir)).toBe("always");
    expect(consumeApproval(cmd, dir)).toBe("always"); // 永久，不會被消耗
    rmSync(dir, { recursive: true, force: true });
  });

  it("🎯 同一條指令累積多張審批卡 → 決策一次全部結案（alsoIds）", () => {
    const cmd = "curl http://evil.example/y";
    const a = requestApproval(cmd, dir, "r1");
    const b = requestApproval(cmd, dir, "r2");
    const c = requestApproval(cmd, dir, "r3");
    const other = requestApproval("curl http://evil.example/z", dir, "r4");
    const r = decideApproval(b, "always");
    expect(r.ok).toBe(true);
    // 同指令的 a、c 一起結掉；不同指令的 other 不受影響
    expect(r.alsoIds.sort()).toEqual([a, c].sort());
    expect(decideApproval(a, "deny").ok).toBe(false);   // 已結案 → 找不到
    expect(decideApproval(other, "deny").ok).toBe(true); // 仍在
    rmSync(dir, { recursive: true, force: true });
  });

  it("無效 action 不會有副作用（卡片仍可再決策）", () => {
    const cmd = "curl http://evil.example/w";
    const id = requestApproval(cmd, dir, "x");
    expect(decideApproval(id, "bogus").ok).toBe(false);
    expect(decideApproval(id, "deny").ok).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("找不到 id → ok:false（已過期/已決策）", () => {
    expect(decideApproval("apr_not_exist", "once").ok).toBe(false);
  });
});
