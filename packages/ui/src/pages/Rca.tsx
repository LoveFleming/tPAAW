import React, { useState, useMemo } from "react";
import { Card } from "../components/ui/shared";
import { cn, fmtTime } from "../utils";
import { INCIDENTS, SKILLS } from "../data/mockData";
import { Skill } from "../types";

interface RcaProps {
    selectedIncidentId: string | null;
    setSelectedIncidentId: (id: string | null) => void;
    runSkill: (skill: Skill) => Promise<void>;
}

export default function Rca({ selectedIncidentId, setSelectedIncidentId, runSkill }: RcaProps) {
    const [incidentQuery, setIncidentQuery] = useState("");

    const incidentsFiltered = useMemo(() => {
        const q = incidentQuery.trim().toLowerCase();
        if (!q) return INCIDENTS;
        return INCIDENTS.filter((i) => [i.id, i.summary, i.source, i.severity].join(" ").toLowerCase().includes(q));
    }, [incidentQuery]);

    const selectedIncident = useMemo(
        () => (selectedIncidentId ? INCIDENTS.find((i) => i.id === selectedIncidentId) ?? null : null),
        [selectedIncidentId]
    );

    return (
        <div className="h-full overflow-y-auto space-y-4 px-6">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card
                    title="Incident Bundles"
                    right={
                        <input
                            value={incidentQuery}
                            onChange={(e) => setIncidentQuery(e.target.value)}
                            placeholder="Search incidents"
                            className="w-56 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                        />
                    }
                >
                    <div className="h-full overflow-y-auto space-y-2">
                        {incidentsFiltered.map((i) => (
                            <button
                                key={i.id}
                                onClick={() => setSelectedIncidentId(i.id)}
                                className={cn(
                                    "w-full rounded-xl border px-3 py-2 text-left",
                                    selectedIncidentId === i.id ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
                                )}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="truncate text-sm font-semibold">{i.id}</div>
                                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-700">{i.severity}</span>
                                </div>
                                <div className={cn("mt-1 text-xs", selectedIncidentId === i.id ? "text-zinc-200" : "text-zinc-600")}>{i.summary}</div>
                            </button>
                        ))}
                        {!incidentsFiltered.length ? <div className="text-sm text-zinc-500">No results.</div> : null}
                    </div>
                </Card>

                <div className="h-full overflow-y-auto space-y-4 lg:col-span-2">
                    <Card
                        title="Investigation Workspace"
                        right={
                            <button
                                onClick={() => void runSkill(SKILLS.find((s) => s.id === "ai.rca")!)}
                                className="rounded-2xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800"
                            >
                                Run AI RCA
                            </button>
                        }
                    >
                        {!selectedIncident ? (
                            <div className="text-sm text-zinc-500">Select an incident bundle to inspect.</div>
                        ) : (
                            <div className="h-full overflow-y-auto space-y-3">
                                <div className="rounded-xl border border-zinc-200 bg-white p-3">
                                    <div className="text-sm font-semibold">{selectedIncident.id}</div>
                                    <div className="mt-1 text-xs text-zinc-600">{selectedIncident.summary}</div>
                                    <div className="mt-2 text-xs text-zinc-500">
                                        source: <span className="font-mono">{selectedIncident.source}</span> · created {fmtTime(selectedIncident.createdAt)}
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
                                        <div className="font-semibold">Bundle contents (preview)</div>
                                        <ul className="mt-2 list-disc space-y-1 pl-4">
                                            <li>logs (masked)</li>
                                            <li>metrics (snapshot)</li>
                                            <li>traces (sampled)</li>
                                            <li>execution records</li>
                                            <li>runbook coverage report</li>
                                        </ul>
                                    </div>
                                    <div className="rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-600">
                                        <div className="font-semibold text-zinc-700">Safety posture</div>
                                        <div className="mt-2">AI can read bundle + propose patch. No production writes.</div>
                                        <div className="mt-2">PR creation is external and must go through Outbound Gate.</div>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-zinc-200 bg-white p-3">
                                    <div className="text-xs font-semibold text-zinc-700">Ask AI (preview)</div>
                                    <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
                                        “Analyze the incident bundle, identify the most likely root cause, and propose a runbook patch + verification steps.”
                                    </div>
                                </div>
                            </div>
                        )}
                    </Card>

                    <Card title="Suggested Outputs">
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                            {["RCA draft", "Runbook patch", "Verification plan"].map((t) => (
                                <div key={t} className="rounded-2xl border border-zinc-200 bg-white p-4">
                                    <div className="text-sm font-semibold">{t}</div>
                                    <div className="mt-2 text-xs text-zinc-600">Generated inside dev sandbox; reviewed before outbound.</div>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}
