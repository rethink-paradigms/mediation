/**
 * Engagement leaf body (Gamma structure).
 *
 * Input (serializable) → factory.materialize → join.put → engage → output.
 * No pack resolve inside the leaf (factory only). No engine session open here
 * (materialize is the single door via injected PresenceFactory).
 */

import type { AgentDefinition } from "../../../domain/definition.ts";
import { asRunId, type RunId } from "../../../domain/engagement.ts";
import { asSessionRef } from "../../../domain/presence.ts";
import type { PresenceFactory } from "../../../domain/presence.ts";
import type { JoinStore } from "../../../ports/join.ts";
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
    return {
      kind: "failed",
      error: { message, code: "DEFINITION_RESOLVE_FAILED" },
    };
  }

  let presence;
  try {
    presence = await deps.factory.materialize(definition, {
      resume: input.sessionRef ? asSessionRef(input.sessionRef) : undefined,
      cwd: input.agentRoot,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "MATERIALIZE_FAILED";
    return {
      kind: "failed",
      error: { message, code },
    };
  }

  sessionRefStr = presence.sessionRef;
  packHash = presence.packSnapshot.planHash;

  const now = () => new Date().toISOString();

  try {
    await deps.join.put({
      runId,
      sessionRef: presence.sessionRef,
      definitionId: definition.id,
      packSnapshot: presence.packSnapshot,
      status: "engaging",
      updatedAt: now(),
    });

    const outcome = await presence.engage({ text: input.task });

    if (outcome.kind === "settled") {
      await deps.join.updateStatus(runId, "settled");
      return {
        kind: "settled",
        sessionRef: outcome.sessionRef,
        packSnapshotHash: packHash,
        result: outcome.result,
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
      });
      return {
        kind: "parked",
        sessionRef: outcome.sessionRef,
        packSnapshotHash: packHash,
        reason: outcome.reason,
        resumeToken: outcome.resumeToken,
      };
    }

    await deps.join.updateStatus(runId, "failed");
    return {
      kind: "failed",
      sessionRef: outcome.sessionRef ?? sessionRefStr,
      packSnapshotHash: packHash,
      error: {
        message: outcome.error.message,
        code: outcome.error.code,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await deps.join.updateStatus(runId, "failed");
    } catch {
      // join may not have been written
    }
    return {
      kind: "failed",
      sessionRef: sessionRefStr,
      packSnapshotHash: packHash,
      error: { message, code: "ENGAGE_FAILED" },
    };
  } finally {
    try {
      await presence.dispose();
    } catch {
      // dispose best-effort for headless leaf
    }
  }
}
