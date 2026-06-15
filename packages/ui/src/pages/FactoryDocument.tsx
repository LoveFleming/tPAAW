import API_BASE from "../api";
import React, { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { useTheme } from "../theme";

interface Slide {
    title: string;
    html: string;
}

interface Props {
    file: string;           // filename without .md, e.g. "quick-tour"
    headerIcon?: string;
    headerTitle?: string;
    headerSub?: string;
}

export default function FactoryDocument({ file, headerIcon = "document", headerTitle, headerSub }: Props) {
    const { info: t } = useTheme();
    const [content, setContent] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        fetch(`${API_BASE}/api/factory-content/${file}`)
            .then(r => r.json())
            .then(data => {
                if (data.content) setContent(data.content);
                else setContent(null);
            })
            .catch(() => setContent(null))
            .finally(() => setLoading(false));
    }, [file]);

    const slides = content ? parseSlides(content) : [];

    return (
        <div className="h-full w-full overflow-y-auto" style={{ backgroundColor: t.accentBg }}>
            <div className="max-w-5xl mx-auto py-8 px-6">
                <div className="mb-8">
                    <h1 className="text-sm font-semibold text-stone-800 flex items-center gap-2"><Icon name={headerIcon} size={16} style={{ color: t.accent }} /> {headerTitle || file}</h1>
                    {headerSub && <p className="text-sm text-stone-400 mt-1">{headerSub}</p>}
                </div>

                {loading && (
                    <div className="text-center py-20 text-stone-400">
                        <div className="text-2xl animate-pulse">⏳</div>
                        <p className="text-sm mt-2">Loading...</p>
                    </div>
                )}

                {!loading && content === null && (
                    <div className="text-center py-20 text-stone-400">
                        <div className="text-4xl mb-3"><Icon name="folder" size={40} /></div>
                        <p className="text-sm"><code className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: t.accentLight, color: t.accent }}>factory/{file}.md</code> not found</p>
                    </div>
                )}

                {!loading && slides.length > 0 && (
                    <div className="space-y-6">
                        {slides.map((slide, i) => (
                            <div key={i} className="bg-white border rounded-2xl shadow-sm overflow-hidden hover:shadow-md transition-shadow" style={{ borderColor: t.accentBorder + "80" }}>
                                {slide.title && (
                                    <div className="border-b px-8 py-4" style={{ borderColor: t.accentBorder + "60", backgroundColor: t.accentLight + "60" }}>
                                        <h2 className="text-base font-bold text-stone-800">{slide.title}</h2>
                                    </div>
                                )}
                                <div className="px-8 py-5 slide-content" dangerouslySetInnerHTML={{ __html: slide.html }} />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <style>{`
                .slide-content h1 { font-size: 1.6rem; font-weight: 700; color: #44403c; margin-bottom: 0.75rem; }
                .slide-content h2 { font-size: 1.35rem; font-weight: 600; color: #57534e; margin-bottom: 0.5rem; }
                .slide-content h3 { font-size: 1.15rem; font-weight: 600; color: #78716c; margin-bottom: 0.5rem; }
                .slide-content p { color: #57534e; line-height: 1.75; margin-bottom: 0.5rem; font-size: 1rem; }
                .slide-content ul { list-style: none; padding: 0; margin: 0.25rem 0; }
                .slide-content li { 
                    padding: 0.35rem 0 0.35rem 1.5rem; 
                    position: relative; 
                    color: #57534e; 
                    line-height: 1.6;
                    font-size: 1rem;
                }
                .slide-content li::before { 
                    content: ""; 
                    position: absolute; 
                    left: 0; top: 0.7rem; 
                    width: 6px; height: 6px; 
                    border-radius: 50%; 
                    background: ${t.accent}; 
                }
                .slide-content strong { color: #44403c; font-weight: 600; }
                .slide-content em { color: ${t.accentHover}; }
                .slide-content code { 
                    background: ${t.accentBg}; padding: 0.1rem 0.4rem; border-radius: 0.25rem; 
                    font-size: 0.9rem; font-family: 'SF Mono', 'Fira Code', monospace; color: ${t.accent};
                }
                .slide-content pre { 
                    background: #1e293b; color: #e2e8f0; border-radius: 0.5rem; padding: 1rem; 
                    overflow-x: auto; margin: 0.5rem 0; font-size: 0.9rem; line-height: 1.5;
                }
                .slide-content hr { border: none; border-top: 1px solid ${t.accentBorder}; margin: 1rem 0; }
                .slide-content blockquote {
                    border-left: 3px solid ${t.accent}; padding: 0.5rem 1rem; margin: 0.5rem 0;
                    background: ${t.accentBg}; border-radius: 0 0.375rem 0.375rem 0; color: #57534e; font-size: 1rem;
                }
                .slide-content table {
                    width: 100%; border-collapse: collapse; margin: 0.75rem 0;
                    font-size: 0.95rem;
                }
                .slide-content th {
                    text-align: left; padding: 0.5rem 0.75rem; font-weight: 600; color: #44403c;
                    border-bottom: 2px solid ${t.accent}; background: ${t.accentBg};
                }
                .slide-content td {
                    padding: 0.5rem 0.75rem; border-bottom: 1px solid ${t.accentBorder}40;
                    color: #57534e; vertical-align: top;
                }
                .slide-content tr:hover td { background: ${t.accentBg}80; }
            `}</style>
        </div>
    );
}

function parseSlides(md: string): Slide[] {
    const lines = md.split("\n");
    const slides: Slide[] = [];
    let currentTitle = "";
    let currentLines: string[] = [];
    let inCodeBlock = false;

    const flush = () => {
        const html = markdownToHtml(currentLines.join("\n"));
        if (html.trim()) slides.push({ title: currentTitle, html });
        currentLines = [];
    };

    for (const line of lines) {
        if (line.startsWith("```")) { inCodeBlock = !inCodeBlock; currentLines.push(line); continue; }
        if (!inCodeBlock && line.startsWith("## ") && !line.startsWith("### ")) {
            flush();
            currentTitle = line.slice(3).trim();
            continue;
        }
        currentLines.push(line);
    }
    flush();
    if (slides.length === 0) slides.push({ title: "", html: markdownToHtml(md) });
    return slides;
}

function parseTableRow(line: string): string[] {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) return [];
    return trimmed.split("|").slice(1, -1).map(c => c.trim());
}

function isSeparatorRow(line: string): boolean {
    return /^\|[\s\-:]+\|/.test(line.trim());
}

function markdownToHtml(md: string): string {
    const lines = md.split("\n");
    const html: string[] = [];
    let inCodeBlock = false;
    let inList = false;
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        if (line.startsWith("```")) {
            if (inCodeBlock) { html.push("</code></pre>"); inCodeBlock = false; }
            else { html.push('<pre><code>'); inCodeBlock = true; }
            i++; continue;
        }
        if (inCodeBlock) { html.push(escapeHtml(line)); i++; continue; }
        if (inList && !line.startsWith("- ") && !line.startsWith("  ")) { html.push("</ul>"); inList = false; }

        // Table detection
        const cells = parseTableRow(line);
        if (cells.length >= 2) {
            if (i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
                // Header row
                html.push('<table>');
                html.push('<thead><tr>' + cells.map(c => `<th>${inlineFormat(c)}</th>`).join("") + '</tr></thead>');
                html.push('<tbody>');
                i += 2; // skip header + separator
                while (i < lines.length) {
                    const rowCells = parseTableRow(lines[i]);
                    if (rowCells.length === 0) break;
                    html.push('<tr>' + rowCells.map(c => `<td>${inlineFormat(c)}</td>`).join("") + '</tr>');
                    i++;
                }
                html.push('</tbody></table>');
                continue;
            } else if (i > 0 && isSeparatorRow(lines[i - 1])) {
                // Body row after separator (already in a table)
                html.push('<tr>' + cells.map(c => `<td>${inlineFormat(c)}</td>`).join("") + '</tr>');
                i++; continue;
            }
        }

        if (line.startsWith("### ")) html.push(`<h3>${inlineFormat(line.slice(4))}</h3>`);
        else if (line.startsWith("# ")) html.push(`<h1>${inlineFormat(line.slice(2))}</h1>`);
        else if (line.startsWith("---")) html.push('<hr/>');
        else if (line.startsWith("- ")) {
            if (!inList) { html.push('<ul>'); inList = true; }
            html.push(`<li>${inlineFormat(line.slice(2))}</li>`);
        } else if (line.startsWith("> ")) {
            html.push(`<blockquote>${inlineFormat(line.slice(2))}</blockquote>`);
        } else if (line.trim() !== "") html.push(`<p>${inlineFormat(line)}</p>`);
        i++;
    }
    if (inList) html.push("</ul>");
    if (inCodeBlock) html.push("</code></pre>");
    return html.join("\n");
}

function inlineFormat(t: string): string {
    return t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/`(.+?)`/g, '<code>$1</code>');
}
function escapeHtml(t: string): string { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
