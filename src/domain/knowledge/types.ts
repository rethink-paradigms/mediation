/**
 * DOMAIN-M knowledge model — pure types (issue #2 first pour).
 *
 * Spec: research/agent-configuration-knowledge-model/understanding/
 *       mediation-layer-concept.md (§4 structure: nodes, edges, operations)
 * Source: understanding/pi-sdk-feature-map.md (Pi features → M nodes)
 * Law: D5 — capability identity is a stable id, never a filesystem path.
 *
 * Medium-independent: this module imports no engine, vendor, or adapter
 * code. `EngineKind` comes from the pure domain (src/domain/engine.ts) and
 * is used only as a scoping marker on nodes/graph metadata.
 */

import type { EngineKind } from "../engine.ts";
import type { AgentRef } from "../definition.ts";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** Stable capability identity (D5 L1). Ids, never paths. */
export type CapabilityIdentity = string & { readonly __brand: "CapabilityIdentity" };

/** Brand a plain string as a capability identity (ids are canonical). */
export function asCapabilityIdentity(value: string): CapabilityIdentity {
  return value as CapabilityIdentity;
}

/** Allowed identity shape: `m.<segment>(.<segment>)*` — hyphens ok, no slashes/paths (D5). */
export const CAPABILITY_IDENTITY_PATTERN = /^m\.[a-z0-9-]+(\.[a-z0-9-]+)*$/u;

/** True when `value` is a valid capability identity (medium-independent, D5). */
export function isCapabilityIdentity(value: string): boolean {
  return CAPABILITY_IDENTITY_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Values & domains
// ---------------------------------------------------------------------------

/** A configurable value for a capability node. */
export type CapabilityValue = string | number | boolean | readonly string[];

/** One enumerated value with its own description (spec §4.1). */
export type EnumValue = {
  readonly value: string;
  readonly description: string;
};

/**
 * Typed, bounded domain of a capability (spec §4.1):
 * - enum: each value has its own description
 * - range: boundary values defined
 * - free: format + constraints specified
 */
export type CapabilityDomain =
  | {
      readonly kind: "enum";
      readonly values: readonly EnumValue[];
      /** Optional regex the value must match (checked by validate). */
      readonly format?: string;
    }
  | {
      readonly kind: "range";
      readonly min: number;
      readonly max: number;
      readonly step?: number;
      readonly unit?: string;
    }
  | {
      readonly kind: "free";
      /** Optional regex the value must match (checked by validate). */
      readonly format?: string;
      /** Human-readable constraints (informational). */
      readonly constraints?: readonly string[];
    };

// ---------------------------------------------------------------------------
// Intent signatures
// ---------------------------------------------------------------------------

/**
 * One intent pattern. String shorthand == { text } with default weight.
 * `suggests` is the value resolve() recommends when this signature matches
 * (e.g. "make it more careful" → suggests "high" for m.thinking).
 */
export type IntentSignature =
  | string
  | {
      readonly text: string;
      readonly weight?: number;
      readonly suggests?: CapabilityValue;
    };

export function intentText(sig: IntentSignature): string {
  return typeof sig === "string" ? sig : sig.text;
}

export function intentWeight(sig: IntentSignature): number {
  return typeof sig === "string" ? 1 : (sig.weight ?? 1);
}

export function intentSuggests(sig: IntentSignature): CapabilityValue | undefined {
  return typeof sig === "string" ? undefined : sig.suggests;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/**
 * A configurable dimension of the engine — a parameter, mode, flag, or
 * resource (spec §4.1). `incidentEdges` is optional on the source node and
 * is DERIVED from the graph's edge list by describe/read paths — the edge
 * array is the single source of truth so catalogs cannot drift.
 */
export type CapabilityNode = {
  readonly identity: CapabilityIdentity;
  /** Human- and agent-readable name in the conceptual domain. */
  readonly label: string;
  /** Functional description — what behavior it controls, not implementation. */
  readonly description: string;
  /** Typed, bounded set of valid values. */
  readonly domain: CapabilityDomain;
  /** Value used when no explicit configuration is given, + rationale. */
  readonly default?: CapabilityValue;
  readonly defaultRationale?: string;
  /** What changes in engine behavior when this capability is set. */
  readonly effect: {
    readonly summary: string;
    /** Per-value behavioral characterization (enum domains). */
    readonly perValue?: readonly { readonly value: string; readonly effect: string }[];
  };
  /** Natural-language intent patterns that route to this capability. */
  readonly intentSignature: readonly IntentSignature[];
  /**
   * When this node is a member of a category (via a generalizes edge), the
   * value it contributes to the category's config (e.g. leaf tool "read"
   * inside category m.tools whose config value is an array of tool names).
   */
  readonly categoryValue?: string;
  /**
   * Engines this node is accurately representable on. Absent == all engines.
   * Markers are pure domain values ("pi" | "prime" | "mock"); they describe
   * the catalog, they do not import engine code.
   */
  readonly engineScope?: readonly EngineKind[];
  /**
   * Optional bridge to the pack/definition world (phase 2 seam): when this
   * capability node corresponds to a concrete agent (e.g. a "web researcher"
   * agent), this is the AgentRef the DefinitionLoader can resolve — so a
   * surface can go resolveIntent → agent → engage. Pure-domain (D5): a ref,
   * never a path-based identity. Catalog authors opt in; absent == no mapping.
   */
  readonly agentRef?: AgentRef;
  /** Optional derived incident edges (see type comment above). */
  readonly incidentEdges?: readonly IncidentEdge[];
};

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

export type EdgeType =
  | "depends-on"
  | "affects"
  | "conflicts-with"
  | "composes-with"
  | "generalizes";

/**
 * Value-level condition on an edge. When present, the edge only applies if
 * the node named by `on` has the configured value `value`.
 * (e.g. notools="all" conflicts-with extensions: only when all tools off.)
 */
export type EdgeCondition = {
  /** Identity string of the node whose configured value gates the edge. */
  readonly on: string;
  readonly value: CapabilityValue;
};

/** Typed relationship between two capabilities (spec §4.2). */
export type CapabilityEdge = {
  readonly type: EdgeType;
  readonly from: CapabilityIdentity;
  readonly to: CapabilityIdentity;
  /** Human-readable semantics of the relationship (what, why). */
  readonly note: string;
  /** Optional value-level condition (see EdgeCondition). */
  readonly condition?: EdgeCondition;
};

/** Edge as seen from one endpoint in describe() output. */
export type IncidentEdge = {
  readonly type: EdgeType;
  readonly other: CapabilityIdentity;
  /** True when this node is the edge's `from` endpoint. */
  readonly outgoing: boolean;
  readonly note: string;
  readonly condition?: EdgeCondition;
};

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export type GraphMetadata = {
  readonly name: string;
  readonly version: string;
  /** Default engine scope of this catalog (pi | prime | mock). */
  readonly engine?: EngineKind;
  /** Provenance — where the catalog content came from. */
  readonly source: string;
};

/** The mediation layer's capability surface: a traversable typed graph. */
export type CapabilityGraph = {
  readonly metadata: GraphMetadata;
  readonly nodes: readonly CapabilityNode[];
  readonly edges: readonly CapabilityEdge[];
};

// ---------------------------------------------------------------------------
// Operations — inputs / outputs (spec §4.3)
// ---------------------------------------------------------------------------

/**
 * Proposed configuration: capability identity string → value.
 * Keys are plain identity strings (validated against the graph); the brand
 * is reserved for graph construction, where catalogs are built carefully.
 */
export type CapabilityConfig = Readonly<Record<string, CapabilityValue>>;

export type ListFilter = {
  /** Only direct children of this category node (via generalizes edges). */
  readonly category?: string;
  /** Free-text match over label, description, and intent signatures. */
  readonly query?: string;
  readonly domainKind?: CapabilityDomain["kind"];
  /** Restrict to nodes representable on this engine. */
  readonly engine?: EngineKind;
};

export type NodeSummary = {
  readonly identity: string;
  readonly label: string;
  readonly description: string;
  readonly domainKind: CapabilityDomain["kind"];
  readonly default?: CapabilityValue;
};

export type IntentMatch = {
  readonly identity: string;
  readonly label: string;
  /** Relevance in [0,1]; 1 = exact intent-signature match. */
  readonly score: number;
  /** The signature text that produced the match. */
  readonly matchedSignature: string;
  /** Recommended value when the matched signature suggests one. */
  readonly suggestion?: CapabilityValue;
};

export type ResolveOptions = {
  readonly limit?: number;
  /** Minimum score to include (default 0). */
  readonly threshold?: number;
};

export type ResolveResult = {
  readonly intent: string;
  readonly matches: readonly IntentMatch[];
};

export type ViolationSeverity = "error" | "warn";

export type ValidationViolation = {
  readonly severity: ViolationSeverity;
  readonly code: "UNKNOWN_NODE" | "OUT_OF_DOMAIN" | "CONFLICT" | "UNMET_DEPENDENCY" | "INCONSISTENT";
  readonly node: string;
  readonly message: string;
};

export type ValidationResult = {
  readonly ok: boolean;
  readonly violations: readonly ValidationViolation[];
};

export type EmergentBehavior = {
  readonly a: string;
  readonly b: string;
  readonly behavior: string;
};

export type SideEffect = {
  readonly from: string;
  readonly to: string;
  readonly effect: string;
};

export type RequiredCapability = {
  readonly node: string;
  readonly reason: string;
};

export type ComposeResult = {
  readonly composed: readonly string[];
  /** Behaviors no single capability produces alone. */
  readonly emergences: readonly EmergentBehavior[];
  /** Affects edges to capabilities NOT in the composed set. */
  readonly sideEffects: readonly SideEffect[];
  /** Depends-on edges to capabilities NOT in the composed set. */
  readonly requires: readonly RequiredCapability[];
  readonly summary: string;
};

export type ExplainStatement = {
  readonly node: string;
  readonly label: string;
  readonly value?: CapabilityValue;
  readonly effect: string;
  readonly tradeoffs: readonly string[];
  readonly related: readonly string[];
};

export type ExplainResult = {
  readonly statements: readonly ExplainStatement[];
  /** Config entries that are not known capabilities. */
  readonly unknown: readonly string[];
  readonly summary: string;
};
