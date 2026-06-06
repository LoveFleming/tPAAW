import React, { useMemo } from "react";
import { Card, RiskBadge } from "../components/ui/shared";
import { cn, fmtTime, statusClasses } from "../utils";
import { APPS, SKILLS, FLOWS, RUNBOOKS, INCIDENTS } from "../data/mockData";
import { Run, Risk } from "../types";

interface OperationsCenterProps {
    runs: Run[];
    setActiveAppId: (id: string) => void;
    setSelectedRunId: (id: string | null) => void;
    setSelectedIncidentId: (id: string | null) => void;
    runSkill: (skill: any) => Promise<void>;
    todayIncidentCounts: { P1: number; P2: number; P3: number };
    runCounts: Record<string, number>;
    currentRuns: Run[];
    todayIncidents: any[];
    suggestions: any[];
}

export default function OperationsCenter({
    runs,
    setActiveAppId,
    setSelectedRunId,
    setSelectedIncidentId,
    runSkill,
    todayIncidentCounts,
    runCounts,
    currentRuns,
    todayIncidents,
    suggestions,
}: OperationsCenterProps) {
    return (
        <div className="h-full overflow-y-auto space-y-4 px-6">
            <div className="bg-white p-5 border-b border-orange-200">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <div className="text-2xl font-bold text-zinc-900">功能列</div>
                    </div>
                </div>
            </div>

            {/* Status Summary */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                <div className="bg-white p-4 shadow-sm border border-orange-200 lg:col-span-2">
                    <div className="text-xs text-stone-400 font-bold uppercase tracking-wider">Factory Health</div>
                    <div className="mt-1 text-lg font-semibold">Healthy</div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-xl border border-orange-200 bg-amber-50/50 p-3">
                            <div className="text-xs text-stone-400">Employees</div>
                            <div className="mt-1 text-sm font-semibold">{SKILLS.length}</div>
                        </div>
                        <div className="rounded-xl border border-orange-200 bg-amber-50/50 p-3">
                            <div className="text-xs text-stone-400">Assets</div>
                            <div className="mt-1 text-sm font-semibold">{FLOWS.length + RUNBOOKS.length}</div>
                        </div>
                    </div>
                </div>

                <div className="bg-white p-4 shadow-sm border border-orange-200">
                    <div className="text-xs text-stone-400 font-bold uppercase tracking-wider">Runs (today)</div>
                    <div className="mt-1 text-lg font-semibold text-stone-900">{runs.length}</div>
                    <div className="mt-3 space-y-1 text-xs text-stone-500">
                        <div className="flex justify-between"><span>queued</span><span className="font-mono">{runCounts.queued}</span></div>
                        <div className="flex justify-between"><span>running</span><span className="font-mono">{runCounts.running}</span></div>
                        <div className="flex justify-between"><span>success</span><span className="font-mono">{runCounts.success}</span></div>
                        <div className="flex justify-between"><span>failed</span><span className="font-mono">{runCounts.failed}</span></div>
                    </div>
                </div>

                <div className="bg-white p-4 shadow-sm border border-orange-200">
                    <div className="text-xs text-red-500 font-bold uppercase tracking-wider">Incidents (today)</div>
                    <div className="mt-1 text-lg font-semibold text-stone-900">{INCIDENTS.length}</div>
                    <div className="mt-3 space-y-1 text-xs text-stone-500">
                        <div className="flex justify-between"><span>P1</span><span className="font-mono">{todayIncidentCounts.P1}</span></div>
                        <div className="flex justify-between"><span>P2</span><span className="font-mono">{todayIncidentCounts.P2}</span></div>
                        <div className="flex justify-between"><span>P3</span><span className="font-mono">{todayIncidentCounts.P3}</span></div>
                    </div>
                </div>

                <div className="bg-white p-4 shadow-sm border border-orange-200">
                    <div className="text-xs text-stone-400 font-bold uppercase tracking-wider">Runbook Coverage</div>
                    <div className="mt-1 text-lg font-semibold text-stone-900">92%</div>
                    <div className="mt-3 text-xs text-stone-500">
                        Q4 will fail if any errorCode has no runbook mapping.
                    </div>
                    <button
                        onClick={() => setActiveAppId("assets.runbooks")}
                        className="mt-3 w-full border border-orange-200 bg-white px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-amber-50/50 uppercase tracking-wide"
                    >
                        Open Runbooks
                    </button>
                </div>
            </div>

            {/* Three columns */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card
                    title="Current Runs"
                    right={
                        <button
                            onClick={() => setActiveAppId("exec.skills")}
                            className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-xs shadow-sm hover:bg-amber-50/50"
                        >
                            Open Skill Center
                        </button>
                    }
                >
                    {currentRuns.length === 0 ? (
                        <div className="text-sm text-stone-400">No running/queued jobs. Trigger a skill to start work.</div>
                    ) : (
                        <div className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-orange-200">
                            {currentRuns.map((r) => (
                                <button
                                    key={r.id}
                                    onClick={() => {
                                        setSelectedRunId(r.id);
                                        setActiveAppId("exec.skills");
                                    }}
                                    className="flex w-full items-center justify-between gap-3 bg-white p-3 text-left hover:bg-amber-50/50"
                                >
                                    <div>
                                        <div className="text-sm font-semibold">{r.title}</div>
                                        <div className="mt-1 text-xs text-stone-400">
                                            {fmtTime(r.createdAt)} · engine={r.engine} · risk={r.risk}
                                        </div>
                                    </div>
                                    <span className={cn("rounded-full px-3 py-1 text-xs", statusClasses(r.status as any))}>{r.status}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </Card>

                <Card title="Today Incidents" right={<span className="text-xs text-stone-400">bundles</span>}>
                    <div className="h-full overflow-y-auto space-y-2">
                        {todayIncidents.map((i) => (
                            <button
                                key={i.id}
                                onClick={() => {
                                    setSelectedIncidentId(i.id);
                                    setActiveAppId("inv.rca");
                                }}
                                className="w-full rounded-xl border border-orange-200 bg-white p-3 text-left hover:bg-amber-50/50"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-semibold">{i.id}</div>
                                        <div className="mt-1 text-xs text-stone-500">{i.summary}</div>
                                        <div className="mt-2 text-xs text-stone-400">
                                            {fmtTime(i.createdAt)} · source=<span className="font-mono">{i.source}</span>
                                        </div>
                                    </div>
                                    <span className="rounded-full border border-orange-200 bg-amber-50/50 px-2 py-0.5 text-[11px] text-zinc-700">
                                        {i.severity}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>
                </Card>

                <Card title="Suggested Next Steps">
                    <div className="h-full overflow-y-auto space-y-3">
                        {suggestions.map((s) => (
                            <div key={s.id} className="rounded-2xl border border-orange-200 bg-white p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-semibold">{s.title}</div>
                                        <div className="mt-1 text-xs text-stone-500">{s.desc}</div>
                                        <div className="mt-2">
                                            <RiskBadge risk={s.risk} />
                                        </div>
                                    </div>
                                    <button
                                        onClick={s.cta.action}
                                        className={cn(
                                            "h-fit rounded-xl border px-3 py-2 text-xs shadow-sm hover:bg-amber-50/50",
                                            s.risk === "external" ? "border-red-200 bg-red-50 text-red-700" : "border-orange-200 bg-white text-zinc-900"
                                        )}
                                    >
                                        {s.cta.label}
                                    </button>
                                </div>
                            </div>
                        ))}

                        <div className="rounded-xl border border-orange-200 bg-amber-50/50 p-3 text-xs text-stone-500">
                            <div className="font-semibold text-zinc-700">Safety-first rules (preview)</div>
                            <ul className="mt-2 list-disc space-y-1 pl-4">
                                <li>AI write actions are patch-only by default</li>
                                <li>External actions require manual Outbound Gate approval</li>
                                <li>All runs produce audit trails + artifacts</li>
                            </ul>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Shortcuts */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
                {[
                    { id: "assets.orchestrator", title: "Browse Orchestrators", desc: "Flow spec + nodes/gates viewer" },
                    { id: "exec.gates", title: "Run Gates & Lints", desc: "Q1–Q4 deterministic pipeline" },
                    { id: "mon.report", title: "Generate Monitoring Report", desc: "AI-assisted report from snapshots" },
                    { id: "assets.orchestrator", title: "Browse Orchestrators", desc: "Flow spec + nodes/gates viewer" },
                    { id: "exec.gates", title: "Run Gates & Lints", desc: "Q1–Q4 deterministic pipeline" },
                    { id: "mon.report", title: "Generate Monitoring Report", desc: "AI-assisted report from snapshots" },
                ].map((x, i) => (
                    <button
                        key={i} // Using index because these are duplicated in original code
                        onClick={() => setActiveAppId(x.id)}
                        className="border border-orange-200 bg-white p-4 text-left shadow-sm hover:bg-amber-50/50 transition-colors"
                    >
                        <div className="text-sm font-semibold">{x.title}</div>
                        <div className="mt-1 text-xs text-stone-500">{x.desc}</div>
                    </button>
                ))}
            </div>
        </div>
    );
}
