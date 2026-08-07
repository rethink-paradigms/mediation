/**
 * Engagement signal names + wake payload (OW ↔ product control plane).
 *
 * Single source of truth so RuntimePort.sendSignal and the engagement arc
 * waitForSignal use the same address strings (Model P wake).
 *
 * Payload validation uses a Zod schema. parseWakeSignalData handles the
 * string-shorthand fallback and fail-soft empty fallback for invalid input.
 *
 * No OpenWorkflow imports — pure naming + DTO helpers.
 */

import { z } from "zod";

import type { RunId } from "../../domain/engagement.ts";
import { buildParkBridge } from "../../domain/park-bridge.ts";

/** Canonical wake kind for Model P continue-after-park. */
export const ENGAGEMENT_WAKE_KIND = "wake" as const;

/**
 * Namespaced signal address for a durable run.
 * Format: mediation:run:{runId}:{kind}
 */
export function engagementSignalName(
  runId: RunId | string,
  kind: string,
): string {
  return `mediation:run:${runId}:${kind}`;
}

/** Wake signal for a parked engagement run (LIFE-P1/P2). */
export function engagementWakeSignal(runId: RunId | string): string {
  return engagementSignalName(runId, ENGAGEMENT_WAKE_KIND);
}

// ─── Wake payload schema ───────────────────────────────────────────────────

const WakeSignalDataSchema = z.object({
  payloadText: z.string(),
  mode: z.enum(["prompt", "continue"]).default("continue"),
  parkIntent: z.boolean().optional(),
  parkReason: z.string().optional(),
});

/** Serializable payload attached to wake signals. JSON-safe. */
export type WakeSignalData = z.output<typeof WakeSignalDataSchema>;

/**
 * Normalize unknown signal data into WakeSignalData (fail soft → empty text).
 * - string → { payloadText: string, mode: "continue" }
 * - object → validated against WakeSignalDataSchema
 * - anything else → { payloadText: "", mode: "continue" }
 *
 * Arc may treat empty payload as continue with empty bridge (policy later).
 */
export function parseWakeSignalData(value: unknown): WakeSignalData {
  if (typeof value === "string") {
    return { payloadText: value, mode: "continue" };
  }
  return WakeSignalDataSchema.safeParse(value).data ?? {
    payloadText: "",
    mode: "continue",
  };
}

/**
 * Bridge semantics for a wake payload (D1/D2): the continue-bridge text
 * appended as a user message before engaging after Parked. `parkReason` is
 * the wait contract (whatWasAwaited); `wake.payloadText` is the response.
 * The Zod schema above stays the single source of truth for the payload
 * shape — this helper only maps it to bridge prose.
 */
export function wakeBridgeText(
  parkReason: string,
  wake: WakeSignalData,
): string {
  return buildParkBridge({
    whatWasAwaited: parkReason,
    payload: wake.payloadText,
  }).text;
}
