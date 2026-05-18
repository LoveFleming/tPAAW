import React from "react";
import { Card, RiskBadge } from "../components/ui/shared";
import { SKILLS } from "../data/mockData";
import { Skill } from "../types";

interface GatesProps {
    runSkill: (skill: Skill) => Promise<void>;
}

export default function Gates({ runSkill }: GatesProps) {
    return (
        <div className="h-full overflow-y-auto space-y-4 px-6">
            <Card title="Gates & Lints">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {SKILLS.filter((s) => ["ai.contract", "ai.unit", "ai.coverage", "ai.e2e", "ai.runbook"].includes(s.id)).map((s) => (
                        <div key={s.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-sm font-semibold">{s.title}</div>
                                    <div className="mt-1 text-xs text-zinc-600">{s.description}</div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        <RiskBadge risk={s.risk} />
                                        <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] text-zinc-700">deterministic</span>
                                    </div>
                                </div>
                                <button onClick={() => void runSkill(s)} className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs shadow-sm hover:bg-zinc-50">
                                    Run
                                </button>
                            </div>
                            <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                                Output artifacts: junit.xml · jacoco.xml/html · e2e traces · lint report
                            </div>
                        </div>
                    ))}
                </div>
            </Card>

            <Card title="Quality Gate Policy (Preview)">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
                    <div className="font-semibold">Default pipeline</div>
                    <div className="mt-2 font-mono">Q1 → Q2 → Q3 → Q4 → (manual approval) → PR</div>
                </div>
            </Card>
        </div>
    );
}
