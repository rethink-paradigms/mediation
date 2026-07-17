/**
 * Engagement arc — OW-step orchestration around the pure Gamma leaf.
 *
 * Separation of concerns:
 * - `runEngagementLeaf`  = one Pi life slice (materialize → join → engage → dispose)
 * - `runEngagementArc`   = durable run story (steps, park wait, wake continue)
 * - `registerEngagementWorkflow` = thin OW client binding only
 *
 * LIFE-P1 (Model P): when leaf returns Parked, waitForSignal instead of
 * completing the OW run. After wake is received, return parked outcome as
 * interim terminal (LIFE-P2 will rematerialize + engage continue here).
 *
 * Never openSession / resolve packs here — leaf only.
 */

import {
  engagementWakeSignal,
} from "../signals.ts";
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
   * Required for Model P park wait (real OW worker).
   * Optional only for pure unit stubs that never hit Parked.
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
  /**
   * Wake wait step name (default: engagement-wake).
   * Must be unique within the workflow history.
   */
  readonly wakeStepName?: string;
};

/**
 * Run the engagement arc for one OW workflow invocation.
 *
 * Settled | Failed → return immediately (OW run completes).
 * Parked → waitForSignal(wake); on delivery return parked (P1 interim terminal).
 * LIFE-P2 will replace post-wake return with continue leaf.
 */
export async function runEngagementArc(
  params: RunEngagementArcParams,
): Promise<EngagementWorkflowOutput> {
  const leafStepName = params.leafStepName ?? "engagement-leaf";
  const wakeStepName = params.wakeStepName ?? "engagement-wake";
  const leafDeps: EngagementLeafDeps = {
    factory: params.deps.factory,
    join: params.deps.join,
    resolveDefinition: params.deps.resolveDefinition,
    runId: params.runId,
  };

  const outcome = await params.step.run({ name: leafStepName }, async () => {
    return runEngagementLeaf(params.input, leafDeps);
  });

  if (outcome.kind !== "parked") {
    return outcome;
  }

  // Model P: do not complete the OW run until wake is delivered.
  if (typeof params.step.waitForSignal !== "function") {
    return {
      kind: "failed",
      sessionRef: outcome.sessionRef,
      packSnapshotHash: outcome.packSnapshotHash,
      error: {
        message:
          "LIFE-P1: waitForSignal required on workflow step for Model P park (engagement-arc)",
        code: "PARK_WAIT_UNAVAILABLE",
      },
    };
  }

  const wakeSignal = engagementWakeSignal(params.runId);
  // Blocks OW run (sleeping / signal-wait). Signals are not buffered — client
  // must sendSignal after this wait is active (tests: poll status then wake).
  await params.step.waitForSignal({
    name: wakeStepName,
    signal: wakeSignal,
  });

  // P1 interim: wake acknowledged → complete with parked payload.
  // P2: rematerialize(sessionRef) + engage continue instead of return here.
  return outcome;
}
