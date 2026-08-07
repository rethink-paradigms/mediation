/**
 * Register the plan workflow on an OpenWorkflow client (S10).
 *
 * implementWorkflow(planSpec, fn) where fn steps each PlanNode via the same
 * Gamma `runEngagementLeaf` inject (factory/join/resolveDefinition).
 * Parallel to registerEngagementWorkflow — plan nodes reuse the leaf, no
 * second monocoque door outside adapters/pi.
 *
 * DAG v2: edges define dependencies; waves execute in parallel. Parked nodes
 * block their wave's Promise.all until woken; subsequent waves wait.
 *
 * ```ts
 * const ow = new OpenWorkflow({ backend });
 * registerPlanWorkflow(ow, { factory, join, resolveDefinition });
 * const runtime = new OpenWorkflowRuntime({
 *   ow, backend, planSpec: defaultPlanWorkflowSpec(),
 * });
 * const worker = ow.newWorker({ concurrency: 1 });
 * await worker.start();
 * // runtime.runPlan(plan) → worker → completed with node results
 * ```
 */

import type { EngineKind } from "../../domain/engine.ts";
import type { PlanSpec } from "../../ports/runtime.ts";
import {
  defaultPlanWorkflowSpec,
  type WorkflowSpecRef,
} from "./runtime.ts";
import {
  computePlanWaves,
  planNodeToEngagementInput,
  summarizePlanResults,
  type PlanNodeResult,
  type PlanWorkflowOutput,
} from "./workflows/plan.ts";
import {
  runEngagementLeaf,
  type EngagementLeafDeps,
} from "./workflows/engagement.ts";
import { asRunId } from "../../domain/engagement.ts";

/**
 * Minimal OpenWorkflow client face used for plan registration + worker.
 * Structural so tests can pass real OpenWorkflow without coupling to package
 * internals beyond implementWorkflow / newWorker.
 */
export type PlanOwClient = {
  implementWorkflow(
    spec: WorkflowSpecRef<PlanSpec, PlanWorkflowOutput>,
    fn: (params: {
      readonly input: PlanSpec;
      readonly step: {
        run: <Output>(
          config: { readonly name: string },
          stepFn: () => Promise<Output> | Output,
        ) => Promise<Output>;
      };
      readonly run: { readonly id: string };
    }) => Promise<PlanWorkflowOutput> | PlanWorkflowOutput,
  ): void;
  newWorker(options?: { concurrency?: number }): {
    start(): Promise<void>;
    stop(): Promise<void>;
    tick(): Promise<number>;
  };
};

/** Deps closed over by the registered plan workflow (inject mock or Pi factory). */
export type RegisterPlanWorkflowDeps = {
  readonly factory: EngagementLeafDeps["factory"];
  readonly join: EngagementLeafDeps["join"];
  readonly resolveDefinition: EngagementLeafDeps["resolveDefinition"];
  /**
   * Override plan workflow spec (must match RuntimePort planSpec name).
   * Default: defaultPlanWorkflowSpec() → mediation-plan.
   */
  readonly planSpec?: WorkflowSpecRef<PlanSpec, PlanWorkflowOutput>;
  /**
   * Prefix for durable step names (default: plan-node).
   * Each node runs as `${stepNamePrefix}-${node.id}`.
   */
  readonly stepNamePrefix?: string;
  /**
   * Optional spawn executor threaded to PlanLeafDeps.executeLeaf.
   * When set, each plan node runs in a child process instead of in-process.
   */
  readonly executeLeaf?: (
    input: import("./types.ts").EngagementWorkflowInput,
    runId: string,
  ) => Promise<import("./types.ts").EngagementWorkflowOutput>;
  /**
   * Composition fallback engine threaded to each node leaf (S2e) so join
   * records / outputs carry the engine the registry factory resolves.
   */
  readonly defaultEngine?: EngineKind;
};


export type RegisterPlanWorkflowResult = {
  readonly planSpec: WorkflowSpecRef<PlanSpec, PlanWorkflowOutput>;
};

/**
 * implementWorkflow for the plan leaf on `ow`.
 * Call once per client before newWorker / runPlan.
 * DAG v2: waves from computePlanWaves; parallel step.run within each wave.
 */
export function registerPlanWorkflow(
  ow: PlanOwClient,
  deps: RegisterPlanWorkflowDeps,
): RegisterPlanWorkflowResult {
  const planSpec =
    deps.planSpec ??
    (defaultPlanWorkflowSpec() as WorkflowSpecRef<PlanSpec, PlanWorkflowOutput>);
  const stepNamePrefix = deps.stepNamePrefix ?? "plan-node";

  ow.implementWorkflow(planSpec, async ({ input: plan, step, run }) => {
    const results: PlanNodeResult[] = [];
    const waves = computePlanWaves(plan.nodes, plan.edges);

    for (const wave of waves) {
      const waveResults = await Promise.all(
        wave.map((node) =>
          step
            .run({ name: `${stepNamePrefix}-${node.id}` }, async () => {
              const nodeInput = planNodeToEngagementInput(plan, node);
              const nodeRunId = asRunId(`${run.id}:${node.id}`);
              if (deps.executeLeaf !== undefined) {
                return deps.executeLeaf(nodeInput, nodeRunId);
              }
              return runEngagementLeaf(nodeInput, {
                factory: deps.factory,
                join: deps.join,
                resolveDefinition: deps.resolveDefinition,
                runId: nodeRunId,
                defaultEngine: deps.defaultEngine,
              });
            })
            .then((outcome) => ({ nodeId: node.id, outcome })),
        ),
      );
      results.push(...waveResults);
    }

    return summarizePlanResults(plan.id, results);
  });


  return { planSpec };
}


