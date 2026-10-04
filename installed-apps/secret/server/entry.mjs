/**
 * secret module — server entry
 * routes：dossiers / categories / sheets / briefing，統一 /api/secret/* 前綴
 */
export default async function handler(req, res) {
  const r1 = (await import("./routes/dossiers.mjs")).default;
  if (await r1(req, res)) return true;
  const r2 = (await import("./routes/categories.mjs")).default;
  if (await r2(req, res)) return true;
  const r3 = (await import("./routes/sheets.mjs")).default;
  if (await r3(req, res)) return true;
  const r4 = (await import("./routes/briefing.mjs")).default;
  if (await r4(req, res)) return true;
  return false;
}
