import Icon from "../../components/Icon";
import React from "react";
import { TestTargets } from "../../types";
import { Card } from "../ui/shared";

export default function TestTargetsPanel({ targets }: { targets: TestTargets }) {
    if (!targets) return null;

    return (
        <Card title="Test Targets">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TargetSection title="Happy Path" items={targets.happyPath} color="text-green-700" bg="bg-green-50" border="border-green-200" icon="check" />
                <TargetSection title="Reject Cases" items={targets.rejectCases} color="text-yellow-700" bg="bg-yellow-50" border="border-yellow-200" icon="warning" />
                <TargetSection title="Error Cases" items={targets.errorCases} color="text-red-700" bg="bg-red-50" border="border-red-200" icon="cross" />
                <TargetSection title="Contract Validation" items={targets.contractValidation} color="text-blue-700" bg="bg-blue-50" border="border-blue-200" icon="shield" />
            </div>
        </Card>
    );
}

function TargetSection({ title, items, color, bg, border, icon }: { title: string, items: string[], color: string, bg: string, border: string, icon: string }) {
    if (!items || items.length === 0) return null;
    
    return (
        <div className={`p-3 rounded-lg border ${border} ${bg}`}>
            <h5 className={`font-semibold text-sm mb-2 ${color} flex items-center gap-2`}>
                <span className="flex items-center gap-1"><Icon name={icon as any} size={14} /> {title}</span>
            </h5>
            <ul className="space-y-1">
                {items.map((item, i) => (
                    <li key={i} className="text-xs text-zinc-800 bg-white/60 px-2 py-1 rounded shadow-sm">
                        {item}
                    </li>
                ))}
            </ul>
        </div>
    );
}
