/**
 * Runtime engine selection (S2e) — pure domain.
 * Domain layer: no vendor types, no adapter imports.
 *
 * Engine kinds are the runtime adapters that can run any AgentDefinition:
 *   "pi"    — Pi engine (current real engine; built-in default)
 *   "prime" — Prime engine (parallel adapter slice)
 *   "mock"  — in-memory test/dev engine (explicit-only at composition)
 *
 * Fail-closed: asEngineKind / resolveEngineKind throw ENGINE_UNKNOWN on any
 * value outside ENGINE_KINDS. Absence of a field is the only path to defaults.
 */

import { MediationError } from "./errors.ts";

/** Canonical engine kinds (order is the registry's `kinds` order). */
export const ENGINE_KINDS = ["pi", "prime", "mock"] as const;

/** Runtime engine adapter kind (pi | prime | mock, future engines too). */
export type EngineKind = (typeof ENGINE_KINDS)[number];

/** True when value is one of the known engine kinds (type-narrowing). */
export function isEngineKind(value: unknown): value is EngineKind {
  return (
    typeof value === "string" &&
    (ENGINE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Fail-closed parse: string → EngineKind.
 * Throws MediationError("ENGINE_UNKNOWN", …) on anything else.
 */
export function asEngineKind(value: string): EngineKind {
  if (!isEngineKind(value)) {
    throw new MediationError(
      "ENGINE_UNKNOWN",
      `Unknown engine kind "${value}" (expected one of: ${ENGINE_KINDS.join(", ")})`,
      { engine: value, kinds: [...ENGINE_KINDS] },
    );
  }
  return value;
}

/**
 * Pure precedence input: override > config > defaultEngine > "pi".
 *
 * - override      per-call operator intent (CLI flag, DispatchInput,
 *                 MaterializeOptions, ReenterInput)
 * - config        effective config-layer engine (incl. definition/agent layer)
 * - defaultEngine composition fallback (createLocalMediation /
 *                 createHostedMediation / runner --default-engine)
 *
 * Each provided value is validated fail-closed (throws ENGINE_UNKNOWN for
 * kinds outside ENGINE_KINDS — e.g. deserialized workflow input).
 */
export type EngineResolutionInput = {
  readonly override?: EngineKind;
  readonly config?: EngineKind;
  readonly defaultEngine?: EngineKind;
};

/** Resolve the effective engine kind (pure; throws ENGINE_UNKNOWN on bogus). */
export function resolveEngineKind(input: EngineResolutionInput): EngineKind {
  if (input.override !== undefined) {
    return asEngineKind(input.override);
  }
  if (input.config !== undefined) {
    return asEngineKind(input.config);
  }
  if (input.defaultEngine !== undefined) {
    return asEngineKind(input.defaultEngine);
  }
  return "pi";
}
