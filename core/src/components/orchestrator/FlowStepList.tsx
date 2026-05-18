import React from "react";
import { FlowStep } from "../../types";
import { Card } from "../ui/shared";
import { MoveDown } from "lucide-react";

export default function FlowStepList({ steps }: { steps: FlowStep[] }) {
    if (!steps || steps.length === 0) return null;

    return (
        <Card title="Flow Steps">
            <div className="space-y-2 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-300 before:to-transparent">
                {steps.map((step, idx) => (
                    <div key={step.stepId} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                        <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-slate-100 group-[.is-active]:bg-blue-500 text-slate-500 group-[.is-active]:text-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                            <span className="text-sm font-semibold">{idx + 1}</span>
                        </div>
                        <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-4 rounded-xl border border-zinc-200 shadow-sm transition-all hover:shadow-md">
                            <div className="flex items-center justify-between space-x-2 mb-1">
                                <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                                    {step.nodeId}
                                </div>
                                <time className="font-mono text-xs font-medium text-slate-500">{step.stepId}</time>
                            </div>
                            <div className="text-sm text-slate-600 mb-3">{step.purpose}</div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="bg-zinc-50 p-2 rounded">
                                    <span className="block text-zinc-400 font-semibold mb-1 uppercase text-[10px] tracking-wider">Input</span>
                                    <span className="font-mono text-zinc-700">{step.input}</span>
                                </div>
                                <div className="bg-zinc-50 p-2 rounded">
                                    <span className="block text-zinc-400 font-semibold mb-1 uppercase text-[10px] tracking-wider">Output</span>
                                    <span className="font-mono text-zinc-700">{step.output}</span>
                                </div>
                            </div>
                             {step.onError && (
                                <div className="mt-2 text-xs flex items-center gap-1">
                                    <span className="text-red-500 font-semibold">OnError:</span>
                                    <span className="font-mono bg-red-50 text-red-600 px-1 rounded">{step.onError}</span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </Card>
    );
}
