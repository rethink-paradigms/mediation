/**
 * Register the Gamma engagement workflow on an OpenWorkflow client (S5c).
 *
 * Binds implementWorkflow(spec, fn) so a Worker can execute runs enqueued via
 * RuntimePort.dispatch / ow.runWorkflow. Leaf deps (factory, join, definition
 * resolve) are closed over at composition time — workflow body never invents
 * pack loading or opens Pi sessions directly.
 *
 * ```ts
 * const ow = new OpenWorkflow({ backend });
 * registerEngagementWorkflow(ow, { factory, join, resolveDefinition });
 * const worker = ow.newWorker({ concurrency: 1 });
 * await worker.start();
 * // runtime.dispatch(...) → worker runs leaf → completed
 * ```
 */

import type {
  EngagementWorkflowInput,
  EngagementWorkflowOutput,
} from "./types.ts";
import {
  defaultEngagementWorkflowSpec,
  type WorkflowSpecRef,
} from "./runtime.ts";
import {
  runEngagementLeaf,
  type EngagementLeafDeps,
} from "./workflows/engagement.ts";

/**
 * Minimal OpenWorkflow client face used for registration + worker.
 * Structural so tests can pass real OpenWorkflow without coupling to package
 * internals beyond implementWorkflow / newWorker.
 */
export type EngagementOwClient = {
  implementWorkflow(
    spec: WorkflowSpecRef<EngagementWorkflowInput, EngagementWorkflowOutput>,
    fn: (params: {
      readonly input: EngagementWorkflowInput;
      readonly step: {
        run: <Output>(
          config: { readonly name: string },
          stepFn: () => Promise<Output> | Output,
        ) => Promise<Output>;
      };
      readonly run: { readonly id: string };
    }) => Promise<EngagementWorkflowOutput> | EngagementWorkflowOutput,
  ): void;
  newWorker(options?: { concurrency?: number }): {
    start(): Promise<void>;
    stop(): Promise<void>;
    tick(): Promise<number>;
  };
};

/** Deps closed over by the registered workflow (inject mock or Pi factory). */
export type RegisterEngagementWorkflowDeps = {
  readonly factory: EngagementLeafDeps["factory"];
  readonly join: EngagementLeafDeps["join"];
  readonly resolveDefinition: EngagementLeafDeps["resolveDefinition"];
  /**
   * Override engagement workflow spec (must match RuntimePort engagementSpec name).
   * Default: defaultEngagementWorkflowSpec() → mediation-engagement.
   */
  readonly engagementSpec?: WorkflowSpecRef<
    EngagementWorkflowInput,
    EngagementWorkflowOutput
  >;
  /**
   * Durable step name inside the workflow (default: engagement-leaf).
   * Side-effecting materialize/engage runs once per successful attempt.
   */
  readonly stepName?: string;
};

export type RegisterEngagementWorkflowResult = {
  readonly engagementSpec: WorkflowSpecRef<
    EngagementWorkflowInput,
    EngagementWorkflowOutput
  >;
};

/**
 * implementWorkflow for the engagement leaf on `ow`.
 * Call once per client before newWorker / dispatch.
 */
export function registerEngagementWorkflow(
  ow: EngagementOwClient,
  deps: RegisterEngagementWorkflowDeps,
): RegisterEngagementWorkflowResult {
  const engagementSpec =
    deps.engagementSpec ?? defaultEngagementWorkflowSpec();
  const stepName = deps.stepName ?? "engagement-leaf";

  ow.implementWorkflow(engagementSpec, async ({ input, step, run }) => {
    return step.run({ name: stepName }, async () => {
      return runEngagementLeaf(input, {
        factory: deps.factory,
        join: deps.join,
        resolveDefinition: deps.resolveDefinition,
        // Correlate product join with OW workflow run id
        runId: run.id,
      });
    });
  });

  return { engagementSpec };
}
