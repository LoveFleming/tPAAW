// ── Flight Recorder（黑盒子）──
// 目的：「server 無聲死亡、什麼 log 都沒有」的案件，靠 heartbeat 一定找得到死亡時間與死法類別。
//
// 行為：
//   - BOOT/EXIT/SIGTERM/SIGINT 事件各寫一行（含 pid）
//   - 每 30 秒寫一行 alive + heap/rss 記憶體曲線
//     * heap OOM 死亡：alive 行的 heapUsed 會一路爬升然後停止，沒有 EXIT 行
//     * JS crash：crash log + EXIT 行都在
//     * SIGKILL/斷電：heartbeat 停止、沒有 EXIT 行、crash log 也沒有
//   - 檔案輪替：boot 時若超過 1MB，改名 .old（只留一代）
//
// 檔案位置：DATA_HOME/logs/server-heartbeat.log
import { appendFileSync, statSync, renameSync, existsSync } from "fs";
import { join } from "path";

export function startFlightRecorder(DATA_HOME) {
  const dir = join(DATA_HOME, "logs");
  const path = join(dir, "server-heartbeat.log");
  const mark = (msg) => {
    try { appendFileSync(path, `${new Date().toISOString()} pid=${process.pid} ${msg}\n`); } catch { /* best effort */ }
  };

  // 輪替（>1MB 改名 .old）
  try {
    if (existsSync(path) && statSync(path).size > 1024 * 1024) {
      renameSync(path, path + ".old");
    }
  } catch {}

  mark(`BOOT node=${process.version} platform=${process.platform}`);

  const timer = setInterval(() => {
    const m = process.memoryUsage();
    mark(`alive heap=${Math.round(m.heapUsed / 1048576)}MB rss=${Math.round(m.rss / 1048576)}MB`);
  }, 30_000);
  timer.unref?.(); // 不阻擋 process 退出

  process.on("exit", (code) => mark(`EXIT code=${code}`));
  process.on("SIGTERM", () => { mark("SIGTERM"); process.exit(0); });
  process.on("SIGINT", () => { mark("SIGINT"); process.exit(0); });
  return mark;
}
