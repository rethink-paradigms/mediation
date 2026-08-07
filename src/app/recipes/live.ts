/**
 * Recipe D — Live presence: multi-engage same presence without re-materialize.
 *
 * agent-presence-core §3 (experience D): "Sit in the room, warm" — materialize
 * once, engage repeatedly (park without dispose, attach chat). One monocoque
 * path: load → materialize (single) → engage × N → dispose (unless keepAlive).
 *
 * Optional runId registers the presence in the in-process live registry so
 * recipe F (interrupt) can steer it mid-flight; keepAlive returns the live
 * presence + a close() that unregisters and disposes.
 */

import type { AgentRef } from "../../domain/definition.ts";
import type { EngineKind } from "../../domain/engine.ts";
import type { RunId } from "../../domain/engagement.ts";
import type {
  AgentPresence,
  EngageInput,
  RunOutcome,
  SessionRef,
} from "../../domain/presence.ts";
import type { Recipe } from "./types.ts";

export type LiveRecipeInput = {
  readonly agent: AgentRef;
  /** Optional cognitive resume handle (same monocoque as solo/reenter). */
  readonly resume?: SessionRef;
  readonly cwd?: string;
  /** Per-call engine override (S2e). */
  readonly engine?: EngineKind;
  /**
   * Register under this runId in the live registry (interruptible by runId).
   */
  readonly runId?: RunId;
  /** Engages to run sequentially on the SAME presence (no re-materialize). */
  readonly turns: readonly EngageInput[];
  /**
   * When true, the presence stays materialized + registered after the last
   * turn; result.presence is returned and result.close() unregisters +
   * disposes. Default false → dispose after the last turn.
   */
  readonly keepAlive?: boolean;
};

export type LiveRecipeResult = {
  readonly outcomes: readonly RunOutcome[];
  readonly sessionRef: SessionRef;
  readonly presenceId: string;
  /** Present when input.runId was provided (registry key). */
  readonly runId?: RunId;
  /** Present only when keepAlive is true (caller owns close()). */
  readonly presence?: AgentPresence;
  /** keepAlive: unregister + dispose (idempotent). */
  readonly close?: () => Promise<void>;
};

export const live: Recipe<LiveRecipeInput, LiveRecipeResult> = {
  name: "live",
  async run(ctx, input) {
    if (input.turns.length === 0) {
      throw new Error("live recipe: at least one turn required");
    }
    const definition = await ctx.mediation.load(input.agent);
    const presence = await ctx.mediation.materialize(definition, {
      resume: input.resume,
      cwd: input.cwd ?? input.agent.rootDir,
      engine: input.engine,
    });
    if (input.runId !== undefined) {
      ctx.mediation.registerLivePresence(input.runId, presence);
    }
    try {
      const outcomes: RunOutcome[] = [];
      for (const turn of input.turns) {
        outcomes.push(await presence.engage(turn));
      }
      const base: LiveRecipeResult = {
        outcomes,
        sessionRef: presence.sessionRef,
        presenceId: presence.id,
        runId: input.runId,
      };
      if (input.keepAlive === true) {
        return {
          ...base,
          presence,
          close: async () => {
            if (input.runId !== undefined) {
              ctx.mediation.unregisterLivePresence(input.runId);
            }
            try {
              await presence.dispose();
            } catch {
              // dispose best-effort
            }
          },
        };
      }
      return base;
    } finally {
      if (input.keepAlive !== true) {
        if (input.runId !== undefined) {
          ctx.mediation.unregisterLivePresence(input.runId);
        }
        try {
          await presence.dispose();
        } catch {
          // dispose best-effort
        }
      }
    }
  },
};
