import Icon from "../components/Icon";
import React, { useState, useMemo } from "react";
import { ORCHESTRATORS } from "../data/mockOrchestrators";
import { badgeClasses, cn } from "../utils";
import { Orchestrator } from "../types";

export default function OrchestratorOverview({ openApp }: { openApp: (id: string) => void }) {
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [domainFilter, setDomainFilter] = useState("all");

    const domains = useMemo(() => Array.from(new Set(ORCHESTRATORS.map(o => o.domain))), []);
    const statuses = ["active", "draft", "deprecated"];

    const filtered = useMemo(() => {
        return ORCHESTRATORS.filter(o => {
            if (statusFilter !== "all" && o.status !== statusFilter) return false;
            if (domainFilter !== "all" && o.domain !== domainFilter) return false;
            if (search.trim()) {
                const q = search.toLowerCase();
                return o.name.toLowerCase().includes(q) || o.id.toLowerCase().includes(q) || o.apiPath.toLowerCase().includes(q);
            }
            return true;
        });
    }, [search, statusFilter, domainFilter]);

    const grouped = useMemo(() => {
        const m = new Map<string, Orchestrator[]>();
        for (const o of filtered) {
            const list = m.get(o.domain) || [];
            list.push(o);
            m.set(o.domain, list);
        }
        return m;
    }, [filtered]);

    return (
        <div className="h-full overflow-y-auto space-y-6 animate-in fade-in duration-300 px-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Orchestrator Registry</h1>
                    <p className="text-sm text-zinc-500">Browse and manage domain orchestrators across the factory.</p>
                </div>

                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        placeholder="Search orchestrators..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 w-64"
                    />
                    <select
                        value={domainFilter}
                        onChange={e => setDomainFilter(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-zinc-300 rounded-md bg-white focus:outline-none"
                    >
                        <option value="all">All Domains</option>
                        {domains.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-zinc-300 rounded-md bg-white focus:outline-none capitalize"
                    >
                        <option value="all">All Status</option>
                        {statuses.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>
            </div>

            <div className="h-full overflow-y-auto space-y-8 px-6">
                {Array.from(grouped.entries()).map(([domain, items]) => (
                    <div key={domain} className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
                        <div className="bg-zinc-50 border-b border-zinc-200 px-4 py-3 flex items-center gap-2">
                            <span className="font-semibold text-zinc-800 uppercase tracking-wider text-sm">{domain} Domain</span>
                            <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{items.length}</span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-left text-sm whitespace-nowrap">
                                <thead className="bg-white text-zinc-500 border-b border-zinc-100 uppercase tracking-wider text-[10px]">
                                    <tr>
                                        <th className="px-4 py-3 font-semibold">Orchestrator ID</th>
                                        <th className="px-4 py-3 font-semibold">Name</th>
                                        <th className="px-4 py-3 font-semibold">API Path</th>
                                        <th className="px-4 py-3 font-semibold">Version</th>
                                        <th className="px-4 py-3 font-semibold">Status</th>
                                        <th className="px-4 py-3 font-semibold">Owner</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 text-zinc-700">
                                    {items.map(orch => (
                                        <tr 
                                            key={orch.id} 
                                            onClick={() => openApp(`orch.${orch.domain}.${orch.id}`)}
                                            className="hover:bg-blue-50/50 cursor-pointer transition-colors group"
                                        >
                                            <td className="px-4 py-3 font-mono text-xs text-blue-600 group-hover:underline">
                                                {orch.id}
                                            </td>
                                            <td className="px-4 py-3 font-medium text-zinc-900">{orch.name}</td>
                                            <td className="px-4 py-3 font-mono text-xs text-zinc-500">{orch.apiPath}</td>
                                            <td className="px-4 py-3">{orch.version}</td>
                                            <td className="px-4 py-3">
                                                <span className={cn(
                                                    "rounded-full border px-2 py-0.5 text-[10px]",
                                                    badgeClasses(orch.status === 'active' ? 'safe' : orch.status === 'draft' ? 'guarded' : 'external')
                                                )}>
                                                    {orch.status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-xs">{orch.owner}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))}
                
                {grouped.size === 0 && (
                    <div className="text-center py-24 bg-white rounded-xl border border-zinc-200">
                        <div className="text-zinc-400 mb-2"><Icon name="inbox" size={40} /></div>
                        <div className="text-zinc-500 font-medium">No orchestrators found matching your filters.</div>
                    </div>
                )}
            </div>
        </div>
    );
}
