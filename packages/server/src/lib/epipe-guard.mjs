// ── EPIPE guard — 必須是 paaw-server.mjs 的第一個 import ──
// stdout/stderr 管道斷掉（parent terminal 關閉、concurrently 重啟、背景執行、pipe 消費端消失）時，
// 任何 console.log 都會炸 write EPIPE uncaught exception → 連環風暴 → process 死亡。
// 實例：2026-08-27 09:08 Mac mini，2 秒內 1878 個 crash file，process 死亡。
// ESM static import 比 module body 更早執行，所以這段防護必須放在獨立模組、
// 掛在 import 清單第一位，才能保證在任何其他模組 console.log 之前生效。
for (const _stream of [process.stdout, process.stderr]) {
  _stream?.on?.("error", (e) => { if (e?.code === "EPIPE") return; throw e; });
}
