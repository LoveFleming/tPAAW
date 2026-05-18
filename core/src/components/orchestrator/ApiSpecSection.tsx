import React from "react";
import { Orchestrator } from "../../types";
import { Card, CodeBlock } from "../ui/shared";

export default function ApiSpecSection({ spec }: { spec: Orchestrator["apiSpec"] }) {
    if (!spec) return null;

    return (
        <Card title="API Spec">
            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <span className="text-zinc-500 text-xs font-semibold block mb-1 uppercase tracking-widest">Endpoint</span>
                        <span className="font-mono text-sm bg-zinc-100 rounded px-2 py-1">{spec.endpoint}</span>
                    </div>
                    <div>
                        <span className="text-zinc-500 text-xs font-semibold block mb-1 uppercase tracking-widest">Purpose</span>
                        <span className="text-sm text-zinc-800">{spec.purpose}</span>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                        <span className="text-sm font-semibold text-zinc-800 block mb-2">Request Example Payload</span>
                        <CodeBlock text={JSON.stringify(spec.requestExample, null, 2)} />
                    </div>
                    <div>
                        <span className="text-sm font-semibold text-zinc-800 block mb-2">Response Example Payload</span>
                        <CodeBlock text={JSON.stringify(spec.responseExample, null, 2)} />
                    </div>
                </div>
            </div>
        </Card>
    );
}
