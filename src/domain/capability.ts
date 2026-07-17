/**
 * Medium-independent capability identity (D5 / ABS-A1).
 * Pure domain — no FS, path, or adapter I/O.
 *
 * Identity is id (+ optional version/digest), never a filesystem path.
 * `CapabilityRef.locator` is an opaque bag for adapters only (e.g. FS may
 * put `{ path: string }` there); domain code must not require or interpret keys.
 */

/** Branded stable capability id (not a path). */
export type CapabilityId = string & { readonly __brand: "CapabilityId" };

export function asCapabilityId(value: string): CapabilityId {
  return value as CapabilityId;
}

/**
 * Kind of capability material (what it is), independent of where it lives.
 */
export type CapabilityKind =
  | "extension"
  | "skill"
  | "custom-tool"
  | "definition"
  | "pack"
  | "other";

/**
 * Medium that supplied or will supply the capability bytes.
 * FS is one origin among many — not the domain identity.
 */
export type CapabilityOrigin =
  | "fs"
  | "memory"
  | "registry"
  | "inline"
  | "composite"
  | "unknown";

/**
 * Address of a capability for resolve/snapshot (D5 L1).
 *
 * - `id` is canonical.
 * - `locator` may hold adapter-private keys (e.g. `{ path: string }` for an
 *   FS store). Domain never requires path strings as identity (D5 L4).
 */
export type CapabilityRef = {
  readonly id: CapabilityId;
  readonly kind?: CapabilityKind;
  readonly version?: string;
  readonly digest?: string;
  readonly origin: CapabilityOrigin;
  /**
   * Opaque adapter locator map. Domain does not interpret keys.
   * FS adapters may use `{ path: string }`; registry may use other keys.
   */
  readonly locator?: Readonly<Record<string, unknown>>;
};

export type CapabilityDiagnosticSeverity = "error" | "warn" | "info";

export type CapabilityDiagnostic = {
  readonly level: CapabilityDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  /** Declared id that failed to resolve, if any. */
  readonly capabilityId?: CapabilityId;
};

/**
 * Ordered resolve result for capabilities (mirrors PackLoadPlan shape).
 * Fail-closed: any diagnostic level "error" ⇒ `ok === false`.
 */
export type CapabilityPlan = {
  readonly capabilities: readonly CapabilityRef[];
  readonly diagnostics: readonly CapabilityDiagnostic[];
  /** False when any diagnostic has level "error". */
  readonly ok: boolean;
};
