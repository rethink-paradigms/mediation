/**
 * Engagement arc — OW-step orchestration around the pure Gamma leaf.
 *
 * Separation of concerns:
 * - `runEngagementLeaf`  = one Pi life slice (materialize → join → engage → dispose)
 * - `runEngagementArc`   = durable run story (steps, park wait, wake continue)
 * - `registerEngagementWorkflow` = thin OW client binding only
 *
 * LIFE-P1/P2 (Model P):
 *   Parked → waitForSignal(wake) → leaf continue (resume sessionRef) → …
 *   Loop until Settled | Failed (or re-park safety cap).
 *
 * Never openSession / resolve packs here — leaf only.
 */

import type { EngineKind } from "../../../domain/engine.ts";
import {
  engagementWakeSignal,
  parseWakeSignalData,
} from "../signals.ts";
import type {
  EngagementWorkflowInput,
  EngagementWorkflowOutput,
} from "../types.ts";
import {
  runEngagementLeaf,
  type EngagementLeafDeps,
} from "./engagement.ts";

/** Safety cap on park → wake → continue cycles (fail-closed). */
export const ENGAGEMENT_ARC_MAX_PARK_LOOPS = 32;

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
  /**
   * Optional spawn executor. When provided the arc calls this instead of
   * runEngagementLeaf in-process, enabling child-process isolation.
   * Each leaf runs in its own Node process; a crash kills only that child.
   */
  readonly executeLeaf?: (
    input: EngagementWorkflowInput,
    runId: string,
  ) => Promise<EngagementWorkflowOutput>;
  /**
   * Composition fallback engine threaded to the leaf (S2e) so the join
   * record / outputs carry the same engine the registry factory resolves.
   */
  readonly defaultEngine?: EngineKind;
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
   * Base name for wake wait steps (default: engagement-wake).
   * Iterations append `-${n}` for unique OW step history.
   */
  readonly wakeStepName?: string;
  /**
   * Base name for continue leaf steps (default: engagement-continue).
   * Iterations append `-${n}`.
   */
  readonly continueStepName?: string;
  /** Override park-loop safety cap (default ENGAGEMENT_ARC_MAX_PARK_LOOPS). */
  readonly maxParkLoops?: number;
};

/**
 * Run the engagement arc for one OW workflow invocation.
 *
 * Settled | Failed → return immediately (OW run completes).
 * Parked → waitForSignal → continue leaf (resume) → repeat until terminal.
 */
export async function runEngagementArc(
  params: RunEngagementArcParams,
): Promise<EngagementWorkflowOutput> {
  const leafStepName = params.leafStepName ?? "engagement-leaf";
  const wakeStepBase = params.wakeStepName ?? "engagement-wake";
  const continueStepBase = params.continueStepName ?? "engagement-continue";
  const maxParkLoops = params.maxParkLoops ?? ENGAGEMENT_ARC_MAX_PARK_LOOPS;

  const leafDeps: EngagementLeafDeps = {
    factory: params.deps.factory,
    join: params.deps.join,
    resolveDefinition: params.deps.resolveDefinition,
    runId: params.runId,
    defaultEngine: params.deps.defaultEngine,
  };

  let outcome = await params.step.run({ name: leafStepName }, async () => {
    if (params.deps.executeLeaf !== undefined) {
      return params.deps.executeLeaf(params.input, params.runId);
    }
    return runEngagementLeaf(params.input, leafDeps);
  });


  let parkLoop = 0;
  while (outcome.kind === "parked") {
    parkLoop += 1;
    if (parkLoop > maxParkLoops) {
      return {
        kind: "failed",
        sessionRef: outcome.sessionRef,
        packSnapshotHash: outcome.packSnapshotHash,
        error: {
          message: `LIFE-P2: park loop exceeded maxParkLoops=${maxParkLoops}`,
          code: "PARK_LOOP_EXCEEDED",
        },
      };
    }

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
    // Blocks OW run. Signals are not buffered — client sends after wait is active.
    const delivery = await params.step.waitForSignal({
      name: `${wakeStepBase}-${parkLoop}`,
      signal: wakeSignal,
    });

    if (delivery === null) {
      return {
        kind: "failed",
        sessionRef: outcome.sessionRef,
        packSnapshotHash: outcome.packSnapshotHash,
        error: {
          message: "LIFE-P2: waitForSignal timed out or returned null",
          code: "PARK_WAKE_TIMEOUT",
        },
      };
    }

    const wake = parseWakeSignalData(delivery.data);
    const continueInput: EngagementWorkflowInput = {
      agentName: params.input.agentName,
      agentRoot: params.input.agentRoot,
      definitionId: params.input.definitionId,
      requestId: params.input.requestId,
      // Resume same cognitive artifact (D1 continue after park).
      sessionRef: outcome.sessionRef,
      task: wake.payloadText,
      engageMode: wake.mode ?? "continue",
      // S2e §5: park → wake continue MUST pin the run's engine. Copy the
      // serialized engine override; without it the wake leaf would fall back
      // to definition/default and could resume a Pi ref on the wrong engine.
      engine: params.input.engine,
      // Clear park unless wake payload explicitly re-parks (tests / control plane).
      parkIntent: wake.parkIntent === true ? true : undefined,
      parkReason: wake.parkIntent === true ? wake.parkReason : undefined,
    };

    outcome = await params.step.run(
      { name: `${continueStepBase}-${parkLoop}` },
      async () => {
        if (params.deps.executeLeaf !== undefined) {
          return params.deps.executeLeaf(continueInput, params.runId);
        }
        return runEngagementLeaf(continueInput, leafDeps);
      },
    );

  }

  return outcome;
}

