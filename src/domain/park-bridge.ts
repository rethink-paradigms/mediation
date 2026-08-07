/**
 * ParkBridge — D1 §4.3 domain service (pure).
 *
 * Builds the continue bridge for Model P "continue after Parked" (D1 §3,
 * D2 tier-2 default: *Append whatWasAwaited + payload; engage continue*).
 *
 * After a full settled park (parkIntent after an assistant-final idle) the
 * engine transcript ends with role `assistant`, so Pi's loop-resume
 * `agent.continue()` is illegal. The D1 bridge makes continue legal by
 * appending the wait contract (whatWasAwaited) + the external response
 * (payload) as a user message before engaging.
 *
 * This module owns ONLY the bridge prose + shape. It never touches the
 * engine, the session, or OpenWorkflow — pure string construction so the
 * exact contract is unit-testable without any mind.
 *
 * Bridge shape (Antigravity-shaped, D2): wait contract first, response last.
 */

/** Inputs to the bridge builder (D2: whatWasAwaited + payload). */
export type ParkBridgeInput = {
  /**
   * The wait contract the engagement was parked on (park reason /
   * resumeToken semantics). May be empty when unknown — the builder then
   * falls back to neutral wait-contract prose.
   */
  readonly whatWasAwaited: string;
  /** External response / wake payload delivered at continue time. */
  readonly payload: string;
};

/** Output of the bridge builder. */
export type ParkBridgeMessage = {
  /** Full user-message text: wait contract + response (bridge). */
  readonly text: string;
};

/** Neutral wait contract used when no park reason is available. */
export const PARK_BRIDGE_DEFAULT_WAIT =
  "an external response the engagement was waiting on";

/**
 * Build the continue bridge user message for a parked engagement.
 *
 * Deterministic and pure: same inputs → same text. The payload is always
 * included verbatim as the final block so the model reads the response last.
 */
export function buildParkBridge(input: ParkBridgeInput): ParkBridgeMessage {
  const waited = input.whatWasAwaited.trim();
  const waitedFor = waited.length > 0 ? waited : PARK_BRIDGE_DEFAULT_WAIT;
  const payload = input.payload.trim();

  const lines: string[] = [
    "[mediation park bridge]",
    `This engagement was parked waiting on: ${waitedFor}.`,
  ];
  if (payload.length > 0) {
    lines.push("External response received:", payload);
  } else {
    lines.push("No new payload was delivered; resume from the wait contract.");
  }
  return { text: lines.join("\n") };
}

/**
 * True when a bridge text should be appended before the engine continue
 * verb (i.e. the engage call carries explicit bridge prose). Empty bridge →
 * bare continue (fail-closed on assistant tails, engine error surfaces).
 */
export function hasParkBridge(text?: string): boolean {
  return typeof text === "string" && text.trim().length > 0;
}
