/**
 * sre module — server entry（架構 clone 自 pm module）
 * routes：crews / services / dossiers / sheets / grafana / briefing，統一 /api/sre/* 前綴
 *
 * 掛載時（entry 被 import）就會 ensure 職能專家 crews（data/crews/sre.*.json）
 * 與服務檔案櫃骨架 — 冪等，唯讀環境靜默。
 */
import { ensureBuiltinCrews } from "./routes/crews.mjs";

export default async function handler(req, res) {
  const r0 = (await import("./routes/crews.mjs")).default;
  if (await r0(req, res)) return true;
  const r1 = (await import("./routes/services.mjs")).default;
  if (await r1(req, res)) return true;
  const r2 = (await import("./routes/dossiers.mjs")).default;
  if (await r2(req, res)) return true;
  const r3 = (await import("./routes/sheets.mjs")).default;
  if (await r3(req, res)) return true;
  const r4 = (await import("./routes/grafana.mjs")).default;
  if (await r4(req, res)) return true;
  const r5 = (await import("./routes/briefing.mjs")).default;
  if (await r5(req, res)) return true;
  return false;
}

// 掛載即 ensure（不擋載入；失敗只記 log）
try { ensureBuiltinCrews(); } catch (e) { console.error(`[sre] ensureBuiltinCrews 失敗：${e.message}`); }
