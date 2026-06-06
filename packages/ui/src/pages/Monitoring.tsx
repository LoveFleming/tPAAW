import React from "react";
import { Card, RiskBadge } from "../components/ui/shared";
import { SKILLS } from "../data/mockData";
import { Skill } from "../types";

interface MonitoringProps {
    runSkill: (skill: Skill) => Promise<void>;
}

export default function Monitoring({ runSkill }: MonitoringProps) {
    return (
        <div className="h-full overflow-y-auto space-y-4 px-6">
            <Card title="Monitoring Report Generator">
                <div className="h-full overflow-y-auto space-y-3">
                    <div className="text-sm text-zinc-700">Generate reports from sandbox snapshots (not direct production write-access).</div>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        {["Daily On-call Digest", "Weekly Stability Report", "Top Error Codes + Runbook Coverage"].map((t) => (
                            <div key={t} className="rounded-2xl border border-zinc-200 bg-white p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-semibold">{t}</div>
                                        <div className="mt-1 text-xs text-zinc-600">Uses incident bundles + execution records.</div>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            <RiskBadge risk="guarded" />
                                            <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] text-zinc-700">AI-assisted</span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => void runSkill(SKILLS.find((s) => s.id === "ai.rca")!)}
                                        className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs shadow-sm hover:bg-zinc-50"
                                    >
                                        Generate
                                    </button>
                                </div>

                                <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                                    Output: markdown/pdf · charts · action items · runbook gaps
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </Card>
        </div>
    );
}
