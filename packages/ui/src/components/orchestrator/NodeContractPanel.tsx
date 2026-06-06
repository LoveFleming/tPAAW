import React, { useState } from "react";
import { NodeContract } from "../../types";
import { Card } from "../ui/shared";
import JsonSchemaViewer from "./JsonSchemaViewer";
import { ChevronDown, ChevronRight } from "lucide-react";

function NodeItem({ node }: { node: NodeContract }) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="border border-zinc-200 rounded-lg overflow-hidden mb-2">
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between p-3 bg-zinc-50 hover:bg-zinc-100 transition-colors text-sm text-left"
            >
                <div className="flex items-center gap-2">
                    {expanded ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
                    <span className="font-semibold text-slate-800">{node.nodeId}</span>
                    <span className="text-zinc-500 hidden md:inline ml-2 text-xs truncate max-w-[300px]">({node.description})</span>
                </div>
                <div className="text-zinc-400 text-xs">Contract I/O</div>
            </button>
            {expanded && (
                <div className="border-t border-zinc-200 p-4 bg-white grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <h5 className="font-semibold text-sm mb-2 text-zinc-700">Input Schema</h5>
                        <JsonSchemaViewer schema={node.inputSchema} />
                    </div>
                    <div>
                        <h5 className="font-semibold text-sm mb-2 text-zinc-700">Output Schema</h5>
                        <JsonSchemaViewer schema={node.outputSchema} />
                    </div>
                </div>
            )}
        </div>
    );
}

export default function NodeContractPanel({ contracts }: { contracts: NodeContract[] }) {
    if (!contracts || contracts.length === 0) return null;

    return (
        <Card title="Node Contracts">
            <div className="space-y-2">
                {contracts.map(c => (
                    <NodeItem key={c.nodeId} node={c} />
                ))}
            </div>
        </Card>
    );
}
