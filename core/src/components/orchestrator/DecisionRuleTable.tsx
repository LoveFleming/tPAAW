import React from "react";
import { DecisionRule } from "../../types";
import { Card } from "../ui/shared";

export default function DecisionRuleTable({ rules }: { rules: DecisionRule[] }) {
    if (!rules || rules.length === 0) return null;

    return (
        <Card title="Decision Rules">
            <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-zinc-100 text-zinc-600 font-semibold uppercase tracking-wider text-xs border-b border-zinc-200">
                        <tr>
                            <th className="px-4 py-3">Rule ID</th>
                            <th className="px-4 py-3">Description</th>
                            <th className="px-4 py-3">When</th>
                            <th className="px-4 py-3">Then</th>
                            <th className="px-4 py-3">Error Code</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 text-zinc-700">
                        {rules.map((rule) => (
                            <tr key={rule.ruleId} className="hover:bg-zinc-50/50 transition-colors">
                                <td className="px-4 py-3 font-mono text-xs">{rule.ruleId}</td>
                                <td className="px-4 py-3 truncate max-w-[200px]">{rule.description}</td>
                                <td className="px-4 py-3 font-mono text-xs bg-zinc-50 rounded text-blue-700">{rule.when}</td>
                                <td className="px-4 py-3">{rule.then}</td>
                                <td className="px-4 py-3">
                                    {rule.errorCode ? (
                                        <span className="font-mono text-xs text-red-600 bg-red-50 px-1 py-0.5 rounded">{rule.errorCode}</span>
                                    ) : (
                                        <span className="text-zinc-400">-</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}
