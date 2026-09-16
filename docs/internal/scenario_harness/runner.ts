import path from "node:path";
import { rmSync } from "node:fs";

import type {
  RunnerPort,
  RunnerResult,
  PlanOperation,
  CapabilityDef,
  ExecutionContext,
} from "@company/test-harness";
import {
  DefaultPresenceFactory,
  MemoryCapabilityStore,
  FsCapabilityStore,
  toPackSnapshot,
  createCapabilityResolver,
  YamlDefinitionLoader,
  asSessionRef,
  asRunId,
  Mediation,

  type AgentDefinition,
  type AgentPresence,
  type CapabilityStore,
  type RuntimeStatus,
} from "../src/index.ts";
import { MockEnginePort } from "../src/adapters/mock/engine-adapter.ts";
import { PiEngineAdapter } from "../src/adapters/pi/engine-adapter.ts";
import { SqliteJoinStore } from "../src/adapters/join/sqlite-store.ts";
import { createSqliteRuntimeHost, type SqliteRuntimeHost } from "../src/adapters/openworkflow/host.ts";
import type { SpawnLeafConfig } from "../src/adapters/openworkflow/spawn-leaf.ts";
import type { EngagementWorkflowOutput } from "../src/adapters/openworkflow/types.ts";

export class MediationRunner implements RunnerPort {
  private liveObjects = new Map<string, unknown>();
  private workflowStatuses = new Map<string, RuntimeStatus>();
  private runtimeHost: SqliteRuntimeHost | null = null;
  private spawnJoin: SqliteJoinStore | null = null;
  /** Track spawn SQLite files for cleanup across scenario init cycles. */
  private spawnCleanupPaths: { dbPath?: string; joinPath?: string } = {};

  async execute(
    op: PlanOperation,
    capability: CapabilityDef,
    _ctx: ExecutionContext,
  ): Promise<RunnerResult> {
    const method = capability.action.method as string;
    const params = op.params;

    try {
      let rawOutput: Record<string, unknown> | null = null;
      switch (method) {
        case "createCapabilityStore":
          rawOutput = await this.handleCreateCapabilityStore(op.resource, params);
          break;
        case "loadDefinition":
          rawOutput = await this.handleLoadDefinition(op.resource, params);
          break;
        case "materializePresence":
          rawOutput = await this.handleMaterializePresence(op.resource, params);
          break;
        case "engagePresence":
          rawOutput = await this.handleEngagePresence(params);
          break;
        case "resumePresence":
          rawOutput = await this.handleResumePresence(params);
          break;
        case "disposePresence":
          rawOutput = await this.handleDisposePresence(params);
          break;
        case "dispatchWorkflow":
          rawOutput = await this.handleDispatchWorkflow(params);
          break;
        case "getWorkflowStatus":
          rawOutput = await this.handleGetWorkflowStatus(params);
          break;
        case "cancelWorkflow":
          rawOutput = await this.handleCancelWorkflow(params);
          break;
        case "wakeWorkflow":
          rawOutput = await this.handleWakeWorkflow(params);
          break;
        case "getWorkflowJoin":
          rawOutput = await this.handleGetWorkflowJoin(params);
          break;
        case "engageLocal":
          rawOutput = await this.handleEngageLocal(op.resource, params);
          break;
        default:
          throw new Error(`Unknown action method: ${method}`);
      }
      return { rawOutput };
    } catch (err) {
      return {
        rawOutput: null,
        error: { message: (err as Error).message, code: (err as any).code || "RUNNER_ERROR" },
      };
    }
  }

  private handleCreateCapabilityStore(
    resource: string,
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const variant = params.variant as string;
    let store: CapabilityStore;

    if (variant === "memory") {
      store = new MemoryCapabilityStore();
    } else if (variant === "fs") {
      const projectRoot = (params.projectRoot as string) || ".";
      store = new FsCapabilityStore({ projectRoot });
    } else {
      throw new Error(`Unknown store variant: ${variant}`);
    }

    this.liveObjects.set(resource, store);
    return { kind: variant };
  }

  private async handleLoadDefinition(
    resource: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const name = params.name as string;
    const rootDir = (params.rootDir as string) || "fixtures/definition/case-basic";
    
    const loader = new YamlDefinitionLoader();
    const def = await loader.load({ name, rootDir });
    
    this.liveObjects.set(resource, def);
    return { id: def.id, name: def.name };
  }

  private async handleEngagePresence(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const presenceRef = (params.presenceId || params.presence) as string;
    const presence = this.liveObjects.get(presenceRef) as AgentPresence;
    if (!presence) throw new Error(`Presence "${presenceRef}" not found`);

    const text = params.text as string;
    const parkIntent = (params.parkIntent as boolean) || false;

    const outcome = await presence.engage({ text, parkIntent });
    return outcome as unknown as Record<string, unknown>;
  }

  private async handleResumePresence(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const presenceRef = (params.presenceId || params.presence) as string;
    const presence = this.liveObjects.get(presenceRef) as AgentPresence;
    if (!presence) throw new Error(`Presence "${presenceRef}" not found`);

    const text = params.text as string;
    
    const outcome = await presence.engage({ text, mode: "continue" });
    return outcome as unknown as Record<string, unknown>;
  }

  private async handleDisposePresence(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const presenceRef = (params.presenceId || params.presence) as string;
    const presence = this.liveObjects.get(presenceRef) as AgentPresence;
    if (presence) {
      await presence.dispose();
    }
    return { success: true };
  }

  private async handleGetWorkflowStatus(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const runId = params.runId as string;
    if (process.env.MEDIATION_LIVE_OW === "1") {
      // Cross-process: connect to the file-backed OW backend so a later CLI
      // invocation can read runs dispatched by an earlier one.
      const host = await this.getOrCreateRuntimeHost();
      const status = await host.runtime.getStatus(asRunId(runId));
      return status as unknown as Record<string, unknown>;
    }
    if (this.runtimeHost) {
      const status = await this.runtimeHost.runtime.getStatus(asRunId(runId));
      return status as unknown as Record<string, unknown>;
    }
    const status = this.workflowStatuses.get(runId) ?? { state: "pending" };
    return status as unknown as Record<string, unknown>;
  }
  // ── Spawn mode config ──────────────────────────────────────────────────

  private resolveSpawnConfig(): SpawnLeafConfig | undefined {
    if (process.env.MEDIATION_SPAWN !== "1") return undefined;
    const resultsDir = process.env.MEDIATION_RESULTS_DIR
      ?? path.resolve("results");
    return {
      joinPath: process.env.MEDIATION_SPAWN_JOIN_PATH
        ?? path.join(resultsDir, "spawn-join.sqlite"),
      projectRoot: process.env.MEDIATION_SPAWN_PROJECT_ROOT,
      usePi: process.env.MEDIATION_LIVE_PI === "1",
    };
  }

  private cleanupSpawnFiles(): void {
    const { dbPath, joinPath } = this.spawnCleanupPaths;
    if (dbPath) {
      try { rmSync(dbPath); } catch {
        // ignore
      }
      try { rmSync(dbPath + "-wal"); } catch {
        // ignore
      }
      try { rmSync(dbPath + "-shm"); } catch {
        // ignore
      }
    }
    if (joinPath) {
      try { rmSync(joinPath); } catch {
        // ignore
      }
      try { rmSync(joinPath + "-wal"); } catch {
        // ignore
      }
      try { rmSync(joinPath + "-shm"); } catch {
        // ignore
      }
    }
    this.spawnCleanupPaths = {};
  }

  /**
   * Stop the OW worker + backend so one-shot CLI processes can exit.
   * The OW worker's poll loop keeps the Node event loop alive; without this
   * the CLI hangs after its last command. Persisted spawn SQLite files are
   * intentionally left in place — later CLI invocations (next `step`) reconnect
   * to the same file-backed OW backend.
   */
  async stop(): Promise<void> {
    if (this.runtimeHost) {
      await this.runtimeHost.stop();
      this.runtimeHost = null;
    }
    if (this.spawnJoin !== null) {
      this.spawnJoin.close();
      this.spawnJoin = null;
    }
  }

  private async getOrCreateRuntimeHost(store?: CapabilityStore): Promise<SqliteRuntimeHost> {
    if (!this.runtimeHost) {
      const spawnConfig = this.resolveSpawnConfig();
      const actualStore = store || new MemoryCapabilityStore();
      const resolver = createCapabilityResolver(actualStore);
      const engine = process.env.MEDIATION_LIVE_PI === "1"
        ? new PiEngineAdapter({ inMemorySession: true })
        : new MockEnginePort({
            sessionRefFactory: () => asSessionRef("mock-presence-session"),
          });

      const factory = new DefaultPresenceFactory({
        engine,
        toPackSnapshot,
        capabilityResolver: resolver,
      });

      const dbPath = spawnConfig !== undefined
        ? (process.env.MEDIATION_SPAWN_DB_PATH ?? path.resolve("results", "spawn-ow.sqlite"))
        : ":memory:";

      // Clean up previous spawn files before creating new ones
      if (this.spawnCleanupPaths.dbPath) {
        this.cleanupSpawnFiles();
      }

      // Spawn mode: parent reads the same join SQLite file the child writes.
      if (spawnConfig !== undefined && this.spawnJoin === null) {
        this.spawnJoin = new SqliteJoinStore({ path: spawnConfig.joinPath });
      }

      this.runtimeHost = createSqliteRuntimeHost({
        dbPath,
        join: this.spawnJoin ?? undefined,
        factory,
        resolveDefinition: async (ref) => {
          const loader = new YamlDefinitionLoader();
          return await loader.load(ref);
        },
        spawnConfig,
      });
      await this.runtimeHost.worker.start();

      // Track for cleanup
      if (spawnConfig && typeof dbPath === "string") {
        this.spawnCleanupPaths = { dbPath, joinPath: spawnConfig.joinPath };
      }
    }
    return this.runtimeHost;
  }

  private async handleMaterializePresence(
    resource: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const defRef = params.definition as string;
    const definition = this.liveObjects.get(defRef) as AgentDefinition;
    if (!definition) throw new Error(`Definition "${defRef}" not found`);

    let store = Array.from(this.liveObjects.values()).find(
      (o) => o instanceof MemoryCapabilityStore || o instanceof FsCapabilityStore,
    ) as CapabilityStore;

    if (!store) {
      store = new MemoryCapabilityStore();
    }

    const resolver = createCapabilityResolver(store);
    const engine = process.env.MEDIATION_LIVE_PI === "1"
      ? new PiEngineAdapter({ inMemorySession: true })
      : new MockEnginePort({
          sessionRefFactory: () => asSessionRef("mock-presence-session"),
        });

    const factory = new DefaultPresenceFactory({
      engine,
      toPackSnapshot,
      capabilityResolver: resolver,
    });

    const mode = (params.mode as "headless" | "attached") || "headless";
    const presence = await factory.materialize(definition, { mode });

    this.liveObjects.set(resource, presence);
    this.liveObjects.set(presence.id, presence);
    return {
      id: presence.id,
      sessionRef: presence.sessionRef,
      status: presence.status,
    };
  }

  private async handleDispatchWorkflow(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const agentName = params.agentName as string;
    const rootDir = params.rootDir as string;
    const task = params.task as string;
    const parkIntent = (params.parkIntent as boolean) || false;

    if (process.env.MEDIATION_LIVE_OW === "1") {
      const store = Array.from(this.liveObjects.values()).find(
        (o) => o instanceof MemoryCapabilityStore || o instanceof FsCapabilityStore,
      ) as CapabilityStore;

      const host = await this.getOrCreateRuntimeHost(store);
      const handle = await host.runtime.dispatch({
        agent: { name: agentName, rootDir },
        task,
        parkIntent,
      });
      return { runId: handle.runId };
    }

    const runId = asRunId(`run-${Math.random().toString(36).slice(2, 9)}`);
    if (parkIntent) {
      this.workflowStatuses.set(runId, { state: "running", parked: true });
    } else {
      this.workflowStatuses.set(runId, { state: "completed", result: { status: "settled" } });
    }

    return { runId };
  }

  private async handleCancelWorkflow(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const runId = params.runId as string;
    if (process.env.MEDIATION_LIVE_OW === "1") {
      const host = await this.getOrCreateRuntimeHost();
      await host.runtime.cancel(asRunId(runId));
      return { success: true };
    }
    if (this.runtimeHost) {
      await this.runtimeHost.runtime.cancel(asRunId(runId));
      return { success: true };
    }
    this.workflowStatuses.set(runId, { state: "canceled" });
    return { success: true };
  }

  private async handleWakeWorkflow(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const runId = params.runId as string;
    const text = params.text as string;
    if (process.env.MEDIATION_LIVE_OW === "1") {
      const host = await this.getOrCreateRuntimeHost();
      await host.runtime.sendSignal(asRunId(runId), "wake", {
        payloadText: text,
      });
      return { success: true };
    }
    if (this.runtimeHost) {
      await this.runtimeHost.runtime.sendSignal(asRunId(runId), "wake", {
        payloadText: text,
      });
      return { success: true };
    }
    // Mock logic
    this.workflowStatuses.set(runId, { state: "completed", result: { status: "settled" } });
    return { success: true };
  }

  private async handleGetWorkflowJoin(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const runId = params.runId as string;
    if (process.env.MEDIATION_LIVE_OW === "1") {
      const host = await this.getOrCreateRuntimeHost();
      const record = await host.join.getByRunId(asRunId(runId));
      if (!record) throw new Error("Join record not found for runId: " + runId);
      return {
        sessionRef: record.sessionRef,
        packSnapshotHash: record.packSnapshot.planHash,
        status: record.status,
      };
    }
    if (this.runtimeHost) {
      const record = await this.runtimeHost.join.getByRunId(asRunId(runId));
      if (!record) throw new Error("Join record not found for runId: " + runId);
      return {
        sessionRef: record.sessionRef,
        packSnapshotHash: record.packSnapshot.planHash,
        status: record.status,
      };
    }
    return {
      sessionRef: "mock-session-ref",
      packSnapshotHash: "mock-hash",
      status: "parked",
    };
  }

  private async handleEngageLocal(_resource: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const agentName = params.agentName as string;
    const rootDir = params.rootDir as string;
    const task = params.task as string;
    const parkIntent = (params.parkIntent as boolean) || false;

    // Spawn path: route through OW dispatch so engagement runs as child process
    const spawnConfig = this.resolveSpawnConfig();
    if (spawnConfig && process.env.MEDIATION_LIVE_OW === "1") {
      const host = await this.getOrCreateRuntimeHost();
      const handle = await host.runtime.dispatch({
        agent: { name: agentName, rootDir },
        task,
        parkIntent,
      });
      const finalStatus = await host.runtime.wait(handle.runId);
      const outcome = finalStatus.result as EngagementWorkflowOutput | undefined;
      const join = await host.join.getByRunId(asRunId(handle.runId));
      return {
        runId: handle.runId,
        kind: outcome?.kind ?? "settled",
        sessionRef: join?.sessionRef ?? "unknown",
        packSnapshotHash: join?.packSnapshot?.planHash ?? "unknown",
        definitionId: join?.definitionId ?? agentName,
      };
    }

    // In-process path (existing logic)
    let store = Array.from(this.liveObjects.values()).find(
      (o) => o instanceof MemoryCapabilityStore || o instanceof FsCapabilityStore,
    ) as CapabilityStore;
    if (!store) store = new MemoryCapabilityStore();

    const resolver = createCapabilityResolver(store);
    const engine = process.env.MEDIATION_LIVE_PI === "1"
      ? new PiEngineAdapter({ inMemorySession: true })
      : new MockEnginePort({
          sessionRefFactory: () => asSessionRef("mock-presence-session"),
        });

    const factory = new DefaultPresenceFactory({
      engine,
      toPackSnapshot,
      capabilityResolver: resolver,
    });

    const mediation = new Mediation({
      loader: new YamlDefinitionLoader(),
      factory,
    });

    const result = await mediation.engageLocal({
      agent: { name: agentName, rootDir },
      task,
      parkIntent,
    });

    return {
      kind: result.outcome.kind,
      sessionRef: result.sessionRef,
      packSnapshotHash: result.packSnapshotHash,
      definitionId: result.definitionId,
    };
  }
}

