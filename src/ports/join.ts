/**
 * JoinStore — dual durability index (runId ⨝ sessionRef ⨝ packSnapshot ⨝ definitionId).
 */

import type {
  EngagementRecord,
  EngagementStatus,
  RunId,
} from "../domain/engagement.js";
import type { SessionRef } from "../domain/presence.js";

export interface JoinStore {
  put(record: EngagementRecord): Promise<void>;
  getByRunId(runId: RunId): Promise<EngagementRecord | null>;
  getBySessionRef(sessionRef: SessionRef): Promise<EngagementRecord | null>;
  updateStatus(runId: RunId, status: EngagementStatus): Promise<void>;
}
