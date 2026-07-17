/**
 * Register the engagement workflow on an OpenWorkflow client (S5c / LIFE scaffold).
 *
 * Thin binding only:
 *   implementWorkflow → runEngagementArc → runEngagementLeaf (Pi monocoque)
 *
 * Park/wake continuum lives in workflows/engagement-arc.ts (LIFE-P1/P2).
 * This file must stay a registration shell — no leaf or signal policy here.
 *
 * ```ts
 * const ow = new OpenWorkflow({ backend });
 * registerEngagementWorkflow(ow, { factory, join, resolveDefinition });
 * const worker = ow.newWorker({ concurrency: 1 });
 * await worker.start();
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
import type { EngagementLeafDeps } from "./workflows/engagement.ts";
import {
  runEngagementArc,
  type EngagementArcStep,
} from "./workflows/engagement-arc.ts";

/**
 * Minimal OpenWorkflow client face used for registration + worker.
 * Structural — no vendor type import in this module’s public surface.
 */
export type EngagementOwClient = {
  implementWorkflow(
    spec: WorkflowSpecRef<EngagementWorkflowInput, EngagementWorkflowOutput>,
    fn: (params: {
      readonly input: EngagementWorkflowInput;
      readonly step: EngagementArcStep;
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
   * Durable step name for the first leaf inside the arc (default: engagement-leaf).
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
 * implementWorkflow → engagement arc. Call once per client before newWorker / dispatch.
 */
export function registerEngagementWorkflow(
  ow: EngagementOwClient,
  deps: RegisterEngagementWorkflowDeps,
): RegisterEngagementWorkflowResult {
  const engagementSpec =
    deps.engagementSpec ?? defaultEngagementWorkflowSpec();
  const leafStepName = deps.stepName ?? "engagement-leaf";

  ow.implementWorkflow(engagementSpec, async ({ input, step, run }) => {
    return runEngagementArc({
      input,
      step,
      runId: run.id,
      leafStepName,
      deps: {
        factory: deps.factory,
        join: deps.join,
        resolveDefinition: deps.resolveDefinition,
      },
    });
  });

  return { engagementSpec };
}
