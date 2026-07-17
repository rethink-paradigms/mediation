/**
 * Recipe — Wake: deliver payload to a parked durable run (Model P).
 *
 * Thin: mediation.wake only. Worker arc continues leaf on same runId.
 */

import type { RunId } from "../../domain/engagement.ts";
import type { RuntimeStatus } from "../../ports/runtime.ts";
import type { Recipe } from "./types.ts";

export type WakeRecipeInput = {
  readonly runId: RunId | string;
  readonly payloadText: string;
  readonly mode?: "prompt" | "continue";
  readonly parkIntent?: boolean;
  readonly parkReason?: string;
  /**
   * When true/object, wait for terminal status after wake
   * (default continuum: settle after one continue).
   */
  readonly wait?: boolean | { readonly timeoutMs?: number };
};

export type WakeRecipeResult = {
  readonly runId: RunId | string;
  readonly status?: RuntimeStatus;
};

export const wake: Recipe<WakeRecipeInput, WakeRecipeResult> = {
  name: "wake",
  async run(ctx, input) {
    const runId = input.runId as RunId;
    await ctx.mediation.wake(runId, {
      payloadText: input.payloadText,
      mode: input.mode,
      parkIntent: input.parkIntent,
      parkReason: input.parkReason,
    });
    if (input.wait === undefined || input.wait === false) {
      return { runId };
    }
    const opts =
      input.wait === true ? undefined : { timeoutMs: input.wait.timeoutMs };
    const status = await ctx.mediation.wait(runId, opts);
    return { runId, status };
  },
};
