/**
 * createSqliteRuntimeHost — productize local sqlite-only OW composition (ABS-C1).
 *
 * Composes BackendSqlite + OpenWorkflow + registerEngagementWorkflow
 * (+ optional plan) + worker + OpenWorkflowRuntime + JoinStore.
 * No postgres. Factory is injected (mock or Pi).
 *
 * ```ts
 * const host = createSqliteRuntimeHost({
 *   dbPath: ":memory:",
 *   factory,
 *   resolveDefinition,
 * });
 * await host.worker.start();
 * const handle = await host.runtime.dispatch({ agent, task });
 * const status = await host.runtime.wait(handle.runId);
 * await host.stop();
 * ```
 */

import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";

import type { PresenceFactory } from "../../domain/presence.ts";
import type { JoinStore } from "../../ports/join.ts";
import type { PlanSpec, RuntimePort } from "../../ports/runtime.ts";
import { MemoryJoinStore } from "../join/memory-store.ts";
import {
  registerEngagementWorkflow,
  type RegisterEngagementWorkflowDeps,
} from "./register-engagement.ts";
import { registerPlanWorkflow } from "./register-plan.ts";
import {
  OpenWorkflowRuntime,
  type WorkflowSpecRef,
} from "./runtime.ts";
import type {
  EngagementWorkflowInput,
  EngagementWorkflowOutput,
} from "./types.ts";

/** Worker face returned by OpenWorkflow.newWorker (start / stop / tick). */
export type RuntimeHostWorker = {
  start(): Promise<void>;
  stop(): Promise<void>;
  tick(): Promise<number>;
};

/**
 * Opaque-ish OpenWorkflow client handle for advanced callers.
 * Prefer RuntimePort for dispatch; use `ow` only when needed.
 */
export type RuntimeHostOw = OpenWorkflow;

export type CreateSqliteRuntimeHostOptions = {
  /** OW BackendSqlite path — filesystem file or `:memory:`. */
  readonly dbPath: string;
  /** Injected mind factory (mock or Pi). */
  readonly factory: PresenceFactory;
  /**
   * Product join store. Defaults to in-process MemoryJoinStore
   * (OW durability is separate via BackendSqlite).
   */
  readonly join?: JoinStore;
  /** Resolve inert AgentDefinition from serializable engagement input. */
  readonly resolveDefinition: RegisterEngagementWorkflowDeps["resolveDefinition"];
  /** When true, also register plan workflow and wire planSpec on RuntimePort. */
  readonly registerPlan?: boolean;
  /** Worker concurrency (default 1). */
  readonly concurrency?: number;
  /** RuntimePort.wait poll interval (default 50ms; tests often use 15). */
  readonly pollIntervalMs?: number;
  /** Override engagement WorkflowSpec (must match registered name). */
  readonly engagementSpec?: WorkflowSpecRef<
    EngagementWorkflowInput,
    EngagementWorkflowOutput
  >;
};

export type SqliteRuntimeHost = {
  readonly runtime: RuntimePort;
  /** OpenWorkflow client (implementWorkflow / runWorkflow / newWorker). */
  readonly ow: RuntimeHostOw;
  readonly worker: RuntimeHostWorker;
  readonly join: JoinStore;
  /**
   * Stop worker (if started) and OW sqlite backend.
   * Idempotent-ish: safe to call after partial start failure paths.
   */
  stop(): Promise<void>;
};

/**
 * Local sqlite-only OW runtime host: backend + client + registrations + worker + RuntimePort.
 */
export function createSqliteRuntimeHost(
  opts: CreateSqliteRuntimeHostOptions,
): SqliteRuntimeHost {
  const backend = BackendSqlite.connect(opts.dbPath);
  const ow = new OpenWorkflow({ backend });
  const join = opts.join ?? new MemoryJoinStore();

  const leafDeps = {
    factory: opts.factory,
    join,
    resolveDefinition: opts.resolveDefinition,
  };

  const { engagementSpec } = registerEngagementWorkflow(ow, {
    ...leafDeps,
    engagementSpec: opts.engagementSpec,
  });

  let planSpec: WorkflowSpecRef<PlanSpec, unknown> | undefined;
  if (opts.registerPlan) {
    const registered = registerPlanWorkflow(ow, leafDeps);
    planSpec = registered.planSpec as WorkflowSpecRef<PlanSpec, unknown>;
  }

  const runtime = new OpenWorkflowRuntime({
    ow,
    backend: {
      getWorkflowRun: (params) => backend.getWorkflowRun(params),
    },
    engagementSpec,
    planSpec,
    pollIntervalMs: opts.pollIntervalMs,
  });

  const worker = ow.newWorker({
    concurrency: opts.concurrency ?? 1,
  });

  let workerStarted = false;
  const wrappedWorker: RuntimeHostWorker = {
    async start() {
      await worker.start();
      workerStarted = true;
    },
    async stop() {
      if (workerStarted) {
        await worker.stop();
        workerStarted = false;
      }
    },
    tick: () => worker.tick(),
  };

  return {
    runtime,
    ow,
    worker: wrappedWorker,
    join,
    async stop() {
      await wrappedWorker.stop();
      await backend.stop();
    },
  };
}
