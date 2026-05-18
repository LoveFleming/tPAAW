import React, { useMemo } from "react";
import { ORCHESTRATORS } from "../data/mockOrchestrators";
import OverviewCard from "../components/orchestrator/OverviewCard";
import MarkdownSection from "../components/orchestrator/MarkdownSection";
import ApiSpecSection from "../components/orchestrator/ApiSpecSection";
import FlowStepList from "../components/orchestrator/FlowStepList";
import DecisionRuleTable from "../components/orchestrator/DecisionRuleTable";
import ObservabilityPanel from "../components/orchestrator/ObservabilityPanel";
import NodeContractPanel from "../components/orchestrator/NodeContractPanel";
import TestTargetsPanel from "../components/orchestrator/TestTargetsPanel";

export default function OrchestratorWorkspace({ 
    domain, 
    orchId 
}: { 
    domain: string; 
    orchId: string; 
}) {
    const orch = useMemo(() => {
        return ORCHESTRATORS.find(o => o.domain === domain && o.id === orchId);
    }, [domain, orchId]);

    if (!orch) return <div className="p-8 text-center text-zinc-500">Orchestrator not found.</div>;

    const sections = [
        { id: "overview", label: "Overview", component: <OverviewCard orch={orch} /> },
        { id: "story", label: "User Story", component: <MarkdownSection title="User Story" content={orch.userStoryMarkdown} /> },
        { id: "api", label: "API", component: <ApiSpecSection spec={orch.apiSpec} /> },
        { id: "spec", label: "Spec", component: <MarkdownSection title="Orchestrator Spec" content={orch.orchestratorSpecMarkdown} /> },
        { id: "flow", label: "Flow", component: <FlowStepList steps={orch.flowSteps} /> },
        { id: "rules", label: "Rules", component: <DecisionRuleTable rules={orch.decisionRules} /> },
        { id: "obs", label: "Observability", component: <ObservabilityPanel errorPolicy={orch.errorPolicy} errorCodes={orch.errorCodes} observability={orch.observability} /> },
        { id: "nodes", label: "Nodes", component: <NodeContractPanel contracts={orch.nodeContracts} /> },
        { id: "runbook", label: "Runbook", component: <MarkdownSection title="Runbook" content={orch.runbookMarkdown} /> },
        { id: "tests", label: "Tests", component: <TestTargetsPanel targets={orch.testTargets} /> },
    ];

    const scrollTo = (id: string) => {
        document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    return (
        <div className="flex h-full gap-6 max-w-[1400px] mx-auto animate-in fade-in duration-300 px-6">
            {/* Main Content Scrollable Area */}
            <div className="flex-1 overflow-y-auto pr-6 custom-scrollbar pb-24 h-full relative" style={{ height: "calc(100vh - 120px)" }}>
                <div className="space-y-8">
                    {sections.map(sec => sec.component ? (
                        <div key={sec.id} id={`section-${sec.id}`} className="scroll-mt-6">
                            {sec.component}
                        </div>
                    ) : null)}
                </div>
            </div>

            {/* Sticky Navigation Panel */}
            <div className="w-48 shrink-0 hidden lg:block">
                <div className="sticky top-0 right-0 space-y-1 bg-zinc-100 rounded-xl p-3 border border-zinc-200" style={{ marginTop: '0' }}>
                    <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3 px-2 flex items-center gap-2 border-b border-zinc-200 pb-2">
                        <span>Navigation</span>
                    </div>
                    {sections.map(sec => sec.component && (
                        <button
                            key={sec.id}
                            onClick={() => scrollTo(sec.id)}
                            className="w-full text-left px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-blue-600 hover:bg-white rounded transition-colors"
                        >
                            {sec.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
