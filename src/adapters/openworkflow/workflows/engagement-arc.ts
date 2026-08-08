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

import { asRunId } from "../../../domain/engagement.ts";
import type { EngineKind } from "../../../domain/engine.ts";
import { asSessionRef } from "../../../domain/presence.ts";
import type { NotifyPort, NotifyRecord } from "../../../ports/notify.ts";
import {
  engagementWakeSignal,
  parseWakeSignalData,
  wakeBridgeText,
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


// ── Notify from the arc (spawn-mode delivery bridge) ─────────────────────────

/**
 * Best-effort notify delivery from the arc process. Never throws — a notify
 * failure must not fail or corrupt the arc.
 */
function safeNotify(
  notify: NotifyPort | undefined,
  record: NotifyRecord,
): void {
  if (!notify) return;
  void notify.notify(record).catch(() => {
    // delivery failure isolated from the arc
  });
}

/**
 * Emit a NotifyRecord for a leaf outcome from the ARC process.
 *
 * Why: in spawn mode (executeLeaf) the leaf runs in a child process whose
 * in-process notify cannot reach the daemon's notifier. The arc re-emits the
 * leaf's outcome record inside the daemon process — the notify→interrupt
 * server→client push path (D3 P4 / DAEMON-IPC-DESIGN §5).
 *
 * Callers gate on `executeLeaf !== undefined` so in-process mode (where the
 * leaf already notifies) never double-delivers.
 */
function arcNotifyForOutcome(
  outcome: EngagementWorkflowOutput,
  runId: string,
  notify: NotifyPort | undefined,
): void {
  if (!notify) return;
  switch (outcome.kind) {
    case "settled":
      safeNotify(notify, {
        runId: asRunId(runId),
        sessionRef: asSessionRef(outcome.sessionRef),
        event: "settled",
        payload: { result: outcome.result },
      });
      break;
    case "parked":
      safeNotify(notify, {
        runId: asRunId(runId),
        sessionRef: asSessionRef(outcome.sessionRef),
        event: "parked",
        payload: { reason: outcome.reason, resumeToken: outcome.resumeToken },
      });
      break;
    case "failed":
      safeNotify(notify, {
        runId: asRunId(runId),
        sessionRef:
          outcome.sessionRef !== undefined
            ? asSessionRef(outcome.sessionRef)
            : undefined,
        event: "failed",
        payload: { error: outcome.error },
      });
      break;
  }
}

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
  /**
   * Optional NotifyPort (D3 P4 first pour) threaded to the leaf so parked /
   * settled / failed records fire per leaf step (initial + wake continues).
   */
  readonly notify?: EngagementLeafDeps["notify"];
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
    notify: params.deps.notify,
  };

  let outcome = await params.step.run({ name: leafStepName }, async () => {
    if (params.deps.executeLeaf !== undefined) {
      return params.deps.executeLeaf(params.input, params.runId);
    }
    return runEngagementLeaf(params.input, leafDeps);
  });

  // Spawn mode: the leaf's notify ran in the child process — re-emit its
  // outcome record from the daemon process (no double-delivery in-process).
  if (params.deps.executeLeaf !== undefined) {
    arcNotifyForOutcome(outcome, params.runId, params.deps.notify);
  }


  let parkLoop = 0;
  while (outcome.kind === "parked") {
    parkLoop += 1;
    if (parkLoop > maxParkLoops) {
      const failed: EngagementWorkflowOutput = {
        kind: "failed",
        sessionRef: outcome.sessionRef,
        packSnapshotHash: outcome.packSnapshotHash,
        error: {
          message: `LIFE-P2: park loop exceeded maxParkLoops=${maxParkLoops}`,
          code: "PARK_LOOP_EXCEEDED",
        },
      };
      arcNotifyForOutcome(failed, params.runId, params.deps.notify);
      return failed;
    }

    if (typeof params.step.waitForSignal !== "function") {
      const failed: EngagementWorkflowOutput = {
        kind: "failed",
        sessionRef: outcome.sessionRef,
        packSnapshotHash: outcome.packSnapshotHash,
        error: {
          message:
            "LIFE-P1: waitForSignal required on workflow step for Model P park (engagement-arc)",
          code: "PARK_WAIT_UNAVAILABLE",
        },
      };
      arcNotifyForOutcome(failed, params.runId, params.deps.notify);
      return failed;
    }

    const wakeSignal = engagementWakeSignal(params.runId);
    // Blocks OW run. Signals are not buffered — client sends after wait is active.
    const delivery = await params.step.waitForSignal({
      name: `${wakeStepBase}-${parkLoop}`,
      signal: wakeSignal,
    });

    if (delivery === null) {
      const failed: EngagementWorkflowOutput = {
        kind: "failed",
        sessionRef: outcome.sessionRef,
        packSnapshotHash: outcome.packSnapshotHash,
        error: {
          message: "LIFE-P2: waitForSignal timed out or returned null",
          code: "PARK_WAKE_TIMEOUT",
        },
      };
      arcNotifyForOutcome(failed, params.runId, params.deps.notify);
      return failed;
    }

    const wake = parseWakeSignalData(delivery.data);
    // D1/D2 ParkBridge (issue #1): default continue after a settled park must
    // append whatWasAwaited + payload as a user message before the engine
    // verb — Pi rejects loop-resume continue after an assistant tail.
    const bridgeText =
      (wake.mode ?? "continue") === "continue"
        ? wakeBridgeText(outcome.reason, wake)
        : undefined;
    const continueInput: EngagementWorkflowInput = {
      agentName: params.input.agentName,
      agentRoot: params.input.agentRoot,
      definitionId: params.input.definitionId,
      requestId: params.input.requestId,
      // Resume same cognitive artifact (D1 continue after park).
      sessionRef: outcome.sessionRef,
      task: wake.payloadText,
      engageMode: wake.mode ?? "continue",
      // Bridge prose the continue leaf threads into engage (mode continue).
      bridgeText,
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

    // Spawn mode: re-emit the continue-leaf outcome from the daemon process.
    if (params.deps.executeLeaf !== undefined) {
      arcNotifyForOutcome(outcome, params.runId, params.deps.notify);
    }
  }

  return outcome;
}

