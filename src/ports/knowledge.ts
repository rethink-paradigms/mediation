/**
 * KnowledgePort — queryable face over the Domain M capability graph.
 * App/surfaces use this interface; the graph + operations live in the pure
 * domain (src/domain/knowledge). Medium-independent (D5): identities are
 * capability ids, never paths.
 */

import type { CapabilityGraph } from "../domain/knowledge/types.ts";
import type {
  CapabilityConfig,
  ComposeResult,
  ExplainResult,
  ListFilter,
  NodeSummary,
  ResolveOptions,
  ResolveResult,
  ValidationResult,
} from "../domain/knowledge/types.ts";

/** Full node structure with incident edges (describe result). */
export type NodeDescription = CapabilityGraph["nodes"][number] & {
  readonly incidentEdges: NonNullable<CapabilityGraph["nodes"][number]["incidentEdges"]>;
};

/**
 * The six operations of the mediation layer (spec §4.3) behind one port:
 *   loadGraph, list, describe, resolve, validate, compose, explain
 * Implementations are thin adapters over the pure domain operations.
 */
export interface KnowledgePort {
  /** Load the capability graph this port serves. */
  loadGraph(): Promise<CapabilityGraph>;
  /** list — discover capabilities, filtered. */
  list(filter?: ListFilter): Promise<NodeSummary[]>;
  /** describe — full node + all incident edges. */
  describe(identity: string): Promise<NodeDescription>;
  /** resolve — intent text → ranked capability matches. */
  resolve(intent: string, options?: ResolveOptions): Promise<ResolveResult>;
  /** validate — config → violations (domain/conflicts/dependencies). */
  validate(config: CapabilityConfig): Promise<ValidationResult>;
  /** compose — capability set → emergent behavior + side effects. */
  compose(ids: readonly string[]): Promise<ComposeResult>;
  /** explain — config → natural-language why-choices. */
  explain(config: CapabilityConfig): Promise<ExplainResult>;
}
