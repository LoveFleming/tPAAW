/**
 * Asset Log Migration — 2026-10-05 Fleming 定調：log 只用一個目錄
 *
 * 舊位置 data/logs/{llm,agent,cron} → 新位置 log/logs/{llm,agent,cron}
 * 啟動時一次性冪等遷移：只搬還在舊位置的檔（同名不覆蓋 — 新檔以新位置為準）。
 */
import { readdirSync, mkdirSync, renameSync, existsSync, statSync, rmSync } from "fs";
import { join } from "path";
import { DATA_HOME, ASSET_LOGS_ROOT } from "../data-home.mjs";

const SUBS = ["llm", "agent", "cron"];

export function migrateAssetLogs() {
  const oldRoot = join(DATA_HOME, "logs");
  if (!existsSync(oldRoot)) return { moved: 0 };
  let moved = 0;
  mkdirSync(ASSET_LOGS_ROOT, { recursive: true });
  for (const sub of SUBS) {
    const from = join(oldRoot, sub);
    const to = join(ASSET_LOGS_ROOT, sub);
    if (!existsSync(from)) continue;
    mkdirSync(to, { recursive: true });
    for (const f of readdirSync(from)) {
      const src = join(from, f);
      const dst = join(to, f);
      if (existsSync(dst)) {
        // 同名不覆蓋：舊檔刪掉即可（新位置已是活檔）
        try {
          const s = statSync(src);
          if (s.isFile()) rmSync(src); else rmSync(src, { recursive: true, force: true });
        } catch {}
        continue;
      }
      try { renameSync(src, dst); moved++; } catch {}
    }
    try { rmSync(from, { recursive: true, force: true }); } catch {}
  }
  // 舊根剩散檔（server-console.log 等 runtime 垃圾）— 直接刪，janitor 之後也會掃
  for (const f of readdirSync(oldRoot)) {
    try { rmSync(join(oldRoot, f), { recursive: true, force: true }); } catch {}
  }
  try { rmSync(oldRoot, { recursive: true, force: true }); } catch {}
  if (moved > 0) console.log(`[asset-log-migrate] moved ${moved} files data/logs → log/logs`);
  return { moved };
}
