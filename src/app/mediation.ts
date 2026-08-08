/**
 * Mediation façade — product entry over ports (D4 / S7).
 *
 * App layer: domain + ports only. Composition injects loader, factory,
 * optional RuntimePort + JoinStore. Surfaces (CLI) call this, not adapters.
 */

import type { AgentDefinition, AgentRef } from "../domain/definition.ts";
import type { EngineKind } from "../domain/engine.ts";
import type {
  CapabilityConfig,
  ComposeResult,
  ExplainResult,
  ListFilter,
  NodeSummary,
  ResolveOptions,
  ResolveResult,
  ValidationResult,
} from "../domain/knowledge/types.ts";
import type {
  KnowledgePort,
  NodeDescription,
} from "../ports/knowledge.ts";
import {
  asRunId,
  type EngagementRecord,
  type RunId,
} from "../domain/engagement.ts";
import { MediationError } from "../domain/errors.ts";
import {
  mediationEventFromNotify,
  type MediationEvent,
} from "../domain/events.ts";
import { buildParkBridge } from "../domain/park-bridge.ts";
import { outcomeFromError } from "./outcomes.ts";
import type {
  AgentPresence,
  EngageInput,
  InterruptKind,
  MaterializeOptions,
  PresenceFactory,
  RunOutcome,
  SessionRef,
} from "../domain/presence.ts";
import type { DefinitionLoader } from "../ports/definition-loader.ts";
import type { JoinStore } from "../ports/join.ts";
import {
  isObservableNotifyPort,
  type NotifyPort,
  type NotifyRecord,
} from "../ports/notify.ts";
import type {
  DispatchHandle,
  DispatchInput,
  PlanSpec,
  RuntimePort,
  RuntimeStatus,
} from "../ports/runtime.ts";

export type MediationDeps = {
  readonly loader: DefinitionLoader;
  readonly factory: PresenceFactory;
  /** Optional — dispatch/wait require it. */
  readonly runtime?: RuntimePort;
  /** Optional — join lookup / correlation. */
  readonly join?: JoinStore;
  /**
   * Optional NotifyPort (D3 P4 first pour). The façade emits parked /
   * settled / failed / interrupted records for local + control-plane ops;
   * the engagement leaf emits for durable runs. When the port is the
   * in-process adapter, Mediation.observe bridges its records into
   * MediationEvent (recipe G).
   */
  readonly notify?: NotifyPort;
  /**
   * Optional KnowledgePort (DOMAIN-M capability graph). When provided, the
   * façade exposes it as `Mediation.knowledge` — the capability-graph face
   * (list/describe/resolve/validate/compose/explain) for surfaces. Composition
   * roots (createLocalMediation / createHostedMediation) inject
   * KnowledgeService (DEFAULT_CATALOG) by default (phase 2 wiring).
   */
  readonly knowledge?: KnowledgePort;
};

export type EngageLocalInput = {
  readonly agent: AgentRef;
  readonly task: string;
  readonly resume?: SessionRef;
  readonly cwd?: string;
  readonly mode?: EngageInput["mode"];
  /** S9: force Parked outcome after idle (recipe / test). */
  readonly parkIntent?: boolean;
  readonly parkReason?: string;
  /** Per-call engine override (S2e). */
  readonly engine?: EngineKind;
};

export type EngageLocalResult = {
  readonly outcome: RunOutcome;
  readonly sessionRef?: SessionRef;
  readonly packSnapshotHash?: string;
  readonly definitionId: string;
};

/**
 * S8 reenter: rematerialize same sessionRef, optional packSnapshot gate, engage.
 */
export type ReenterInput = {
  readonly agent: AgentRef;
  readonly sessionRef: SessionRef;
  readonly task: string;
  readonly cwd?: string;
  readonly mode?: EngageInput["mode"];
  /**
   * If set, fail when rematerialized planHash differs (pack parity).
   */
  readonly expectedPackSnapshotHash?: string;
  readonly parkIntent?: boolean;
  readonly parkReason?: string;
  /**
   * Per-call engine override (S2e). Resume pins the engine: when omitted,
   * reenter reuses the join record's engine (when a join is present).
   */
  readonly engine?: EngineKind;
};

export type ReenterResult = EngageLocalResult & {
  /** True when expectedPackSnapshotHash was provided and matched. */
  readonly packSnapshotMatch: boolean;
};

/**
 * DOMAIN-M knowledge face — the capability-graph ops a surface consumes off
 * the Mediation façade (phase 2: Domain M wired into the product). Stable
 * public shape for the Pi-extension's mediation_agents backend:
 *
 *   listCapabilities / describeCapability / resolveIntent / validate /
 *   compose / explain
 *
 * `agentFor` is the optional catalog→agent bridge: capability identity →
 * AgentRef (resolveIntent → agent → engage). Absent when the wired port
 * implements no mapping (DEFAULT_CATALOG is pure capability data).
 */
export type MediationKnowledgeFace = {
  readonly listCapabilities: (filter?: ListFilter) => Promise<NodeSummary[]>;
  readonly describeCapability: (identity: string) => Promise<NodeDescription>;
  readonly resolveIntent: (
    intent: string,
    options?: ResolveOptions,
  ) => Promise<ResolveResult>;
  readonly validate: (config: CapabilityConfig) => Promise<ValidationResult>;
  readonly compose: (ids: readonly string[]) => Promise<ComposeResult>;
  readonly explain: (config: CapabilityConfig) => Promise<ExplainResult>;
  readonly agentFor?: (identity: string) => Promise<AgentRef | undefined>;
};

/**
 * Sole product façade for load / materialize / local engage / dispatch.
 */
export class Mediation {
  private readonly loader: DefinitionLoader;
  private readonly factory: PresenceFactory;
  private readonly runtime: RuntimePort | undefined;
  private readonly join: JoinStore | undefined;
  private readonly notify: NotifyPort | undefined;
  /**
   * DOMAIN-M capability-graph face (phase 2). Undefined when no KnowledgePort
   * was wired (direct `new Mediation`); composition always injects one.
   */
  readonly knowledge: MediationKnowledgeFace | undefined;
  /** MediationEvent observers (recipe G / UIs). Error-isolated fan-out. */
  private readonly observers = new Set<(event: MediationEvent) => void>();
  /**
   * In-process live-Presence registry (LIFE-L1 first pour):
   * runId → materialized+live presence. interrupt(runId, …) hits this;
   * miss → PRESENCE_NOT_LIVE. Multi-process bus deferred.
   */
  private readonly livePresences = new Map<RunId, AgentPresence>();

  constructor(deps: MediationDeps) {
    this.loader = deps.loader;
    this.factory = deps.factory;
    this.runtime = deps.runtime;
    this.join = deps.join;
    this.notify = deps.notify;
    this.knowledge =
      deps.knowledge === undefined ? undefined : knowledgeFaceFor(deps.knowledge);
  }

  /** Load inert AgentDefinition from AgentRef. */
  async load(ref: AgentRef): Promise<AgentDefinition> {
    return await this.loader.load(ref);
  }

  /** Materialize presence (optional resume). Caller owns dispose. */
  async materialize(
    definition: AgentDefinition,
    opts?: MaterializeOptions,
  ): Promise<AgentPresence> {
    return await this.factory.materialize(definition, opts);
  }

  /**
   * Local monocoque turn: load → materialize → engage → dispose.
   * Does not use RuntimePort (headless / CLI engage path).
   */
  async engageLocal(input: EngageLocalInput): Promise<EngageLocalResult> {
    const definition = await this.load(input.agent);
    const presence = await this.materialize(definition, {
      resume: input.resume,
      cwd: input.cwd ?? input.agent.rootDir,
      engine: input.engine,
    });
    try {
      const outcome = await presence.engage({
        text: input.task,
        mode: input.mode,
        parkIntent: input.parkIntent,
        parkReason: input.parkReason,
      });
      // Recipe G: local engages are observable product events.
      this.emitEvent({ type: "presence.outcome", presenceId: presence.id, outcome });
      // D3 P4: local outcomes notify too (synthesized runId — no durable run).
      await this.safeNotify({
        runId: asRunId(`local:${presence.id}`),
        sessionRef: presence.sessionRef,
        event: outcome.kind,
        payload: notifyPayloadFor(outcome),
      });
      return {
        outcome,
        sessionRef: presence.sessionRef,
        packSnapshotHash: presence.packSnapshot.planHash,
        definitionId: definition.id,
      };
    } finally {
      try {
        await presence.dispose();
      } catch {
        // best-effort
      }
    }
  }

  /**
   * S8 reenter recipe: materialize(resume) → optional pack gate → engage → dispose.
   * Same monocoque as engageLocal; requires sessionRef (cognitive identity).
   */
  async reenter(input: ReenterInput): Promise<ReenterResult> {
    const definition = await this.load(input.agent);
    // Resume pins the engine (S2e §5): explicit override wins; else the join
    // record's engine (the engine that created the session) when known. The
    // same record carries the park wait contract (parked.reason) for the
    // D1 bridge below.
    let engine = input.engine;
    let record: EngagementRecord | null = null;
    if (this.join !== undefined) {
      record = await this.join.getBySessionRef(input.sessionRef);
      if (engine === undefined) {
        engine = record?.engine;
      }
    }
    // S8 reenter park reason (wait contract) for the D1 bridge — the join
    // record written at park time carries it (parked.reason). Fetched via
    // the same join lookup that pins the engine above when available.
    const parkReason = input.parkReason ?? record?.parked?.reason;

    const presence = await this.materialize(definition, {
      resume: input.sessionRef,
      cwd: input.cwd ?? input.agent.rootDir,
      engine,
    });
    try {
      const hash = presence.packSnapshot.planHash;
      if (
        input.expectedPackSnapshotHash !== undefined &&
        input.expectedPackSnapshotHash !== hash
      ) {
        const mismatchOutcome: RunOutcome = outcomeFromError({
          sessionRef: presence.sessionRef,
          error: {
            message: `reenter packSnapshot mismatch: expected ${input.expectedPackSnapshotHash}, got ${hash}`,
            code: "PACK_SNAPSHOT_MISMATCH",
          },
          code: "PACK_SNAPSHOT_MISMATCH",
        });
        this.emitEvent({ type: "presence.outcome", presenceId: presence.id, outcome: mismatchOutcome });
        await this.safeNotify({
          runId: asRunId(`local:${presence.id}`),
          sessionRef: presence.sessionRef,
          event: "failed",
          payload: notifyPayloadFor(mismatchOutcome),
        });
        return {
          outcome: mismatchOutcome,
          sessionRef: presence.sessionRef,
          packSnapshotHash: hash,
          definitionId: definition.id,
          packSnapshotMatch: false,
        };
      }

      const mode = input.mode ?? "continue";
      // D1/D2 ParkBridge (issue #1): continue after a settled park appends
      // whatWasAwaited (join park reason) + payload (task) as a user message
      // so the engine verb is legal after an assistant-final transcript.
      const bridgeText =
        mode === "continue"
          ? buildParkBridge({
              whatWasAwaited: parkReason ?? "",
              payload: input.task,
            }).text
          : undefined;

      const outcome = await presence.engage({
        text: input.task,
        mode,
        bridgeText,
        parkIntent: input.parkIntent,
        parkReason: input.parkReason,
      });
      this.emitEvent({ type: "presence.outcome", presenceId: presence.id, outcome });
      await this.safeNotify({
        runId: asRunId(`local:${presence.id}`),
        sessionRef: presence.sessionRef,
        event: outcome.kind,
        payload: notifyPayloadFor(outcome),
      });
      return {
        outcome,
        sessionRef: presence.sessionRef,
        packSnapshotHash: hash,
        definitionId: definition.id,
        packSnapshotMatch: true,
      };
    } finally {
      try {
        await presence.dispose();
      } catch {
        // best-effort
      }
    }
  }

  /**
   * Reenter using JoinStore sessionRef (and optional stored planHash gate).
   */
  async reenterFromJoin(
    key: { runId: RunId } | { sessionRef: SessionRef },
    input: Omit<ReenterInput, "sessionRef" | "expectedPackSnapshotHash"> & {
      readonly enforcePackSnapshot?: boolean;
    },
  ): Promise<ReenterResult> {
    if (!this.join) {
      throw new Error("Mediation.reenterFromJoin: no JoinStore configured");
    }
    const record =
      "runId" in key
        ? await this.join.getByRunId(key.runId)
        : await this.join.getBySessionRef(key.sessionRef);
    if (!record) {
      return {
        outcome: outcomeFromError({
          error: "reenterFromJoin: no join record",
          code: "JOIN_NOT_FOUND",
        }),
        definitionId: "",
        packSnapshotMatch: false,
      };
    }
    return this.reenter({
      ...input,
      sessionRef: record.sessionRef,
      // Pin the creating run's engine (resume is engine-specific).
      engine: input.engine ?? record.engine,
      expectedPackSnapshotHash: input.enforcePackSnapshot
        ? record.packSnapshot.planHash
        : undefined,
    });
  }

  /** Dispatch durable engagement via RuntimePort. */
  async dispatch(input: DispatchInput): Promise<DispatchHandle> {
    if (!this.runtime) {
      throw new Error(
        "Mediation.dispatch: no RuntimePort configured (wire OpenWorkflowRuntime)",
      );
    }
    const handle = await this.runtime.dispatch(input);
    // Recipe G: a dispatched run is observable from the control plane.
    this.emitEvent({
      type: "engagement.status",
      runId: handle.runId,
      status: "materializing",
    });
    return handle;
  }

  /** Dispatch durable multi-node plan via RuntimePort (recipe C / plan). */
  async runPlan(plan: PlanSpec): Promise<DispatchHandle> {
    if (!this.runtime) {
      throw new Error(
        "Mediation.runPlan: no RuntimePort configured (wire OpenWorkflowRuntime)",
      );
    }
    return await this.runtime.runPlan(plan);
  }

  async wait(
    runId: RunId,
    opts?: { timeoutMs?: number },
  ): Promise<RuntimeStatus> {
    if (!this.runtime) {
      throw new Error("Mediation.wait: no RuntimePort configured");
    }
    if (!this.runtime.wait) {
      throw new Error("Mediation.wait: RuntimePort.wait not implemented");
    }
    return await this.runtime.wait(runId, opts);
  }

  async getStatus(runId: RunId): Promise<RuntimeStatus> {
    if (!this.runtime) {
      throw new Error("Mediation.getStatus: no RuntimePort configured");
    }
    return await this.runtime.getStatus(runId);
  }

  /** Cancel durable OW run (RuntimePort). */
  async cancel(runId: RunId): Promise<void> {
    if (!this.runtime) {
      throw new Error("Mediation.cancel: no RuntimePort configured");
    }
    return await this.runtime.cancel(runId);
  }

  /**
   * Send named signal to a durable run.
   * Model P wake uses name `"wake"` (see ENGAGEMENT_WAKE_KIND / signals.ts).
   */
  async sendSignal(
    runId: RunId,
    name: string,
    data?: unknown,
  ): Promise<void> {
    if (!this.runtime) {
      throw new Error("Mediation.sendSignal: no RuntimePort configured");
    }
    return await this.runtime.sendSignal(runId, name, data);
  }

  /**
   * Product wake after Model P park — same runId, continue leaf on worker.
   * Data: `{ payloadText, mode?, parkIntent?, parkReason? }` (WakeSignalData shape).
   */
  async wake(
    runId: RunId,
    data: {
      readonly payloadText: string;
      readonly mode?: "prompt" | "continue";
      readonly parkIntent?: boolean;
      readonly parkReason?: string;
    },
  ): Promise<void> {
    // Recipe G: wake is a control-plane event (order: parked → wake → settled).
    this.emitEvent({ type: "run.wake", runId, payloadText: data.payloadText });
    return await this.sendSignal(runId, "wake", data);
  }

  async getJoinByRunId(runId: RunId): Promise<EngagementRecord | null> {
    if (!this.join) {
      throw new Error("Mediation.getJoinByRunId: no JoinStore configured");
    }
    return await this.join.getByRunId(runId);
  }

  async getJoinBySessionRef(
    sessionRef: SessionRef,
  ): Promise<EngagementRecord | null> {
    if (!this.join) {
      throw new Error("Mediation.getJoinBySessionRef: no JoinStore configured");
    }
    return await this.join.getBySessionRef(sessionRef);
  }

  // ── SURFACES wave (issue #3): observe + live interrupt registry ────────

  /**
   * Observe the MediationEvent stream (recipe G — observe).
   * Façade ops emit directly; when the wired NotifyPort is the in-process
   * adapter, leaf/durable records (parked/settled/failed/interrupted) are
   * bridged into the same stream, so one subscription sees the full run
   * story (park → wake → settled). Returns unsubscribe.
   */
  observe(listener: (event: MediationEvent) => void): () => void {
    this.observers.add(listener);
    let offNotify: (() => void) | undefined;
    if (isObservableNotifyPort(this.notify)) {
      offNotify = this.notify.on((record) => {
        listener(mediationEventFromNotify(record));
      });
    }
    return () => {
      this.observers.delete(listener);
      offNotify?.();
    };
  }

  /** Register a materialized+live presence under a runId (LIFE-L1). */
  registerLivePresence(runId: RunId, presence: AgentPresence): void {
    this.livePresences.set(runId, presence);
  }

  /** Remove a live presence (dispose / recipe close). */
  unregisterLivePresence(runId: RunId): void {
    this.livePresences.delete(runId);
  }

  /**
   * RunId-scoped interrupt (LIFE-L1 / recipe F). Only in-process live
   * presences are interruptible; anything else fails PRESENCE_NOT_LIVE.
   */
  async interrupt(
    runId: RunId,
    kind: InterruptKind,
    payload?: unknown,
  ): Promise<void> {
    const presence = this.livePresences.get(runId);
    if (!presence) {
      throw new MediationError(
        "PRESENCE_NOT_LIVE",
        `run ${runId} is not live in-process (no live presence registered)`,
        { runId },
      );
    }
    await presence.interrupt(kind, payload);
    await this.safeNotify({
      runId,
      sessionRef: presence.sessionRef,
      event: "interrupted",
      payload: { kind, payload },
    });
    this.emitEvent({ type: "run.interrupted", runId, kind });
  }

  /** Error-isolated MediationEvent fan-out (observer errors never break ops). */
  private emitEvent(event: MediationEvent): void {
    for (const listener of this.observers) {
      try {
        listener(event);
      } catch {
        // observer errors isolated from façade operations
      }
    }
  }

  /** Best-effort notify delivery (D3 P4) — notify failures never fail ops. */
  private async safeNotify(record: NotifyRecord): Promise<void> {
    if (!this.notify) return;
    try {
      await this.notify.notify(record);
    } catch {
      // delivery failure isolated
    }
  }
}

/** Outcome → NotifyRecord payload (D3 P4). */
function notifyPayloadFor(outcome: RunOutcome): unknown {
  switch (outcome.kind) {
    case "settled":
      return { result: outcome.result };
    case "parked":
      return { reason: outcome.reason, resumeToken: outcome.resumeToken };
    case "failed":
      return { error: outcome.error };
  }
}

/**
 * Build the DOMAIN-M knowledge face over a wired KnowledgePort (phase 2).
 * Six stable ops mirror the port's list/describe/resolve/validate/compose/
 * explain; the optional agentFor bridge is surfaced only when the port
 * implements it (no fake "no mapping" op on the public face).
 */
function knowledgeFaceFor(port: KnowledgePort): MediationKnowledgeFace {
  const agentFor = port.agentFor;
  const face: MediationKnowledgeFace = {
    listCapabilities: (filter) => port.list(filter),
    describeCapability: (identity) => port.describe(identity),
    resolveIntent: (intent, options) => port.resolve(intent, options),
    validate: (config) => port.validate(config),
    compose: (ids) => port.compose(ids),
    explain: (config) => port.explain(config),
  };
  if (agentFor !== undefined) {
    // Bind to the port: the method reference alone would lose `this`.
    return { ...face, agentFor: agentFor.bind(port) };
  }
  return face;
}

