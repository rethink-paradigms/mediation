/**
 * Engagement arc — OW-step orchestration around the pure Gamma leaf.
 *
 * Separation of concerns:
 * - `runEngagementLeaf`  = one Pi life slice (materialize → join → engage → dispose)
 * - `runEngagementArc`   = durable run story (steps, park wait, wake continue)
 * - `registerEngagementWorkflow` = thin OW client binding only
 *
 * LIFE-P1: when leaf returns Parked, waitForSignal (Model P) instead of completing.
 * LIFE-P2: on wake, re-enter leaf with sessionRef + payload (continue).
 *
 * Today (scaffold): single leaf step — behavior identical to pre-arc registration
 * (Parked still completes the OW run until P1 lands).
 */

import type {
  EngagementWorkflowInput,
  EngagementWorkflowOutput,
} from "../types.ts";
import {
  runEngagementLeaf,
  type EngagementLeafDeps,
} from "./engagement.ts";

/**
 * Structural step face used by the arc.
 * Matches OpenWorkflow workflow `step` (run + waitForSignal).
 * Kept local so domain never imports openworkflow.
 */
export type EngagementArcStep = {
  run: <Output>(
    config: { readonly name: string },
    stepFn: () => Promise<Output> | Output,
  ) => Promise<Output>;
  /**
   * Present on real OW workers. Optional so pure unit tests can drive the arc
   * with a run-only stub until LIFE-P1 requires wait.
   */
  waitForSignal?: <Output>(options: {
    readonly name?: string;
    readonly signal: string;
    readonly timeout?: string | number;
  }) => Promise<{ readonly data?: Output } | null>;
};

export type EngagementArcDeps = {
  readonly factory: EngagementLeafDeps["factory"];
  readonly join: EngagementLeafDeps["join"];
  readonly resolveDefinition: EngagementLeafDeps["resolveDefinition"];
};

export type RunEngagementArcParams = {
  readonly input: EngagementWorkflowInput;
  readonly step: EngagementArcStep;
  /** OW workflow run id — join correlation + signal namespace. */
  readonly runId: string;
  readonly deps: EngagementArcDeps;
  /** Durable step name for the first leaf (default: engagement-leaf). */
  readonly leafStepName?: string;
};

/**
 * Run the engagement arc for one OW workflow invocation.
 *
 * Scaffold (pre-LIFE-P1): one memoized leaf step; returns Settled|Parked|Failed.
 * P1/P2 replace the body after the first leaf when kind === "parked".
 */
export async function runEngagementArc(
  params: RunEngagementArcParams,
): Promise<EngagementWorkflowOutput> {
  const leafStepName = params.leafStepName ?? "engagement-leaf";
  const leafDeps: EngagementLeafDeps = {
    factory: params.deps.factory,
    join: params.deps.join,
    resolveDefinition: params.deps.resolveDefinition,
    runId: params.runId,
  };

  // Single Gamma pass — only door to PresenceFactory / Pi.
  return params.step.run({ name: leafStepName }, async () => {
    return runEngagementLeaf(params.input, leafDeps);
  });
}
