/**
 * Recipe B — Dispatch: durable engagement via RuntimePort (+ optional wait).
 */

import type { RunId } from "../../domain/engagement.ts";
import type {
  DispatchHandle,
  DispatchInput,
  RuntimeStatus,
} from "../../ports/runtime.ts";
import type { Recipe } from "./types.ts";

export type DispatchRecipeInput = DispatchInput & {
  /**
   * When true, wait for terminal status with default timeout.
   * When object, pass timeoutMs to Mediation.wait.
   */
  readonly wait?: boolean | { readonly timeoutMs?: number };
};

export type DispatchRecipeResult = {
  readonly handle: DispatchHandle;
  /** Present only when input.wait was set. */
  readonly status?: RuntimeStatus;
};

/** Thin wrapper: mediation.dispatch, optional mediation.wait. */
export const dispatch: Recipe<DispatchRecipeInput, DispatchRecipeResult> = {
  name: "dispatch",
  async run(ctx, input) {
    const { wait: waitOpt, ...dispatchInput } = input;
    const handle = await ctx.mediation.dispatch(dispatchInput);
    if (waitOpt === undefined || waitOpt === false) {
      return { handle };
    }
    const opts =
      waitOpt === true
        ? undefined
        : { timeoutMs: waitOpt.timeoutMs };
    const status = await ctx.mediation.wait(handle.runId as RunId, opts);
    return { handle, status };
  },
};
