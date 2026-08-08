/**
 * Canonical PackLoadPlan hashing — portable oracle (host-independent).
 *
 * Critique (S1 practice): hashing absolute paths made pack_plan_hash
 * host-fragile. Hash identity is {id, source} only; path stays on PackRef
 * for loading / reenter materialization, not for equality of pack set.
 */

import { createHash } from "node:crypto";
import type { PackLoadPlan, PackRef, PackSnapshot } from "../../domain/packs.js";

/** Canonical object for hashing: sorted by id then source (no absolute path). */
type PackHashEntry = {
  id: string;
  source: string;
};

/**
 * Stable JSON of sorted pack ids/sources.
 * Sort is lexicographic on id, then source (deterministic, portable).
 */
function canonicalPackEntries(packs: readonly PackRef[]): PackHashEntry[] {
  return packs
    .map((p) => ({ id: p.id, source: p.source }))
    .sort((a, b) => {
      const byId = a.id.localeCompare(b.id);
      if (byId !== 0) return byId;
      return a.source.localeCompare(b.source);
    });
}

/** SHA-256 hex of canonical pack list JSON (portable across hosts). */
export function planHash(packs: readonly PackRef[]): string {
  const payload = JSON.stringify(canonicalPackEntries(packs));
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/** Hash the packs of a load plan (diagnostics excluded from hash). */
export function packPlanHash(plan: PackLoadPlan): string {
  return planHash(plan.packs);
}

export function toPackSnapshot(
  plan: PackLoadPlan,
  createdAt: string = new Date().toISOString(),
): PackSnapshot {
  return {
    planHash: packPlanHash(plan),
    packs: plan.packs.map((p) => ({ ...p })),
    createdAt,
  };
}


