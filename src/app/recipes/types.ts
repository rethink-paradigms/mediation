/**
 * ABS-B3 — experience recipes as thin wrappers over Mediation.
 * Law D0 P6: A–G are recipes on the core, not alternate monocoques.
 */

import type { Mediation } from "../mediation.ts";

/** Context every recipe receives — Mediation only (no private factory). */
export type RecipeContext = {
  readonly mediation: Mediation;
};

/**
 * Named experience recipe: composes Mediation ops only.
 */
export interface Recipe<I, O> {
  readonly name: string;
  run(ctx: RecipeContext, input: I): Promise<O>;
}
