/**
 * Domain-level event types (mediation plane).
 * Presence observe uses PresenceEvent; engine subscribe uses EngineEvent (ports).
 *
 * SURFACES (issue #3): union extended with run-scoped events emitted by the
 * Mediation façade (run.wake, engagement.status) and by the in-process notify
 * bridge (run.parked / run.settled / run.failed / run.interrupted) — recipe G
 * (observe) subscribes through Mediation.observe.
 */

import type { EngagementStatus } from "./engagement.js";
import type { PresenceStatus, RunOutcome, SessionRef } from "./presence.js";
import type { RunId } from "./engagement.js";
import type { InterruptKind } from "./presence.js";

/** Product-plane lifecycle events recipes/UIs may subscribe to via façade later. */
export type MediationEvent =
  | {
      readonly type: "presence.status";
      readonly presenceId: string;
      readonly status: PresenceStatus;
    }
  | {
      readonly type: "presence.outcome";
      readonly presenceId: string;
      readonly outcome: RunOutcome;
    }
  | {
      readonly type: "engagement.status";
      readonly runId: RunId;
      /** Unknown before the leaf materializes (dispatch-time); optional. */
      readonly sessionRef?: SessionRef;
      readonly status: EngagementStatus;
    }
  | {
      readonly type: "mediation.error";
      readonly code: string;
      readonly message: string;
    }
  // ── SURFACES wave (issue #3): run-scoped control-plane events ──────────
  | {
      readonly type: "run.parked";
      readonly runId: RunId;
      readonly sessionRef?: SessionRef;
      readonly reason?: string;
    }
  | {
      readonly type: "run.wake";
      readonly runId: RunId;
      readonly payloadText?: string;
    }
  | {
      readonly type: "run.settled";
      readonly runId: RunId;
      readonly sessionRef?: SessionRef;
    }
  | {
      readonly type: "run.failed";
      readonly runId: RunId;
      readonly sessionRef?: SessionRef;
      readonly code?: string;
    }
  | {
      readonly type: "run.interrupted";
      readonly runId: RunId;
      readonly kind?: InterruptKind;
    };

/**
 * Notify record shape (D3 P4) — same payload the NotifyPort delivers to
 * external surfaces. Defined here (domain) so ports/notify.ts aliases it and
 * the notify→MediationEvent mapping stays pure (no ports import in domain).
 */
export type NotifyRecordShape = {
  readonly runId: RunId;
  readonly sessionRef?: SessionRef;
  readonly event: "parked" | "settled" | "failed" | "interrupted";
  readonly payload?: unknown;
};

/** Pure mapping: NotifyRecord → MediationEvent (observe bridge, recipe G). */
export function mediationEventFromNotify(
  record: NotifyRecordShape,
): MediationEvent {
  switch (record.event) {
    case "parked": {
      const payload = record.payload as { readonly reason?: string } | undefined;
      return {
        type: "run.parked",
        runId: record.runId,
        sessionRef: record.sessionRef,
        reason: payload?.reason,
      };
    }
    case "settled": {
      return {
        type: "run.settled",
        runId: record.runId,
        sessionRef: record.sessionRef,
      };
    }
    case "failed": {
      const payload = record.payload as
        | { readonly error?: { readonly code?: string } }
        | undefined;
      return {
        type: "run.failed",
        runId: record.runId,
        sessionRef: record.sessionRef,
        code: payload?.error?.code,
      };
    }
    case "interrupted": {
      return {
        type: "run.interrupted",
        runId: record.runId,
      };
    }
  }
}
