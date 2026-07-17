/**
 * Mediation façade — product entry over ports (D4 / S7).
 *
 * App layer: domain + ports only. Composition injects loader, factory,
 * optional RuntimePort + JoinStore. Surfaces (CLI) call this, not adapters.
 */

import type { AgentDefinition, AgentRef } from "../domain/definition.ts";
import type { EngagementRecord, RunId } from "../domain/engagement.ts";
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
    return this.loader.load(ref);
  }

  /** Materialize presence (optional resume). Caller owns dispose. */
  async materialize(
    definition: AgentDefinition,
    opts?: MaterializeOptions,
  ): Promise<AgentPresence> {
    return this.factory.materialize(definition, opts);
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
    const presence = await this.materialize(definition, {
      resume: input.sessionRef,
      cwd: input.cwd ?? input.agent.rootDir,
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

      const outcome = await presence.engage({
        text: input.task,
        mode: input.mode ?? "continue",
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
    return this.runtime.dispatch(input);
  }

  /** Dispatch durable multi-node plan via RuntimePort (recipe C / plan). */
  async runPlan(plan: PlanSpec): Promise<DispatchHandle> {
    if (!this.runtime) {
      throw new Error(
        "Mediation.runPlan: no RuntimePort configured (wire OpenWorkflowRuntime)",
      );
    }
    return this.runtime.runPlan(plan);
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
    return this.runtime.wait(runId, opts);
  }

  async getStatus(runId: RunId): Promise<RuntimeStatus> {
    if (!this.runtime) {
      throw new Error("Mediation.getStatus: no RuntimePort configured");
    }
    return this.runtime.getStatus(runId);
  }

  /** Cancel durable OW run (RuntimePort). */
  async cancel(runId: RunId): Promise<void> {
    if (!this.runtime) {
      throw new Error("Mediation.cancel: no RuntimePort configured");
    }
    return this.runtime.cancel(runId);
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
    return this.runtime.sendSignal(runId, name, data);
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
    return this.sendSignal(runId, "wake", data);
  }

  async getJoinByRunId(runId: RunId): Promise<EngagementRecord | null> {
    if (!this.join) {
      throw new Error("Mediation.getJoinByRunId: no JoinStore configured");
    }
    return this.join.getByRunId(runId);
  }

  async getJoinBySessionRef(
    sessionRef: SessionRef,
  ): Promise<EngagementRecord | null> {
    if (!this.join) {
      throw new Error("Mediation.getJoinBySessionRef: no JoinStore configured");
    }
    return this.join.getBySessionRef(sessionRef);
  }
}
