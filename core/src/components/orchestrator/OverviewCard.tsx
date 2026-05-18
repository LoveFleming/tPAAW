import React from "react";
import { Orchestrator } from "../../types";
import { Card, RiskBadge, CodeBlock } from "../ui/shared";
import { badgeClasses } from "../../utils";

export default function OverviewCard({ orch }: { orch: Orchestrator }) {
    return (
        <Card title="Overview">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                    <span className="text-zinc-500 block mb-1">ID</span>
                    <span className="font-mono bg-zinc-100 rounded px-1">{orch.id}</span>
                </div>
                <div>
                    <span className="text-zinc-500 block mb-1">Name</span>
                    <span className="font-semibold text-zinc-800">{orch.name}</span>
                </div>
                <div>
                    <span className="text-zinc-500 block mb-1">Domain</span>
                    <span>{orch.domain}</span>
                </div>
                <div>
                    <span className="text-zinc-500 block mb-1">Status</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${badgeClasses(orch.status === 'active' ? 'safe' : orch.status === 'draft' ? 'guarded' : 'external')}`}>
                        {orch.status}
                    </span>
                </div>
                <div>
                    <span className="text-zinc-500 block mb-1">API ID</span>
                    <span className="font-mono text-xs">{orch.apiId}</span>
                </div>
                <div>
                    <span className="text-zinc-500 block mb-1">API Path</span>
                    <span className="font-mono text-xs bg-zinc-100 px-1 rounded">{orch.apiPath}</span>
                </div>
                <div>
                    <span className="text-zinc-500 block mb-1">Version</span>
                    <span>{orch.version}</span>
                </div>
                 <div>
                    <span className="text-zinc-500 block mb-1">Owner</span>
                    <span>{orch.owner}</span>
                </div>
            </div>
            <div className="mt-4 text-sm text-zinc-600 border-t border-zinc-100 pt-3">
                <span className="block font-semibold mb-1 text-zinc-800">Summary</span>
                {orch.summary}
            </div>
        </Card>
    );
}
