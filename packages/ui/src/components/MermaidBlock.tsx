/**
 * MermaidBlock — 在 markdown 聊天裡渲染 ```mermaid 圍欄為圖形（2026-10-23 Fleming）
 *
 * 設計原則：
 * - 只攔 language-mermaid 的 code fence，其他 code block 完全走原路（零風險）
 * - 渲染失敗 → 自動退回原始碼顯示（= 沒有這個功能前的樣子，永不白屏）
 * - mermaid 套件大（~1.5MB）→ dynamic import，第一次真的遇到 mermaid 圍欄才載入
 * - securityLevel: "strict"（mermaid 預設）— 剝除事件綁定，防 XSS
 *
 * 全站接線（5 個點，所有 chat UI 覆蓋）：
 *   MarkdownText（→ AgentSideChat 所有 side chat / TaskBoard / EMDashboard / FeatureMap /
 *     HandoverPanel / IssueTracker / QaRecords / CodeReviewBoardPanel / ProjectMdPage）
 *   ChatMessages（coding app 主聊天 / AppBuilder / AgentConsole）· ChatView（主聊天）
 *   HelpDesk · SkillBuilder · FileViewer
 */
import React, { memo, useEffect, useRef, useState } from "react";

let mermaidPromise: Promise<any> | null = null;

// 2026-11-21 Fleming：圖内字型要跟外面正文一致（原本 monospace 跟 system-ui 正文不搭）
const APP_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Noto Color Emoji", sans-serif';
let uidCounter = 0;

function loadMermaid(): Promise<any> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      const mermaid = m.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "neutral",
        securityLevel: "strict",
        // 2026-11-15：parse error 時先清掉 body 暫存 div 再 throw（否則殘留錯誤文字 → 整頁外層多捲軸，Fleming 回報「coding app 被汙染」）
        suppressErrorRendering: true,
        fontFamily: APP_FONT,
        // 2026-10-23 Fleming：圖内文字與 chat 本文同大小（.md-content = text-sm 14px），不突兀
        themeVariables: { fontSize: "14px" },
        // 2026-11-21 Fleming：循序圖原本吃 mermaid 預設 16px，跟正文/其他圖不一致 → 三種文字統一 14px + 同字族
        sequence: {
          useMaxWidth: false,
          actorFontSize: 14, actorFontFamily: APP_FONT,
          messageFontSize: 14, messageFontFamily: APP_FONT,
          noteFontSize: 14, noteFontFamily: APP_FONT,
        },
        // 2026-10-23 Fleming：關掉 useMaxWidth —— mermaid 預設把整張圖縮到容器寬，
        // 寬圖（graph LR 多節點）被壓縮 → 14px 字視覺上劑 6px。改原始尺寸，太寬就横向捲動（跟 code block 同行為）
        flowchart: { useMaxWidth: false },
        class: { useMaxWidth: false },
        state: { useMaxWidth: false },
        er: { useMaxWidth: false },
        journey: { useMaxWidth: false },
        gantt: { useMaxWidth: false },
        pie: { useMaxWidth: false },
        mindmap: { useMaxWidth: false },
        timeline: { useMaxWidth: false },
        gitGraph: { useMaxWidth: false },
      });
      return mermaid;
    }).catch((e) => { mermaidPromise = null; throw e; }); // 載入失敗可重試
  }
  return mermaidPromise;
}

// 2026-11-15：mermaid 12.2.0 的 parse-error 路徑會把 #d<id> 暫存 div 遺留在 document.body
// （throw 發生在 removeTempElements 之前）→ 錯誤文字直接渲染在頁面尾端，最外層多一條捲軸。
// 2026-11-23 fix：只清「自己這塊」的暫存 div — 之前掃除所有 dmmd-*，
// 同頁多圖並發渲染時會把別張圖正在用的暫存 div 刷掉 → "Cannot read properties of null (reading 'getAttribute')"
// （症狀：某張圖 parse 失敗後，隔壁正常圖也跟著掛）。
function sweepStrayMermaidDivs(ownId?: string) {
  if (ownId) {
    document.querySelectorAll(`body > [id="dmmd-${ownId}"], body > [id="dmmd-${ownId}-fix"], body > [id="d${ownId}"]`).forEach((el) => el.remove());
    return;
  }
  document.querySelectorAll('body > [id^="dmmd-"]').forEach((el) => el.remove());
}

// 2026-11-19 Fleming：Prod Spec（spec-fill AI 產的 mermaid）常見地雷 —
// edge label `-->|POST /internal 或 /external/{app_name}\nX-API-Key|` 這種未加引號的 label
// 內含 { } / \n / 斜線等特殊字元 → parse error（Expecting 'SQE', 'DOUBLECIRC'…）。
// 修法：把未加引號的 |label| 與 node[text] 改成加引號版本（" 內部跳成 #quot;、\n → <br/>），
// 之後 { } / 斜線都是合法字元。只在原文 render 失敗時才用品修版重試（原文能用就零改動）。
function mermaidQuoteFixup(code: string): string {
  const esc = (s: string) => s.replace(/"/g, "#quot;").replace(/\\n/g, "<br/>");
  return code.split("\n").map((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("%%") || /^(classDef|style|class|ac)\b/.test(trimmed)) return line;
    let out = line.replace(/\|([^"|\n]+)\|/g, (_m, s: string) => `|"${esc(s)}"|`); // edge label
    out = out.replace(/([\w-]+)\[([^\]"]*)\]/g, (m, id: string, s: string) =>
      (s.startsWith("/") && s.endsWith("/")) ? m : `${id}["${esc(s)}"]`); // node text（保留 [/.../] 平行四邊形）
    // 2026-11-23：sequenceDiagram 地雷 — participant 別名叫到保留字（Loop/alt/...）
// 會被 langium 當 keyword → parse error（got 'loop'）。品修版只改「actor 位置」的保留字：
// ① participant/actor 宣告的第 2 個 token（ID，非 alias）② signal 線的箭頭兩端 ③ activate/deactivate 對象。
// 冒號後訊息文字、as alias 一律不動。
    const SEQ_RESERVED = /^(loop|alt|opt|par|and|else|critical|option|break|rect|box|autonumber|end|loop)$/i;
    const renameReserved = (w: string) => SEQ_RESERVED.test(w) ? `${w}_` : w;
    if (/^\s*(participant|actor)\s+\S/.test(out)) {
      out = out.replace(/^([ \t]*(?:participant|actor)[ \t]+)(\S+)/, (_m, pre, id) => pre + renameReserved(id));
    } else if (/^\s*(activate|deactivate)\s+\S/.test(out)) {
      out = out.replace(/^([ \t]*(?:activate|deactivate)[ \t]+)(\S+)/, (_m, pre, id) => pre + renameReserved(id));
    } else if (/->>|-->>/.test(out)) {
      const colonIdx = out.indexOf(":");
      const head = colonIdx >= 0 ? out.slice(0, colonIdx) : out;
      const tail = colonIdx >= 0 ? out.slice(colonIdx) : "";
      out = head.replace(/[A-Za-z][\w-]*/g, renameReserved) + tail;
    }
    return out;
  }).join("\n");
}

export const MermaidBlock = memo(function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const idRef = useRef<string>(`mmd-${++uidCounter}`);

  useEffect(() => {
    let alive = true;
    setSvg(null);
    setErr(null);
    sweepStrayMermaidDivs(idRef.current); // 2026-11-23：只清自己 — 全清會誤殺同頁並發渲染中的其他圖
    loadMermaid().then(async (mermaid) => {
      // 2026-11-19：漸進 fallback — 原文先試；parse error 再用品修版（label 加引號）重試，都失敗才退原始碼
      let out: string;
      try {
        out = (await mermaid.render(idRef.current, code)).svg;
      } catch {
        sweepStrayMermaidDivs(idRef.current);
        out = (await mermaid.render(`${idRef.current}-fix`, mermaidQuoteFixup(code))).svg;
      }
      if (alive) setSvg(out);
    }).catch((e: any) => {
      if (alive) setErr(String(e?.message || e));
    }).finally(() => {
      // 成功或失敗都掃一次：mermaid 用同一 id 重渲染時 removeExistingElements 只認 svg 座標，保險起見手動清
      sweepStrayMermaidDivs(idRef.current);
    });
    return () => { alive = false; };
  }, [code]);

  // 失敗 → 退回原始碼（不渲染圖）；成功 → 圖 + 可切原始碼
  if (err && !svg) {
    return (
      <div className="my-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
        <div className="text-[10px] text-amber-600 mb-1">⚠️ Mermaid 渲染失敗（{err.slice(0, 120)}）— 顯示原始碼</div>
        <pre className="text-[11px] font-mono whitespace-pre-wrap text-stone-600">{code}</pre>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-lg border border-stone-200 bg-white p-2 overflow-x-auto relative group">
      <button
        onClick={() => setShowRaw((v) => !v)}
        className="absolute top-1.5 right-1.5 z-10 text-[10px] px-1.5 py-0.5 rounded border border-stone-200 bg-white/90 text-stone-400 hover:text-stone-600 opacity-0 group-hover:opacity-100 transition-opacity"
        title={showRaw ? "顯示圖形" : "顯示原始碼"}
      >{showRaw ? "📊 圖" : "📄 碼"}</button>
      {showRaw || !svg ? (
        <pre className="text-[11px] font-mono whitespace-pre-wrap text-stone-500">{code}</pre>
      ) : (
        <div className="mermaid-svg-wrap [&_svg]:block [&_svg]:mx-auto">
          {/* CSS 錘子：mermaid v12 的 htmlLabel（foreignObject 裡的 span）不吃 themeVariables.fontSize，
              且 SVG text 的 font-size 是 presentation attribute（CSS 優先序最低層）→ !important 一定赢 */}
          <style>{`.mermaid-svg-wrap span, .mermaid-svg-wrap p, .mermaid-svg-wrap div, .mermaid-svg-wrap text, .mermaid-svg-wrap tspan, .mermaid-svg-wrap .messageText, .mermaid-svg-wrap .actor, .mermaid-svg-wrap .noteText, .mermaid-svg-wrap .labelText, .mermaid-svg-wrap .loopText { font-size: inherit !important; font-family: ${APP_FONT} !important; }`}</style>
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      )}
    </div>
  );
});

/**
 * 任何 <ReactMarkdown components={...}> 都可直接掛的 pre override：
 * ```mermaid fence → MermaidBlock；其他 → 原生 <pre>（行為完全不變）
 */
export function mdPreWithMermaid({ children, ...props }: any) {
  const child: any = Array.isArray(children) ? children[0] : children;
  const cls: string = child?.props?.className || "";
  if (/language-mermaid/.test(cls)) {
    const code = String(child?.props?.children ?? "").replace(/\n$/, "");
    return <MermaidBlock code={code} />;
  }
  return <pre {...props}>{children}</pre>;
}
