/**
 * Mediation façade — product entry over ports (D4 / S7).
 *
 * App layer: domain + ports only. Composition injects loader, factory,
 * optional RuntimePort + JoinStore. Surfaces (CLI) call this, not adapters.
 */

import type { AgentDefinition, AgentRef } from "../domain/definition.ts";
import type { EngineKind } from "../domain/engine.ts";
import type { EngagementRecord, RunId } from "../domain/engagement.ts";
import { buildParkBridge } from "../domain/park-bridge.ts";
import type {
  AgentPresence,
  EngageInput,
  MaterializeOptions,
  PresenceFactory,
  RunOutcome,
  SessionRef,
} from "../domain/presence.ts";
import type { DefinitionLoader } from "../ports/definition-loader.ts";
import type { JoinStore } from "../ports/join.ts";
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
 * Sole product façade for load / materialize / local engage / dispatch.
 */
export class Mediation {
  private readonly loader: DefinitionLoader;
  private readonly factory: PresenceFactory;
  private readonly runtime: RuntimePort | undefined;
  private readonly join: JoinStore | undefined;

  constructor(deps: MediationDeps) {
    this.loader = deps.loader;
    this.factory = deps.factory;
    this.runtime = deps.runtime;
    this.join = deps.join;
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
        return {
          outcome: {
            kind: "failed",
            sessionRef: presence.sessionRef,
            error: {
              message: `reenter packSnapshot mismatch: expected ${input.expectedPackSnapshotHash}, got ${hash}`,
              code: "PACK_SNAPSHOT_MISMATCH",
            },
          },
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
        outcome: {
          kind: "failed",
          error: {
            message: "reenterFromJoin: no join record",
            code: "JOIN_NOT_FOUND",
          },
        },
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
    return await this.runtime.dispatch(input);
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
}

