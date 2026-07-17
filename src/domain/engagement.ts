/**
 * Dual-durability join types (D0 P4) — product correlation of OW run ⨝ session.
 */

import type { PackSnapshot } from "./packs.js";
import type { SessionRef } from "./presence.js";

/** Branded durable orchestration run id. */
export type RunId = string & { readonly __brand: "RunId" };

export function asRunId(value: string): RunId {
  return value as RunId;
}

export type EngagementStatus =
  | "materializing"
  | "engaging"
  | "settled"
  | "parked"
  | "failed";

/**
 * Join keys for a durable work unit that involves an agent.
 * Not the session transcript; not the workflow graph — only the join.
 */
export type JoinKeys = {
  readonly runId: RunId;
  readonly sessionRef: SessionRef;
  readonly definitionId: string;
  readonly packSnapshot: PackSnapshot;
};

export type EngagementRecord = {
  readonly runId: RunId;
  readonly sessionRef: SessionRef;
  readonly definitionId: string;
  readonly packSnapshot: PackSnapshot;
  readonly status: EngagementStatus;
  readonly parked?: {
    readonly reason: string;
    readonly resumeToken: string;
  };
  readonly updatedAt: string;
};
