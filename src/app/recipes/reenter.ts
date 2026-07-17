/**
 * Recipe E — Reenter: rematerialize same sessionRef + optional pack gate.
 */

import type { ReenterInput, ReenterResult } from "../mediation.ts";
import type { Recipe } from "./types.ts";

export type ReenterRecipeInput = ReenterInput;
export type ReenterRecipeResult = ReenterResult;

/** Thin wrapper over Mediation.reenter (same monocoque as solo). */
export const reenter: Recipe<ReenterRecipeInput, ReenterRecipeResult> = {
  name: "reenter",
  run(ctx, input) {
    return ctx.mediation.reenter(input);
  },
};
