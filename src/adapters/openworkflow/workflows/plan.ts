/**
 * Plan workflow body (S10) — DAG PlanSpec nodes via Gamma engagement leaf.
 *
 * Each node calls the same `runEngagementLeaf` (injected factory/join/resolve).
 * No second monocoque door; no pack resolve invent inside this module.
 * Edges define dependencies: nodes without unresolved deps run in parallel waves.
 * Park/wake composes naturally — parked nodes block their wave's Promise.all
 * until woken; subsequent waves wait for all prior-wave nodes to resolve.
 */

import type { EngineKind } from "../../../domain/engine.ts";
import { asRunId } from "../../../domain/engagement.ts";
import type {
  PlanEdgeSpec,
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
  /**
   * Optional spawn executor. When provided each plan node runs in its own
   * child process instead of in-process (same as EngagementArcDeps.executeLeaf).
   */
  readonly executeLeaf?: (
    input: EngagementWorkflowInput,
    runId: string,
  ) => Promise<EngagementWorkflowOutput>;
  /**
   * Composition fallback engine threaded to each node leaf (S2e) so join
   * records / outputs carry the engine the registry factory resolves.
   */
  readonly defaultEngine?: EngineKind;
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
    engine: node.engine,
  };
}

/**
 * Compute execution waves from nodes + optional edge dependencies.
 * Wave 0: nodes with no incomplete dependencies.
 * Wave N: nodes whose dependencies are all satisfied by prior waves.
 * Circular deps or missing refs → remaining nodes in a final catch-all wave.
 */
export function computePlanWaves(
  nodes: readonly PlanNodeSpec[],
  edges?: readonly PlanEdgeSpec[],
): PlanNodeSpec[][] {
  // Build dependency map: nodeId → list of nodeIds it depends on
  const deps = new Map<string, string[]>();
  for (const n of nodes) deps.set(n.id, []);
  for (const e of edges ?? []) {
    const list = deps.get(e.to);
    if (list) list.push(e.from);
  }

  const remaining = new Set(nodes.map((n) => n.id));
  const completed = new Set<string>();
  const waves: PlanNodeSpec[][] = [];

  while (remaining.size > 0) {
    const wave = nodes.filter(
      (n) =>
        remaining.has(n.id) &&
        (deps.get(n.id) ?? []).every((dep) => completed.has(dep)),
    );

    if (wave.length === 0) {
      // Circular dependency or broken edge ref — dump remaining as final wave
      const stragglers = nodes.filter((n) => remaining.has(n.id));
      waves.push(stragglers);
      break;
    }

    for (const n of wave) {
      remaining.delete(n.id);
      completed.add(n.id);
    }
    waves.push(wave);
  }

  return waves;
}

/**
 * Summarize plan node results into plan output.
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
 * DAG plan body: compute waves from nodes + edges, execute each wave in parallel.
 * Callable without an OW worker; register-plan wraps with durable step.run per node.
 */
export async function runPlanWorkflow(
  plan: PlanSpec,
  deps: PlanLeafDeps,
): Promise<PlanWorkflowOutput> {
  const results: PlanNodeResult[] = [];
  const waves = computePlanWaves(plan.nodes, plan.edges);

  for (const wave of waves) {
    const waveResults = await Promise.all(
      wave.map(async (node) => {
        const input = planNodeToEngagementInput(plan, node);
        const nodeRunId =
          deps.runId !== undefined && deps.runId !== ""
            ? asRunId(`${deps.runId}:${node.id}`)
            : asRunId(`${plan.id}:${node.id}`);

        const outcome =
          deps.executeLeaf !== undefined
            ? await deps.executeLeaf(input, nodeRunId)
            : await runEngagementLeaf(input, {
                factory: deps.factory,
                join: deps.join,
                resolveDefinition: deps.resolveDefinition,
                runId: nodeRunId,
                defaultEngine: deps.defaultEngine,
              });


        return { nodeId: node.id, outcome } satisfies PlanNodeResult;
      }),
    );
    results.push(...waveResults);
  }

  return summarizePlanResults(plan.id, results);
}


