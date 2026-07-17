/**
 * Plan workflow body (S10) — sequential PlanSpec nodes via Gamma engagement leaf.
 *
 * Each node calls the same `runEngagementLeaf` (injected factory/join/resolve).
 * No second monocoque door; no pack resolve invent inside this module.
 * Edges are ignored in v1 (nodes run in PlanSpec.nodes array order).
 */

import { asRunId } from "../../../domain/engagement.ts";
import type {
  PlanNodeSpec,
  PlanSpec,
} from "../../../ports/runtime.ts";
import type {
  EngagementWorkflowInput,
  EngagementWorkflowOutput,
} from "../types.ts";
import {
  runEngagementLeaf,
  type EngagementLeafDeps,
} from "./engagement.ts";

/** Per-node outcome collected by the plan workflow. */
export type PlanNodeResult = {
  readonly nodeId: string;
  readonly outcome: EngagementWorkflowOutput;
};

/**
 * Plan workflow output — serializable.
 * `kind: "completed"` when every node settled; otherwise `"failed"`
 * (includes pack fail-closed and any failed/parked node).
 */
export type PlanWorkflowOutput = {
  readonly kind: "completed" | "failed";
  readonly planId: string;
  readonly nodes: readonly PlanNodeResult[];
};

/** Deps closed over by plan body / register (same inject surface as engagement). */
export type PlanLeafDeps = {
  readonly factory: EngagementLeafDeps["factory"];
  readonly join: EngagementLeafDeps["join"];
  readonly resolveDefinition: EngagementLeafDeps["resolveDefinition"];
  /**
   * Durable plan workflow run id (OW run id when available).
   * Each node join key becomes `${runId}:${nodeId}` when set.
   */
  readonly runId?: string;
};

/**
 * Map a PlanNodeSpec into serializable engagement leaf input.
 */
export function planNodeToEngagementInput(
  plan: PlanSpec,
  node: PlanNodeSpec,
): EngagementWorkflowInput {
  return {
    agentName: node.agent.name,
    agentRoot: node.agent.rootDir,
    task: node.task,
    sessionRef: node.resume,
    requestId: `${plan.id}:${node.id}`,
  };
}

/**
 * Summarize sequential node results into plan output.
 * Empty node list → completed (vacuous all-settled).
 */
export function summarizePlanResults(
  planId: string,
  nodes: readonly PlanNodeResult[],
): PlanWorkflowOutput {
  const allSettled = nodes.every((n) => n.outcome.kind === "settled");
  return {
    kind: allSettled ? "completed" : "failed",
    planId,
    nodes,
  };
}

/**
 * Pure sequential plan body: for each PlanSpec node, run Gamma engagement leaf.
 * Callable without an OW worker; register-plan wraps with durable step.run per node.
 */
export async function runPlanWorkflow(
  plan: PlanSpec,
  deps: PlanLeafDeps,
): Promise<PlanWorkflowOutput> {
  const results: PlanNodeResult[] = [];

  for (const node of plan.nodes) {
    const input = planNodeToEngagementInput(plan, node);
    const nodeRunId =
      deps.runId !== undefined && deps.runId !== ""
        ? asRunId(`${deps.runId}:${node.id}`)
        : asRunId(`${plan.id}:${node.id}`);

    const outcome = await runEngagementLeaf(input, {
      factory: deps.factory,
      join: deps.join,
      resolveDefinition: deps.resolveDefinition,
      runId: nodeRunId,
    });

    results.push({ nodeId: node.id, outcome });
  }

  return summarizePlanResults(plan.id, results);
}
