/**
 * Engagement leaf body (Gamma structure).
 *
 * Input (serializable) → factory.materialize → join.put → engage → output.
 * No pack resolve inside the leaf (factory only). No engine session open here
 * (materialize is the single door via injected PresenceFactory).
 *
 * SoC: this module is one Pi life slice only. Durable park wait / wake loops
 * belong in `engagement-arc.ts`, not here. Never import openworkflow.
 */

import type { AgentDefinition } from "../../../domain/definition.ts";
import { resolveEngineKind, type EngineKind } from "../../../domain/engine.ts";
import { asRunId, type RunId } from "../../../domain/engagement.ts";
import { asSessionRef } from "../../../domain/presence.ts";
import type { PresenceFactory } from "../../../domain/presence.ts";
import type { JoinStore } from "../../../ports/join.ts";
import type { NotifyPort, NotifyRecord } from "../../../ports/notify.ts";
import type {
  EngagementWorkflowInput,
  EngagementWorkflowOutput,
} from "../types.ts";

export type EngagementLeafDeps = {
  readonly factory: PresenceFactory;
  readonly join: JoinStore;
  /**
   * Resolve inert definition from serializable agent identity.
   * Injected so workflow body never invents pack loading or yaml I/O.
   */
  readonly resolveDefinition: (
    input: EngagementWorkflowInput,
  ) => AgentDefinition | Promise<AgentDefinition>;
  /**
   * Durable run id (OW workflow run id when available).
   * If omitted, leaf synthesizes from requestId or a local counter.
   */
  readonly runId?: RunId | string;
  /**
   * Composition fallback engine for the leaf's in-run resolution
   * (S2e §4.3): input.engine ?? definition.engine ?? defaultEngine ?? "pi".
   * Threaded from the composition root (createHostedMediation / runner
   * --default-engine) so join records match the factory's resolution.
   */
  readonly defaultEngine?: EngineKind;
  /**
   * Optional NotifyPort (D3 P4 first pour) — emits parked / settled / failed
   * records for this durable run. Best-effort: a notify failure never fails
   * the leaf. Wake stays on RuntimePort.sendSignal("wake"), not notify.
   */
  readonly notify?: NotifyPort;
};

let localRunSeq = 0;

function resolveRunId(deps: EngagementLeafDeps, input: EngagementWorkflowInput): RunId {
  if (deps.runId !== undefined && deps.runId !== "") {
    return asRunId(String(deps.runId));
  }
  if (input.requestId) {
    return asRunId(input.requestId);
  }
  localRunSeq += 1;
  return asRunId(`local-engagement-${localRunSeq}`);
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Best-effort notify delivery (D3 P4). Never throws — notify failures must
 * not fail or corrupt the leaf's engagement outcome.
 */
function safeNotify(
  notify: NotifyPort | undefined,
  record: NotifyRecord,
): void {
  if (!notify) return;
  void notify.notify(record).catch(() => {
    // delivery failure isolated from the leaf
  });
}

/**
 * Fail-closed engine resolution for join/output records.
 * Returns undefined (never throws) when the value is bogus — the leaf's own
 * failure path carries the ENGINE_UNKNOWN code; the record engine is best-effort.
 */
function safeResolvedEngine(
  input: EngagementWorkflowInput,
  deps: EngagementLeafDeps,
  definition?: AgentDefinition,
): EngineKind | undefined {
  try {
    return resolveEngineKind({
      override: input.engine,
      config: definition?.engine,
      defaultEngine: deps.defaultEngine,
    });
  } catch {
    return undefined;
  }
}

/**
 * Pure Gamma leaf: materialize + join + engage + outcome.
 * Callable from unit tests without an OW worker; later wrapped by defineWorkflow.
 */
export async function runEngagementLeaf(
  input: EngagementWorkflowInput,
  deps: EngagementLeafDeps,
): Promise<EngagementWorkflowOutput> {
  const runId = resolveRunId(deps, input);
  let sessionRefStr: string | undefined;
  let packHash: string | undefined;

  let definition: AgentDefinition;
  try {
    definition = await deps.resolveDefinition(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    safeNotify(deps.notify, {
      runId,
      event: "failed",
      payload: { error: { message, code: "DEFINITION_RESOLVE_FAILED" } },
    });
    return {
      kind: "failed",
      error: { message, code: "DEFINITION_RESOLVE_FAILED" },
      engine: safeResolvedEngine(input, deps),
    };
  }

  // S2e: resolve the run's engine in-leaf so the join record and every output
  // variant carry the engine that actually drives materialize (the factory
  // resolves the same precedence from the override it receives below).
  // Fail-closed: a bogus serialized engine (input.engine) fails the leaf fast
  // with an ENGINE_UNKNOWN failed output — never a silent fallback to pi.
  let engine: EngineKind;
  try {
    engine = resolveEngineKind({
      override: input.engine,
      config: definition.engine,
      defaultEngine: deps.defaultEngine,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "ENGINE_UNKNOWN";
    safeNotify(deps.notify, {
      runId,
      event: "failed",
      payload: { error: { message, code } },
    });
    return { kind: "failed", error: { message, code } };
  }

  let presence;
  try {
    presence = await deps.factory.materialize(definition, {
      resume: input.sessionRef ? asSessionRef(input.sessionRef) : undefined,
      cwd: input.agentRoot,
      engine: input.engine,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "MATERIALIZE_FAILED";
    safeNotify(deps.notify, {
      runId,
      event: "failed",
      payload: { error: { message, code } },
    });
    return {
      kind: "failed",
      error: { message, code },
      engine,
    };
  }

  sessionRefStr = presence.sessionRef;
  packHash = presence.packSnapshot.planHash;

  try {
    await deps.join.put({
      runId,
      sessionRef: presence.sessionRef,
      definitionId: definition.id,
      packSnapshot: presence.packSnapshot,
      status: "engaging",
      updatedAt: now(),
      engine,
    });

    const outcome = await presence.engage({
      text: input.task,
      mode: input.engageMode,
      bridgeText: input.bridgeText,
      parkIntent: input.parkIntent,
      parkReason: input.parkReason,
    });

    if (outcome.kind === "settled") {
      await deps.join.updateStatus(runId, "settled");
      safeNotify(deps.notify, {
        runId,
        sessionRef: presence.sessionRef,
        event: "settled",
        payload: { result: outcome.result },
      });
      return {
        kind: "settled",
        sessionRef: outcome.sessionRef,
        packSnapshotHash: packHash,
        result: outcome.result,
        engine,
      };
    }

    if (outcome.kind === "parked") {
      await deps.join.put({
        runId,
        sessionRef: presence.sessionRef,
        definitionId: definition.id,
        packSnapshot: presence.packSnapshot,
        status: "parked",
        parked: {
          reason: outcome.reason,
          resumeToken: outcome.resumeToken,
        },
        updatedAt: now(),
        engine,
      });
      safeNotify(deps.notify, {
        runId,
        sessionRef: presence.sessionRef,
        event: "parked",
        payload: { reason: outcome.reason, resumeToken: outcome.resumeToken },
      });
      return {
        kind: "parked",
        sessionRef: outcome.sessionRef,
        packSnapshotHash: packHash,
        reason: outcome.reason,
        resumeToken: outcome.resumeToken,
        engine,
      };
    }

    await deps.join.updateStatus(runId, "failed");
    safeNotify(deps.notify, {
      runId,
      sessionRef: outcome.sessionRef ?? presence.sessionRef,
      event: "failed",
      payload: { error: outcome.error },
    });
    return {
      kind: "failed",
      sessionRef: outcome.sessionRef ?? sessionRefStr,
      packSnapshotHash: packHash,
      error: {
        message: outcome.error.message,
        code: outcome.error.code,
      },
      engine,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await deps.join.updateStatus(runId, "failed");
    } catch {
      // join may not have been written
    }
    safeNotify(deps.notify, {
      runId,
      sessionRef: sessionRefStr ? asSessionRef(sessionRefStr) : undefined,
      event: "failed",
      payload: { error: { message, code: "ENGAGE_FAILED" } },
    });
    return {
      kind: "failed",
      sessionRef: sessionRefStr,
      packSnapshotHash: packHash,
      error: { message, code: "ENGAGE_FAILED" },
      engine,
    };
  } finally {
    try {
      await presence.dispose();
    } catch {
      // dispose best-effort for headless leaf
    }
  }
}



