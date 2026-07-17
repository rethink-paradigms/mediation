/**
 * OpenWorkflowRuntime — RuntimePort over the openworkflow client (D0 P2 / D4).
 *
 * Thin adapter: dispatch/cancel/signal/status/wait map to OW client + backend.
 * Does not materialize agents or open Pi sessions — orchestration only.
 *
 * Live worker registration of the engagement workflow is deferred (see EVIDENCE-S5a).
 * dispatch enqueues a run against the engagement WorkflowSpec; without a worker
 * the run stays pending (still proves RuntimePort client shape).
 */

import { defineWorkflowSpec } from "openworkflow";

import { asRunId, type RunId } from "../../domain/engagement.ts";
import type {
  DispatchHandle,
  DispatchInput,
  PlanSpec,
  RuntimePort,
  RuntimeStatus,
} from "../../ports/runtime.ts";
import { engagementSignalName } from "./signals.ts";
import {
  ENGAGEMENT_WORKFLOW_NAME,
  PLAN_WORKFLOW_NAME,
  type EngagementWorkflowInput,
  type EngagementWorkflowOutput,
} from "./types.ts";

/**
 * Structural workflow spec (OW does not re-export WorkflowSpec from package root).
 * Compatible with defineWorkflowSpec() return values and client.runWorkflow().
 */
export type WorkflowSpecRef<Input = unknown, Output = unknown> = {
  readonly name: string;
  readonly version?: string;
  /** Phantom — erased at runtime; documents I/O. */
  readonly __types?: { readonly input?: Input; readonly output?: Output };
};

/** OW workflow run status strings we map into RuntimeStatus. */
export type OwWorkflowRunStatus =
  | "pending"
  | "running"
  | "sleeping"
  | "succeeded"
  | "completed"
  | "failed"
  | "canceled"
  | string;

/** Minimal backend face used by RuntimePort (getStatus). */
export type RuntimeBackend = {
  getWorkflowRun(params: {
    workflowRunId: string;
  }): Promise<{
    id: string;
    status: OwWorkflowRunStatus;
    output?: unknown;
    error?: unknown;
  } | null>;
};

/** OpenWorkflow client face used by the adapter (dispatch / cancel / signal). */
export type RuntimeOwClient = {
  runWorkflow(
    spec: WorkflowSpecRef,
    input?: unknown,
    options?: { idempotencyKey?: string },
  ): Promise<{ workflowRun: { id: string; status: string } }>;
  cancelWorkflowRun(workflowRunId: string): Promise<void>;
  sendSignal(options: Readonly<{
    signal: string;
    data?: unknown;
    idempotencyKey?: string;
  }>): Promise<{ workflowRunIds: string[] }>;
};

export type OpenWorkflowRuntimeOptions = {
  readonly ow: RuntimeOwClient;
  readonly backend: RuntimeBackend;
  /**
   * Engagement leaf workflow spec. Defaults to a declared spec with
   * ENGAGEMENT_WORKFLOW_NAME (must be registered on a worker for completion).
   */
  readonly engagementSpec?: WorkflowSpecRef<
    EngagementWorkflowInput,
    EngagementWorkflowOutput
  >;
  /**
   * Plan workflow spec. If omitted, runPlan throws (plan-executor not in S5a).
   */
  readonly planSpec?: WorkflowSpecRef<PlanSpec, unknown>;
  /** Poll interval for wait() (default 50ms). */
  readonly pollIntervalMs?: number;
};

export function defaultEngagementWorkflowSpec(): WorkflowSpecRef<
  EngagementWorkflowInput,
  EngagementWorkflowOutput
> {
  return defineWorkflowSpec<EngagementWorkflowInput, EngagementWorkflowOutput>({
    name: ENGAGEMENT_WORKFLOW_NAME,
  });
}

export function defaultPlanWorkflowSpec(): WorkflowSpecRef<PlanSpec, unknown> {
  return defineWorkflowSpec<PlanSpec, unknown>({
    name: PLAN_WORKFLOW_NAME,
  });
}

function toEngagementInput(input: DispatchInput): EngagementWorkflowInput {
  return {
    agentName: input.agent.name,
    agentRoot: input.agent.rootDir,
    task: input.task,
    sessionRef: input.resume,
    requestId: input.clientRequestId,
  };
}

function mapOwStatus(run: {
  status: OwWorkflowRunStatus;
  output?: unknown;
  error?: unknown;
}): RuntimeStatus {
  switch (run.status) {
    case "pending":
      return { state: "pending" };
    case "running":
      return { state: "running" };
    case "sleeping":
      // OW sleep ≈ parked / waiting continuum at orchestration layer
      return { state: "running", parked: true };
    case "completed":
    case "succeeded":
      return { state: "completed", result: run.output ?? undefined };
    case "failed":
      return { state: "failed", error: run.error ?? undefined };
    case "canceled":
      return { state: "canceled" };
    default:
      return {
        state: "failed",
        error: { message: `unknown OW status: ${String(run.status)}` },
      };
  }
}

/**
 * RuntimePort implementation backed by OpenWorkflow client + backend.
 *
 * Orchestration client only — no materialize / engage. Signal names come from
 * `signals.ts` so the engagement arc can wait on the same addresses.
 */
export class OpenWorkflowRuntime implements RuntimePort {
  private readonly ow: RuntimeOwClient;
  private readonly backend: RuntimeBackend;
  private readonly engagementSpec: WorkflowSpecRef<
    EngagementWorkflowInput,
    EngagementWorkflowOutput
  >;
  private readonly planSpec: WorkflowSpecRef<PlanSpec, unknown> | undefined;
  private readonly pollIntervalMs: number;

  constructor(opts: OpenWorkflowRuntimeOptions) {
    this.ow = opts.ow;
    this.backend = opts.backend;
    this.engagementSpec = opts.engagementSpec ?? defaultEngagementWorkflowSpec();
    this.planSpec = opts.planSpec;
    this.pollIntervalMs = opts.pollIntervalMs ?? 50;
  }

  async dispatch(input: DispatchInput): Promise<DispatchHandle> {
    const engInput = toEngagementInput(input);
    const handle = await this.ow.runWorkflow(
      this.engagementSpec,
      engInput,
      input.clientRequestId
        ? { idempotencyKey: input.clientRequestId }
        : undefined,
    );
    return { runId: asRunId(handle.workflowRun.id) };
  }

  async runPlan(plan: PlanSpec): Promise<DispatchHandle> {
    if (!this.planSpec) {
      throw new Error(
        "OpenWorkflowRuntime.runPlan: no planSpec configured (plan-executor migration deferred; S5a)",
      );
    }
    const handle = await this.ow.runWorkflow(this.planSpec, plan, {
      idempotencyKey: plan.id,
    });
    return { runId: asRunId(handle.workflowRun.id) };
  }

  async sendSignal(runId: RunId, name: string, data: unknown): Promise<void> {
    // Data must be JSON-serializable for the OW backend.
    // Use engagementSignalName so LIFE-P1 waitForSignal matches this address.
    await this.ow.sendSignal({
      signal: engagementSignalName(runId, name),
      data: data as never,
    });
  }

  async cancel(runId: RunId): Promise<void> {
    await this.ow.cancelWorkflowRun(runId);
  }

  async getStatus(runId: RunId): Promise<RuntimeStatus> {
    const run = await this.backend.getWorkflowRun({ workflowRunId: runId });
    if (!run) {
      return {
        state: "failed",
        error: { message: `Unknown runId: ${runId}`, code: "RUN_NOT_FOUND" },
      };
    }
    return mapOwStatus(run);
  }

  async wait(
    runId: RunId,
    opts?: { timeoutMs?: number },
  ): Promise<RuntimeStatus> {
    const timeoutMs = opts?.timeoutMs ?? 300_000;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const status = await this.getStatus(runId);
      if (
        status.state === "completed" ||
        status.state === "failed" ||
        status.state === "canceled"
      ) {
        return status;
      }
      if (Date.now() >= deadline) {
        return {
          state: "failed",
          error: {
            message: `wait timed out after ${timeoutMs}ms (last state: ${status.state})`,
            code: "WAIT_TIMEOUT",
          },
        };
      }
      await sleep(this.pollIntervalMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
