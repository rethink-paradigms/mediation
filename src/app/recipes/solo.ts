/**
 * Recipe A — Solo: local monocoque turn via Mediation.engageLocal.
 */

import type {
  EngageLocalInput,
  EngageLocalResult,
} from "../mediation.ts";
import type { Recipe } from "./types.ts";

export type SoloInput = EngageLocalInput;
export type SoloResult = EngageLocalResult;

/** Thin wrapper: load → materialize → engage → dispose (Mediation owns that). */
export const solo: Recipe<SoloInput, SoloResult> = {
  name: "solo",
  run(ctx, input) {
    return ctx.mediation.engageLocal(input);
  },
};
