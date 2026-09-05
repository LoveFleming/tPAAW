/**
 * coding-skill-suggest.mjs — Skill 建議 API
 *
 * 「新 release unit 進來 → 機器掃 + LLM 註解 → 使用者知道可以設定 skill」
 *
 * 鐵律：事實靠程式，LLM 只註解。
 *   GET  /skill-suggest          — deterministic 掃描 + 規則表建議（零 token）
 *   POST /skill-suggest/annotate — LLM 只做兩件事：
 *       (1) 為既有建議寫一句「為什麼適合」（引用掃描證據）
 *       (2) 提最多 3 個 catalog 沒有的專案專屬 skill 點子
 *       LLM 不能增刪修改建議清單 — notes 只套用在程式產生的 skillId 上
 */

import { existsSync } from "fs";
import { suggestSkills, loadSkillCatalog } from "../lib/skill-suggest.mjs";
import { callProjectLLM } from "./coding.mjs";

export default async function skillSuggestRoutes(req, res, next) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = new URL(rawUrl, "http://localhost").searchParams;
  const projectPath = q.get("path");

  if (!url.startsWith("/api/coding-project/skill-suggest")) return next?.() ?? false;

  // ── GET — deterministic 建議清單（零 token、秒級）──
  if (url === "/api/coding-project/skill-suggest" && method === "GET") {
    if (!projectPath || !existsSync(projectPath)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "path required" }));
      return true;
    }
    try {
      const catalog = loadSkillCatalog();
      const result = suggestSkills(projectPath, { catalog });
      const catalogSkills = [...catalog.values()];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...result, catalogCount: catalogSkills.length }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── POST /annotate — LLM 註解（不改事實，只加說明與點子）──
  if (url === "/api/coding-project/skill-suggest/annotate" && method === "POST") {
    let body = {};
    try {
      let buf = "";
      await new Promise((resolve) => { req.on("data", (c) => { buf += c; }); req.on("end", resolve); req.on("error", resolve); });
      body = JSON.parse(buf || "{}");
    } catch { /* empty ok */ }
    const path = body.path || projectPath;
    if (!path || !existsSync(path)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "path required" }));
      return true;
    }
    try {
      const result = suggestSkills(path); // 事實一律伺服器重算 — 不吃 client 傳入      // 給 LLM 的精簡版（只留必要欄位，避免 prompt 過大）
      const compact = {
        detection: result.detection,
        unmatched: result.unmatched,
        suggestions: result.agents.map(a => ({
          agent: a.agentId, title: a.title,
          skills: a.suggestions.map(s => ({ id: s.skillId, name: s.skillName, evidence: s.evidence, status: s.status })),
        })),
      };
      const system = [
        "你是 PAAW coding app 的 skill 配對助理。輸入是程式掃描（deterministic）產生的偵測結果與 skill 建議。",
        "你的工作只有兩件：",
        "1. 為每個建議的 skill 寫一句為什麼適合這個專案（20 字內，具體引用偵測到的證據，不要空話）。",
        "2. 如果偵測結果中有規則表配不到的技術（unmatched）或你看出專案特性，提出最多 3 個 catalog 沒有的專案專屬 skill 點子。",
        "嚴格禁止：增加、刪除、修改建議清單本身。你只能註解既有的 skillId。",
        "只輸出 JSON，格式：",
        '{"notes":{"<skillId>":"一句話原因"},"customIdeas":[{"name":"skill 名稱","purpose":"用途一句話","reason":"為什麼這專案需要"}]}',
        "customIdeas 可為空陣列。沒有把握的註解就寫「偵測到 X，強化相關實作」這種基於證據的描述，不要編造。",
      ].join("\n");
      const llm = await callProjectLLM({
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(compact) },
        ],
        temperature: 0.2,
        thinking: { type: "disabled" },
      }, { caller: "em", agentId: "em", timeoutMs: 120_000, maxRetries: 2 });

      let notes = {}, customIdeas = [];
      if (llm?.content) {
        let txt = llm.content.trim();
        const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fence) txt = fence[1].trim();
        const start = txt.indexOf("{"), end = txt.lastIndexOf("}");
        if (start >= 0 && end > start) {
          const parsed = JSON.parse(txt.slice(start, end + 1));
          // notes 只保留程式產生的 skillId（LLM 不能偷渡新建議）
          const validIds = new Set(result.agents.flatMap(a => a.suggestions.map(s => s.skillId)));
          for (const [k, v] of Object.entries(parsed.notes || {})) {
            if (validIds.has(k) && typeof v === "string") notes[k] = v.slice(0, 120);
          }
          customIdeas = (parsed.customIdeas || [])
            .filter(i => i && i.name && i.purpose)
            .slice(0, 3)
            .map(i => ({ name: String(i.name).slice(0, 60), purpose: String(i.purpose).slice(0, 160), reason: String(i.reason || "").slice(0, 160) }));
        }
      }
      const aiOn = !!(llm?.content);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true, aiOn,
        notes, customIdeas,
        generatedAt: result.generatedAt,
        ...(aiOn ? {} : { warn: "LLM 不可用（未設 provider key）— 顯示 deterministic 建議" }),
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return next?.() ?? false;
}
