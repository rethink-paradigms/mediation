/**
 * Domain-level event types (mediation plane).
 * Presence observe uses PresenceEvent; engine subscribe uses EngineEvent (ports).
 */

import type { EngagementStatus } from "./engagement.js";
import type { PresenceStatus, RunOutcome, SessionRef } from "./presence.js";
import type { RunId } from "./engagement.js";

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
      readonly sessionRef: SessionRef;
      readonly status: EngagementStatus;
    }
  | {
      readonly type: "mediation.error";
      readonly code: string;
      readonly message: string;
    };
