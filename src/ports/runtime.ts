/**
 * RuntimePort — durable orchestration face (OpenWorkflow default; swappable).
 * No vendor types.
 */

import type { AgentRef } from "../domain/definition.js";
import type { RunId } from "../domain/engagement.js";
import type { SessionRef } from "../domain/presence.js";

export type DispatchInput = {
  readonly agent: AgentRef;
  readonly task: string;
  readonly resume?: SessionRef;
  /** Correlation for join; runtime assigns runId if omitted. */
  readonly clientRequestId?: string;
  /**
   * When true, engagement leaf returns Parked after idle (D1 stand-in).
   * Serialized into EngagementWorkflowInput for the worker leaf.
   */
  readonly parkIntent?: boolean;
  readonly parkReason?: string;
};

export type DispatchHandle = {
  readonly runId: RunId;
};

/**
 * Multi-agent plan graph — serializable product shape.
 * Node bodies ultimately call the same engagement leaf.
 */
export type PlanSpec = {
  readonly id: string;
  readonly nodes: readonly PlanNodeSpec[];
  readonly edges?: readonly PlanEdgeSpec[];
  readonly meta?: Readonly<Record<string, unknown>>;
};

export type PlanNodeSpec = {
  readonly id: string;
  readonly agent: AgentRef;
  readonly task: string;
  readonly resume?: SessionRef;
};

export type PlanEdgeSpec = {
  readonly from: string;
  readonly to: string;
};

export type RuntimeStatus =
  | { readonly state: "pending" }
  | { readonly state: "running"; readonly parked?: boolean }
  | { readonly state: "completed"; readonly result?: unknown }
  | { readonly state: "failed"; readonly error?: unknown }
  | { readonly state: "canceled" };

export interface RuntimePort {
  dispatch(input: DispatchInput): Promise<DispatchHandle>;
  runPlan(plan: PlanSpec): Promise<DispatchHandle>;
  sendSignal(runId: RunId, name: string, data: unknown): Promise<void>;
  cancel(runId: RunId): Promise<void>;
  getStatus(runId: RunId): Promise<RuntimeStatus>;
  /** Optional: wait for terminal status (surfaces that block). */
  wait(runId: RunId, opts?: { timeoutMs?: number }): Promise<RuntimeStatus>;
}
