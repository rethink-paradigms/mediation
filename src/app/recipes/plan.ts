/**
 * Recipe C — Plan: multi-node PlanSpec via RuntimePort.runPlan.
 */

import type { DispatchHandle, PlanSpec } from "../../ports/runtime.ts";
import type { Recipe } from "./types.ts";

export type PlanRecipeInput = PlanSpec;
export type PlanRecipeResult = DispatchHandle;

/**
 * Thin wrapper over Mediation.runPlan.
 * Throws when no RuntimePort is configured (same fail-fast as dispatch).
 */
export const plan: Recipe<PlanRecipeInput, PlanRecipeResult> = {
  name: "plan",
  run(ctx, input) {
    return ctx.mediation.runPlan(input);
  },
};
