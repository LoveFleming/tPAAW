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
let uidCounter = 0;

function loadMermaid(): Promise<any> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      const mermaid = m.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "neutral",
        securityLevel: "strict",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        // 2026-10-23 Fleming：圖内文字與 chat 本文同大小（.md-content = text-sm 14px），不突兀
        themeVariables: { fontSize: "14px" },
      });
      return mermaid;
    }).catch((e) => { mermaidPromise = null; throw e; }); // 載入失敗可重試
  }
  return mermaidPromise;
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
    loadMermaid().then(async (mermaid) => {
      const { svg } = await mermaid.render(idRef.current, code);
      if (alive) setSvg(svg);
    }).catch((e: any) => {
      if (alive) setErr(String(e?.message || e));
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
        <div className="mermaid-svg-wrap flex justify-center [&_svg]:max-w-full">
          {/* CSS 錘子：mermaid v12 的 htmlLabel（foreignObject 裡的 span）不吃 themeVariables.fontSize，
              且 SVG text 的 font-size 是 presentation attribute（CSS 優先序最低層）→ !important 一定赢 */}
          <style>{`.mermaid-svg-wrap span, .mermaid-svg-wrap p, .mermaid-svg-wrap div, .mermaid-svg-wrap text { font-size: 14px !important; }`}</style>
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
