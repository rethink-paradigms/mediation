/**
 * Serializable engagement workflow I/O (Gamma leaf).
 * JSON-safe only — no class instances, no EnginePort handles.
 */

/**
 * Workflow input for a single-agent engagement leaf.
 * `agentName` + `agentRoot` identify the agent; definition loading is injected
 * outside this type (factory path does not invent pack loading).
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
    }
  | {
      readonly kind: "parked";
      readonly sessionRef: string;
      readonly packSnapshotHash: string;
      readonly reason: string;
      readonly resumeToken: string;
    }
  | {
      readonly kind: "failed";
      readonly sessionRef?: string;
      readonly packSnapshotHash?: string;
      readonly error: {
        readonly message: string;
        readonly code?: string;
      };
    };

/** Canonical workflow name registered with OpenWorkflow workers. */
export const ENGAGEMENT_WORKFLOW_NAME = "mediation-engagement" as const;

/** Plan workflow name (runPlan stub until plan-executor migration). */
export const PLAN_WORKFLOW_NAME = "mediation-plan" as const;
