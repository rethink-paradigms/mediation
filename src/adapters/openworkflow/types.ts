/**
 * Serializable engagement workflow I/O (Gamma leaf).
 * JSON-safe only — no class instances, no EnginePort handles.
 */

import type { EngineKind } from "../../domain/engine.ts";

/**
 * Workflow input for a single-agent engagement leaf / arc slice.
 * `agentName` + `agentRoot` identify the agent; definition loading is injected
 * outside this type (factory path does not invent pack loading).
 *
 * Optional park/mode fields are serializable control for tests and recipes;
 * auto wait-tool park detection remains out of band (D1 stand-in).
 */
export type EngagementWorkflowInput = {
  readonly agentName: string;
  readonly agentRoot: string;
  readonly task: string;
  /** Resume an existing session (SessionRef as plain string for JSON). */
  readonly sessionRef?: string;
  /** Client correlation id (maps to DispatchInput.clientRequestId). */
  readonly requestId?: string;
  /**
   * Optional definition id override (default: agentName).
   * Kept serializable so workers do not need local yaml when tests inject defs.
   */
  readonly definitionId?: string;
  /**
   * When true, leaf engage returns Parked after idle (D1 / S9 stand-in).
   * Used by LIFE park continuum tests and explicit recipes.
   */
  readonly parkIntent?: boolean;
  readonly parkReason?: string;
  /** Engage mode for this leaf slice (default engine/presence: prompt). */
  readonly engageMode?: "prompt" | "continue";
  /**
   * Per-call engine override (S2e). Serialized from DispatchInput.engine /
   * PlanNodeSpec.engine; the leaf passes it into materialize and resolves the
   * full precedence (override > definition.engine > defaultEngine > "pi") for
   * the join record + output variants.
   */
  readonly engine?: EngineKind;
};

/**
 * Workflow output — settled | parked | failed with pack snapshot hash for join.
 */
export type EngagementWorkflowOutput =
  | {
      readonly kind: "settled";
      readonly sessionRef: string;
      readonly packSnapshotHash: string;
      readonly result?: unknown;
      /** Engine the run materialized on (S2e) — join records it. */
      readonly engine?: EngineKind;
    }
  | {
      readonly kind: "parked";
      readonly sessionRef: string;
      readonly packSnapshotHash: string;
      readonly reason: string;
      readonly resumeToken: string;
      /** Engine the run materialized on (S2e) — join records it. */
      readonly engine?: EngineKind;
    }
  | {
      readonly kind: "failed";
      readonly sessionRef?: string;
      readonly packSnapshotHash?: string;
      readonly error: {
        readonly message: string;
        readonly code?: string;
      };
      /** Engine the run materialized on (S2e) — join records it. */
      readonly engine?: EngineKind;
    };

/** Canonical workflow name registered with OpenWorkflow workers. */
export const ENGAGEMENT_WORKFLOW_NAME = "mediation-engagement" as const;

/** Plan workflow name (runPlan stub until plan-executor migration). */
export const PLAN_WORKFLOW_NAME = "mediation-plan" as const;
