/**
 * CapabilityResolver — merge config layers + resolve extension ids via store (ABS-A6).
 *
 * Law D5: identity is CapabilityId; store supplies artifacts (FS/memory/registry).
 * Fail-closed: missing extension id → diagnostic level "error"; plan.ok === false.
 *
 * Layer rule: ports/ must not import app/ or adapters/.
 */

import type {
  CapabilityDiagnostic,
  CapabilityPlan,
} from "../domain/capability.ts";
import type {
  ConfigLayer,
  EffectiveCapabilitySpec,
} from "../domain/config-layer.ts";

/**
 * Resolve input: either ordered config layers (merged with mergeCapabilitySpecs)
 * or a pre-merged EffectiveCapabilitySpec. When both are provided, `layers`
 * wins (re-merged) so callers can always pass layers safely.
 */
export type CapabilityResolveInput = {
  readonly layers?: readonly ConfigLayer[];
  readonly effective?: EffectiveCapabilitySpec;
};

/**
 * Merge + store lookup result.
 * - `effective` — merged policy + ordered extension ids
 * - `plan` — CapabilityRefs for found extensions + fail-closed diagnostics
 * - `diagnostics` — same list as `plan.diagnostics` (convenience for callers)
 */
export type CapabilityResolveResult = {
  readonly effective: EffectiveCapabilitySpec;
  readonly plan: CapabilityPlan;
  readonly diagnostics: readonly CapabilityDiagnostic[];
};

/**
 * Port: layers/spec → effective + CapabilityPlan via CapabilityStore.
 * Implementations live under adapters/capability (DefaultCapabilityResolver).
 */
export interface CapabilityResolver {
  resolve(input: CapabilityResolveInput): Promise<CapabilityResolveResult>;
}
