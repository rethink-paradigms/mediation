/**
 * Pack resolution plan / snapshot types.
 * Pure domain — PackResolverImpl lives in adapters (S1).
 */

/** Where a pack was found in the ordered search. */
export type PackSource =
  | "explicit"
  | "internal"
  | "project-extensions"
  | "agent"
  | "families"
  | "global-pi";

export type PackRef = {
  readonly id: string;
  readonly path: string;
  readonly source: PackSource;
};

/**
 * Diagnostic severity (D2 fail-closed uses level "error").
 * Alias `severity` is not used — S1/D2 contract names the field `level`.
 */
export type PackDiagnosticSeverity = "error" | "warn" | "info";

export type PackDiagnostic = {
  readonly level: PackDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  /** Declared name that failed to resolve, if any. */
  readonly packName?: string;
};

/**
 * Ordered resolve result.
 * D2: missing hard pack → level "error"; `ok === false` (fail-closed).
 */
export type PackLoadPlan = {
  readonly packs: readonly PackRef[];
  readonly diagnostics: readonly PackDiagnostic[];
  /** False when any diagnostic has level "error". */
  readonly ok: boolean;
};

/**
 * Frozen pack set recorded at materialize (D1 packSnapshot).
 */
export type PackSnapshot = {
  readonly planHash: string;
  readonly packs: readonly PackRef[];
  readonly createdAt: string;
};
