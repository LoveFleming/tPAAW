import React from "react";
import ReactMarkdown from 'react-markdown';
import { Card } from "../ui/shared";

export default function MarkdownSection({ title, content }: { title: string, content: string }) {
    if (!content) return null;

    return (
        <Card title={title}>
            <div className="prose prose-sm max-w-none text-zinc-800 prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-headings:font-semibold prose-a:text-blue-600">
                <ReactMarkdown>
                    {content}
                </ReactMarkdown>
            </div>
        </Card>
    );
}
