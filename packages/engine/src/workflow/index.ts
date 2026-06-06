/**
 * Workflow Engine — Simple pipe execution (A → B → C)
 * 
 * MVP: linear pipeline only. Each node's output feeds into the next node's input.
 */
import type { RunContext, RunResult, WorkflowNodeState } from "@tagent/shared";
import { resolveTemplateObj, generateId, nowISO, measureMs } from "@tagent/shared";
import type { RunsRepo } from "@tagent/db";
import { executeSkill } from "../runner/index";

export interface WorkflowNodeDef {
  id: string;
  skillId: string;
  input: Record<string, any>;  // Can contain {{prev.output.xxx}} template vars
}

export interface WorkflowResult {
  runId: string;
  workflowId: string;
  status: "completed" | "failed" | "cancelled";
  nodes: WorkflowNodeState[];
  startedAt: string;
  completedAt?: string;
  error?: string;
}

/**
 * Execute a workflow (linear pipe)
 */
export async function executeWorkflow(params: {
  workflowId: string;
  nodes: WorkflowNodeDef[];
  onError: "stop" | "skip" | "retry";
  context: RunContext;
  runsRepo: RunsRepo;
  getSkillExecution: (skillId: string) => Promise<{ runner: any; mode: any; timeout: number; config: any } | null>;
  dataStoreRepo?: any;
}): Promise<WorkflowResult> {
  const { workflowId, nodes, onError, context, runsRepo, getSkillExecution, dataStoreRepo } = params;
  
  const workflowRunId = generateId("wfr");
  const nodeStates: WorkflowNodeState[] = nodes.map(n => ({
    id: n.id,
    skillId: n.skillId,
    status: "pending",
    input: n.input,
  }));

  const startedAt = nowISO();
  let workflowStatus: "completed" | "failed" | "cancelled" = "completed";
  let workflowError: string | undefined;

  // Accumulated outputs: { nodeId: output }
  const outputs: Record<string, Record<string, any>> = {};

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const nodeState = nodeStates[i];
    nodeState.status = "running";

    try {
      // Resolve template vars in input
      // Available vars: {{nodeId.output.field}}
      const resolvedInput = resolveTemplateObj(node.input, outputs);

      // Get skill execution config
      const skillExec = await getSkillExecution(node.skillId);
      if (!skillExec) {
        throw new Error(`Skill not found: ${node.skillId}`);
      }

      // Execute skill
      const result = await executeSkill({
        skillId: node.skillId,
        input: resolvedInput,
        execution: skillExec,
        context: {
          ...context,
          runId: workflowRunId,
          source: { ...context.source, workflowId, nodeId: node.id },
        },
        runsRepo,
        dataStoreRepo,
      });

      nodeState.status = result.status === "completed" ? "completed" : "failed";
      nodeState.output = result.output;
      nodeState.durationMs = result.durationMs;

      if (result.status === "completed") {
        outputs[node.id] = result.output || {};
      } else {
        throw new Error(result.error || "Skill execution failed");
      }
    } catch (err: any) {
      nodeState.status = "failed";
      nodeState.error = err.message;

      if (onError === "stop") {
        workflowStatus = "failed";
        workflowError = `Node "${node.id}" failed: ${err.message}`;
        // Mark remaining nodes as pending
        for (let j = i + 1; j < nodeStates.length; j++) {
          nodeStates[j].status = "pending";
        }
        break;
      } else if (onError === "skip") {
        // Continue to next node
        continue;
      } else if (onError === "retry") {
        // For MVP, just retry once
        // TODO: implement retry logic
        workflowStatus = "failed";
        workflowError = `Node "${node.id}" failed after retry: ${err.message}`;
        break;
      }
    }
  }

  return {
    runId: workflowRunId,
    workflowId,
    status: workflowStatus,
    nodes: nodeStates,
    startedAt,
    completedAt: nowISO(),
    error: workflowError,
  };
}
