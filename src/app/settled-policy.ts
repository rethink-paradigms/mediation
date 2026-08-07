/**
 * Settled gate policy (D1 / D2).
 * True engine idle + no open wait-tool park intent → allow Settled.
 */

import type { IdleSnapshot } from "../ports/engine.ts";

export type SettledPolicyInput = {
  readonly idle: IdleSnapshot | undefined;
  /**
   * True when a standard wait tool (or equivalent) completed with park intent.
   * When true, engage must return Parked, not Settled.
   */
  readonly parkIntent?: boolean;
};

export type SettledDecision =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: string };

/**
 * Given an idle snapshot and optional park flag, decide whether Settled is allowed.
 * S2: idle present + no park flag → allow Settled.
 */
export function evaluateSettled(input: SettledPolicyInput): SettledDecision {
  if (input.parkIntent === true) {
    return { allow: false, reason: "park_intent" };
  }
  if (!input.idle || !input.idle.at) {
    return { allow: false, reason: "no_idle_snapshot" };
  }
  return { allow: true };
}

/** Convenience: idle + no park → true. */
export function maySettle(
  idle: IdleSnapshot,
  parkIntent: boolean = false,
): boolean {
  return evaluateSettled({ idle, parkIntent }).allow;
}
