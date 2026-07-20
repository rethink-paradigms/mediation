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
import { createSqliteRuntimeHost, type SqliteRuntimeHost } from "../src/adapters/openworkflow/host.ts";

export class MediationRunner implements RunnerPort {
  private liveObjects = new Map<string, unknown>();
  private workflowStatuses = new Map<string, RuntimeStatus>();
  private runtimeHost: SqliteRuntimeHost | null = null;

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
    if (this.runtimeHost) {
      const status = await this.runtimeHost.runtime.getStatus(asRunId(runId));
      return status as unknown as Record<string, unknown>;
    }
    const status = this.workflowStatuses.get(runId) ?? { state: "pending" };
    return status as unknown as Record<string, unknown>;
  }

  private async getOrCreateRuntimeHost(store?: CapabilityStore): Promise<SqliteRuntimeHost> {
    if (!this.runtimeHost) {
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

      this.runtimeHost = createSqliteRuntimeHost({
        dbPath: ":memory:",
        factory,
        resolveDefinition: async (ref) => {
          const loader = new YamlDefinitionLoader();
          return await loader.load(ref);
        },
      });
      await this.runtimeHost.worker.start();
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

    // A: Reuse existing live objects
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
