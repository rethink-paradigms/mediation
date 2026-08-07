/**
 * Recipe F — Interrupt: runId-scoped steer/followUp/abort (LIFE-L1).
 *
 * agent-presence-core §3 (experience F): redirect / approve / stop a live
 * run by runId. Only in-process live presences are interruptible —
 * anything else rejects PRESENCE_NOT_LIVE. Thin wrapper over
 * Mediation.interrupt (live registry lives on the façade).
 */

import type { RunId } from "../../domain/engagement.ts";
import type { InterruptKind } from "../../domain/presence.ts";
import type { Recipe } from "./types.ts";

export type InterruptRecipeInput = {
  readonly runId: RunId | string;
  readonly kind: InterruptKind;
  readonly payload?: unknown;
};

/** Resolves when the interrupt was delivered; rejects PRESENCE_NOT_LIVE. */
export const interrupt: Recipe<InterruptRecipeInput, void> = {
  name: "interrupt",
  run(ctx, input) {
    return ctx.mediation.interrupt(
      input.runId as RunId,
      input.kind,
      input.payload,
    );
  },
};
