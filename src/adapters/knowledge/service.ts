/**
 * KnowledgeService — KnowledgePort adapter over the pure domain operations.
 * No engine imports: the catalog is pure data built from engine knowledge
 * (src/adapters/knowledge/catalog.ts), and all operations are pure functions
 * in src/domain/knowledge/operations.ts.
 */

import { DEFAULT_CATALOG } from "./catalog.ts";
import {
  composeCapabilities,
  describeCapability,
  explainConfig,
  listCapabilities,
  resolveIntent,
  validateConfig,
} from "../../domain/knowledge/operations.ts";
import { findNode } from "../../domain/knowledge/graph.ts";
import type { AgentRef } from "../../domain/definition.ts";
import type {
  CapabilityConfig,
  CapabilityGraph,
  ComposeResult,
  ExplainResult,
  ListFilter,
  NodeSummary,
  ResolveOptions,
  ResolveResult,
  ValidationResult,
} from "../../domain/knowledge/types.ts";
import type {
  KnowledgePort,
  NodeDescription,
} from "../../ports/knowledge.ts";

/** KnowledgePort implementation over a supplied (or default) catalog. */
export class KnowledgeService implements KnowledgePort {
  private readonly graph: CapabilityGraph;
  /**
   * Optional catalog→agent mapping layer (phase 2 seam): capability identity
   * → AgentRef. Consulted after the node's own `agentRef` field; either side
   * bridges the pure capability graph into the pack/definition world.
   */
  private readonly agentRefs: Readonly<Record<string, AgentRef>>;

  constructor(
    graph: CapabilityGraph = DEFAULT_CATALOG,
    agentRefs: Readonly<Record<string, AgentRef>> = {},
  ) {
    this.graph = graph;
    this.agentRefs = agentRefs;
  }

  async loadGraph(): Promise<CapabilityGraph> {
    return this.graph;
  }

  async list(filter: ListFilter = {}): Promise<NodeSummary[]> {
    return listCapabilities(this.graph, filter);
  }

  async describe(identity: string): Promise<NodeDescription> {
    return describeCapability(this.graph, identity);
  }

  async resolve(intent: string, options?: ResolveOptions): Promise<ResolveResult> {
    return resolveIntent(this.graph, intent, options);
  }

  async validate(config: CapabilityConfig): Promise<ValidationResult> {
    return validateConfig(this.graph, config);
  }

  async compose(ids: readonly string[]): Promise<ComposeResult> {
    return composeCapabilities(this.graph, ids);
  }

  async explain(config: CapabilityConfig): Promise<ExplainResult> {
    return explainConfig(this.graph, config);
  }

  /**
   * Catalog→agent bridge: node-declared `agentRef` wins, then the runtime
   * mapping injected at construction. Undefined when neither side maps the
   * capability (DEFAULT_CATALOG is pure capability data — no agent nodes).
   */
  async agentFor(identity: string): Promise<AgentRef | undefined> {
    const node = findNode(this.graph, identity);
    if (node?.agentRef !== undefined) return node.agentRef;
    return this.agentRefs[identity];
  }
}

/** Convenience factory over the default (Pi) catalog. */
export function createKnowledgeService(
  graph: CapabilityGraph = DEFAULT_CATALOG,
  agentRefs?: Readonly<Record<string, AgentRef>>,
): KnowledgePort {
  return new KnowledgeService(graph, agentRefs);
}
