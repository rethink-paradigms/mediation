/**
 * @internal
 * LEGACY / PRIVATE — NOT a product monocoque door (D3 L1–L2).
 *
 * Spawn is not identity. The only public door is Mediation / materialize
 * (PresenceFactory). This module exists as a fail-closed private stub so
 * adapters may reference “legacy spawn path” in tests without re-exporting
 * spawn as a second core.
 *
 * Do NOT re-export from src/index.ts. Do NOT document as the agent-execution API.
 * Full delete of external openworkflow/run-agent is out of this package (S11).
 *
 * Expiry: see package root MIGRATION-SPAWN.md (D3 L3).
 */

import { MediationError } from "../../domain/errors.ts";

/**
 * Private legacy engage-via-spawn entry. Always fails closed for product use.
 *
 * @throws MediationError with details.reason `"SPAWN_DISABLED"`
 */
export function spawnEngage(_input?: unknown): never {
  throw new MediationError(
    "POLICY_VIOLATION",
    "SPAWN_DISABLED: spawn is not a public monocoque door (D3). Use Mediation / materialize.",
    { reason: "SPAWN_DISABLED" },
  );
}

/**
 * Marker type for internal wiring tests only — not a public API surface.
 * @internal
 */
export type LegacySpawnEngageInput = {
  /** Opaque; unused — path is fail-closed. */
  readonly agentRef?: string;
};
