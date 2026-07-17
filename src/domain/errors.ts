/**
 * Operational error taxonomy (software-architecture §10).
 */

export type MediationErrorCode =
  | "DEFINITION_NOT_FOUND"
  | "DEFINITION_INVALID"
  | "PACK_RESOLVE_FAILED"
  | "MATERIALIZE_FAILED"
  | "ENGAGE_FAILED"
  | "PARK_CONTINUE_FAILED"
  | "RUNTIME_FAILED"
  | "JOIN_NOT_FOUND"
  | "POLICY_VIOLATION";

export class MediationError extends Error {
  readonly code: MediationErrorCode;
  readonly details?: unknown;

  constructor(
    code: MediationErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "MediationError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
