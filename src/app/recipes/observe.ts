/**
 * Recipe G — Observe: subscribe to run events (MediationEvent stream).
 *
 * agent-presence-core §3 (experience G): "What is it doing / did" — events +
 * run status; dual durability join. Thin wrapper over Mediation.observe with
 * an optional runId filter (events for other runs / no-run events are
 * dropped). The full stream includes façade emissions (dispatch materializing,
 * wake run.wake) plus bridged notify records (run.parked / run.settled /
 * run.failed / run.interrupted).
 */

import type { RunId } from "../../domain/engagement.ts";
import type { MediationEvent } from "../../domain/events.ts";
import type { Recipe } from "./types.ts";

export type ObserveRecipeInput = {
  /**
   * Scope the stream to one run. When omitted, all MediationEvents pass
   * through (including no-run presence events).
   */
  readonly runId?: RunId | string;
};

export type ObserveRecipeResult = {
  /** Subscribe; returns unsubscribe. Events outside runId scope are dropped. */
  subscribe(listener: (event: MediationEvent) => void): () => void;
};

export const observe: Recipe<ObserveRecipeInput, ObserveRecipeResult> = {
  name: "observe",
  run(ctx, input) {
    return Promise.resolve({
      subscribe(listener) {
        return ctx.mediation.observe((event) => {
          if (input.runId === undefined) {
            listener(event);
            return;
          }
          const eventRunId = (event as { readonly runId?: unknown }).runId;
          if (eventRunId === input.runId) {
            listener(event);
          }
        });
      },
    });
  },
};
