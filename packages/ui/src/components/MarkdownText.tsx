import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Shared markdown renderer for all AI chat surfaces.
 * Renders full markdown: headings, lists, tables, code blocks, bold/italic, links, blockquotes.
 * Use className="md-dark" for dark-themed parents (AgentConsole).
 */
export default function MarkdownText({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`md-content text-sm leading-relaxed ${className}`}>
      <style>{`
        .md-content > *:first-child { margin-top: 0; }
        .md-content > *:last-child { margin-bottom: 0; }
        .md-content h1 { font-size: 1.125rem; font-weight: 700; margin: 0.75rem 0 0.5rem; }
        .md-content h2 { font-size: 1rem; font-weight: 700; margin: 0.75rem 0 0.5rem; }
        .md-content h3 { font-size: 0.875rem; font-weight: 700; margin: 0.5rem 0 0.25rem; }
        .md-content h4 { font-size: 0.875rem; font-weight: 600; margin: 0.5rem 0 0.25rem; }
        .md-content p { margin: 0.375rem 0; }
        .md-content ul { list-style: disc; padding-left: 1.25rem; margin: 0.375rem 0; }
        .md-content ol { list-style: decimal; padding-left: 1.25rem; margin: 0.375rem 0; }
        .md-content li { margin: 0.125rem 0; }
        .md-content strong { font-weight: 700; }
        .md-content em { font-style: italic; }
        .md-content a { color: #2563eb; text-decoration: underline; }
        .md-content a:hover { color: #1d4ed8; }
        .md-content blockquote { border-left: 3px solid #d6d3d1; padding-left: 0.75rem; margin: 0.5rem 0; font-style: italic; }
        .md-content hr { border: none; border-top: 1px solid #e7e5e4; margin: 0.75rem 0; }
        .md-content code { padding: 0.125rem 0.25rem; border-radius: 0.25rem; font-size: 0.75rem; font-family: ui-monospace, monospace; }
        .md-content pre { margin: 0.5rem 0; padding: 0.75rem; border-radius: 0.5rem; overflow-x: auto; }
        .md-content pre code { padding: 0; border-radius: 0; font-size: 0.75rem; }
        .md-content table { margin: 0.5rem 0; border-collapse: collapse; width: 100%; font-size: 0.75rem; }
        .md-content th, .md-content td { border: 1px solid #d6d3d1; padding: 0.25rem 0.5rem; }
        .md-content th { background: #f5f5f4; font-weight: 700; text-align: left; }
        .md-content ul ul, .md-content ol ol, .md-content ul ol, .md-content ol ul { margin: 0; }
        /* Light mode defaults */
        .md-content { color: #44403c; }
        .md-content h1, .md-content h2 { color: #292524; }
        .md-content h3, .md-content h4 { color: #44403c; }
        .md-content strong { color: #292524; }
        .md-content code { background: #f5f5f4; color: #292524; }
        .md-content pre { background: #1c1917; }
        .md-content pre code { color: #f5f5f4; background: transparent; }
        .md-content blockquote { color: #57534e; }
        /* Dark mode override */
        .md-dark { color: #e7e5e4; }
        .md-dark h1, .md-dark h2 { color: #fafaf9; }
        .md-dark h3, .md-dark h4 { color: #e7e5e4; }
        .md-dark strong { color: #fafaf9; }
        .md-dark li { color: #d6d3d1; }
        .md-dark code { background: #292524; color: #e7e5e4; }
        .md-dark pre { background: #000; }
        .md-dark pre code { color: #e7e5e4; }
        .md-dark blockquote { border-left-color: #57534e; color: #a8a29e; }
        .md-dark a { color: #60a5fa; }
        .md-dark a:hover { color: #93c5fd; }
        .md-dark th { background: #292524; }
        .md-dark th, .md-dark td { border-color: #44403c; }
        .md-dark hr { border-top-color: #44403c; }
      `}</style>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
