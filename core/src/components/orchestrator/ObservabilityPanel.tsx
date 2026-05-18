import React from "react";
import { Orchestrator } from "../../types";
import { Card } from "../ui/shared";

export default function ObservabilityPanel({
    errorPolicy,
    errorCodes,
    observability
}: {
    errorPolicy: Orchestrator["errorPolicy"];
    errorCodes: Orchestrator["errorCodes"];
    observability: Orchestrator["observability"];
}) {
    if (!observability) return null;

    return (
        <Card title="Observability & Exceptions">
            <div className="space-y-6">
                
                {/* Error Policies */}
                <div>
                    <h4 className="text-sm font-semibold text-zinc-800 mb-2 border-b border-zinc-200 pb-1">Error Policies</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {errorPolicy.map(p => (
                            <div key={p.kind} className="p-3 bg-zinc-50 border border-zinc-200 rounded text-sm">
                                <span className={`font-mono text-xs font-bold mr-2 ${p.kind === 'SYS' ? 'text-red-600' : p.kind === 'EXT' ? 'text-orange-600' : 'text-blue-600'}`}>[{p.kind}]</span>
                                <span className="text-zinc-700">{p.policy}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Error Codes */}
                <div>
                    <h4 className="text-sm font-semibold text-zinc-800 mb-2 border-b border-zinc-200 pb-1">Defined Error Codes</h4>
                    <ul className="text-sm text-zinc-700 space-y-2">
                        {errorCodes.map(code => (
                            <li key={code.code} className="flex items-start gap-2">
                                <span className="font-mono text-[10px] bg-red-50 text-red-700 border border-red-200 px-1 py-0.5 rounded shrink-0">{code.code}</span>
                                <span>{code.description}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <h4 className="text-sm font-semibold text-zinc-800 mb-2 border-b border-zinc-200 pb-1">Metrics</h4>
                        <ul className="text-sm space-y-2">
                             {observability.metrics.map(m => (
                                 <li key={m.name} className="flex flex-col">
                                     <div className="flex items-center gap-2">
                                        <span className="font-mono text-xs text-blue-700 bg-blue-50 px-1 rounded">{m.name}</span>
                                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{m.type}</span>
                                     </div>
                                     <span className="text-xs text-zinc-600 mt-1">{m.description}</span>
                                 </li>
                             ))}
                        </ul>
                    </div>

                    {/* Logs & Events */}
                    <div className="space-y-4">
                        <div>
                            <h4 className="text-sm font-semibold text-zinc-800 mb-2 border-b border-zinc-200 pb-1">Required Log Fields</h4>
                            <div className="flex flex-wrap gap-2">
                                {observability.logFields.map(f => (
                                    <span key={f} className="text-xs font-mono bg-zinc-100 border border-zinc-200 text-zinc-700 px-1.5 py-0.5 rounded">{f}</span>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h4 className="text-sm font-semibold text-zinc-800 mb-2 border-b border-zinc-200 pb-1">Events Published</h4>
                            <ul className="text-sm space-y-2">
                                 {observability.events.map(e => (
                                     <li key={e.name} className="flex flex-col">
                                         <span className="font-mono text-xs text-green-700 bg-green-50 px-1 rounded inline-block w-fit">{e.name}</span>
                                         <span className="text-xs text-zinc-600 mt-1">{e.trigger}</span>
                                     </li>
                                 ))}
                            </ul>
                        </div>
                    </div>
                </div>

            </div>
        </Card>
    );
}
