/**
 * Engagement signal names + wake payload (OW ↔ product control plane).
 *
 * Single source of truth so RuntimePort.sendSignal and the engagement arc
 * waitForSignal use the same address strings (Model P wake).
 *
 * No OpenWorkflow imports — pure naming + DTO helpers.
 */

import type { RunId } from "../../domain/engagement.ts";

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

/**
 * Serializable payload attached to wake signals.
 * Keep JSON-safe; expand only with product evidence.
 */
export type WakeSignalData = {
  /** Text delivered into engage continue / next task slice. */
  readonly payloadText: string;
  /** Default continue after park (D1). */
  readonly mode?: "prompt" | "continue";
  /**
   * When true, continue leaf parks again after idle (explicit re-park).
   * Default: not set → continue path does not parkIntent.
   */
  readonly parkIntent?: boolean;
  readonly parkReason?: string;
};

export function isWakeSignalData(value: unknown): value is WakeSignalData {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.payloadText === "string";
}

/**
 * Normalize unknown signal data into WakeSignalData (fail soft → empty text).
 * Arc may treat empty payload as continue with empty bridge (policy later).
 */
export function parseWakeSignalData(value: unknown): WakeSignalData {
  if (isWakeSignalData(value)) {
    const mode: "prompt" | "continue" =
      value.mode === "prompt" || value.mode === "continue"
        ? value.mode
        : "continue";
    const out: WakeSignalData = {
      payloadText: value.payloadText,
      mode,
    };
    if (value.parkIntent === true) {
      return {
        ...out,
        parkIntent: true,
        ...(typeof value.parkReason === "string"
          ? { parkReason: value.parkReason }
          : {}),
      };
    }
    return out;
  }
  if (typeof value === "string") {
    return { payloadText: value, mode: "continue" };
  }
  return { payloadText: "", mode: "continue" };
}
