/**
 * OutcomeMapper — engine errors / idle / partial → RunOutcome (Settled | Parked | Failed).
 *
 * software-architecture §4.3 lists OutcomeMapper as a domain service:
 * "Engine errors / idle → RunOutcome". It lives in the app layer (like its
 * sibling SettledPolicy in settled-policy.ts) because it consumes IdleSnapshot
 * (ports/engine.ts) and RunOutcome (domain/presence.ts) — the same reason the
 * doc's "domain services" that touch port types are implemented here.
 *
 * Before this module, every caller that turned an engine error or an idle
 * snapshot into a RunOutcome did so inline (presence engage catch / policy
 * denial, mediation pack-mismatch, openworkflow leaf fail-closed paths), which
 * let error-code taxonomy drift between call sites. This module is the single
 * normalization point:
 *
 *   outcomeFromError — any thrown value → Failed (message extraction, code
 *     precedence: explicit code > error.code > fallbackCode > ENGAGE_FAILED,
 *     optional cause preservation for in-process callers).
 *   outcomeFromIdle  — engine idle + park intent → Settled | Parked | Failed
 *     (policy denial), delegating the allow/deny decision to SettledPolicy.
 *
 * Pure: no I/O, no engine imports, deterministic except the default parked
 * resumeToken timestamp (injectable for tests).
 */

import type { RunOutcome, SessionRef } from "../domain/presence.ts";
import type { IdleSnapshot } from "../ports/engine.ts";
import { evaluateSettled } from "./settled-policy.ts";

/** Default code when nothing else provides one (matches presence engage catch). */
export const OUTCOME_DEFAULT_CODE = "ENGAGE_FAILED" as const;

/** The Failed variant of RunOutcome — what outcomeFromError always returns. */
export type FailedRunOutcome = Extract<RunOutcome, { readonly kind: "failed" }>;

/** Failed error envelope shape (message + optional code/cause). */
export type FailedErrorEnvelope = FailedRunOutcome["error"];

export type OutcomeFailureInput = {
  readonly sessionRef?: SessionRef;
  /** Any thrown value: Error, string, object, unknown. */
  readonly error: unknown;
  /**
   * Explicit code — always wins over error.code and fallbackCode
   * (e.g. POLICY_VIOLATION, JOIN_NOT_FOUND, PACK_SNAPSHOT_MISMATCH).
   */
  readonly code?: string;
  /** Fallback when the error carries no usable code (default ENGAGE_FAILED). */
  readonly fallbackCode?: string;
  /**
   * Preserve the raw error as Failed.error.cause (default false). In-process
   * callers (presence catch) keep the cause for diagnostics; serializable
   * callers (openworkflow leaf) leave it off so the workflow output stays
   * JSON-safe.
   */
  readonly withCause?: boolean;
};

export type OutcomeFromIdleInput = {
  readonly sessionRef: SessionRef;
  /** Engine idle snapshot; undefined → policy denial (no_idle_snapshot). */
  readonly idle: IdleSnapshot | undefined;
  /** True when the wait-tool park completed with park intent → Parked. */
  readonly parkIntent?: boolean;
  /** Human-readable park reason (default park_intent). */
  readonly parkReason?: string;
  /** Parked payload text (echoed from the engage input). */
  readonly text?: string;
  readonly mode?: "prompt" | "continue";
  /**
   * Injected resume token; default `park:<sessionRef>:<Date.now base36>`
   * (same shape presence built inline pre-mapper).
   */
  readonly resumeToken?: string;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    error !== null &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { readonly message?: unknown }).message === "string"
  ) {
    return (error as { readonly message: string }).message;
  }
  return String(error);
}

function errorCode(error: unknown): string | undefined {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { readonly code?: unknown }).code === "string"
  ) {
    return (error as { readonly code: string }).code;
  }
  return undefined;
}

/** Build the Failed error envelope (message + code, optional cause). */
function failedErrorEnvelope(input: OutcomeFailureInput): FailedErrorEnvelope {
  const code =
    input.code ??
    errorCode(input.error) ??
    input.fallbackCode ??
    OUTCOME_DEFAULT_CODE;
  return {
    message: errorMessage(input.error),
    code,
    ...(input.withCause === true && input.error !== undefined
      ? { cause: input.error }
      : {}),
  };
}

/**
 * Map any thrown/engine value into a Failed RunOutcome.
 * sessionRef is only attached when provided (shape parity with inline sites).
 */
export function outcomeFromError(
  input: OutcomeFailureInput,
): FailedRunOutcome {
  const error = failedErrorEnvelope(input);
  if (input.sessionRef !== undefined) {
    return { kind: "failed", sessionRef: input.sessionRef, error };
  }
  return { kind: "failed", error };
}

/**
 * Map engine idle (+ optional park intent) into Settled | Parked | Failed.
 * The allow/deny decision is SettledPolicy's; this module only turns the
 * decision into the RunOutcome shape (and owns the parked payload/resumeToken).
 */
export function outcomeFromIdle(input: OutcomeFromIdleInput): RunOutcome {
  const decision = evaluateSettled({
    idle: input.idle,
    parkIntent: input.parkIntent,
  });

  if (!decision.allow) {
    if (decision.reason === "park_intent") {
      return {
        kind: "parked",
        sessionRef: input.sessionRef,
        reason: input.parkReason ?? "park_intent",
        resumeToken:
          input.resumeToken ??
          `park:${input.sessionRef}:${Date.now().toString(36)}`,
        payload: { text: input.text, mode: input.mode ?? "prompt" },
      };
    }
    return {
      kind: "failed",
      sessionRef: input.sessionRef,
      error: {
        message: `Settled policy denied: ${decision.reason}`,
        code: "POLICY_VIOLATION",
      },
    };
  }

  return { kind: "settled", sessionRef: input.sessionRef };
}
