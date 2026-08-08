/**
 * DOMAIN-M graph construction + navigation helpers (pure).
 * Single source of truth for edges is `graph.edges`; incident edges are
 * derived here (never stored redundantly on nodes).
 */

import type {
  CapabilityEdge,
  CapabilityGraph,
  CapabilityIdentity,
  CapabilityNode,
  GraphMetadata,
  IncidentEdge,
} from "./types.ts";
import { asCapabilityIdentity, isCapabilityIdentity } from "./types.ts";

/** Unknown capability error (typed, code "KNOWLEDGE_UNKNOWN_NODE"). */
export class UnknownCapabilityError extends Error {
  readonly code = "KNOWLEDGE_UNKNOWN_NODE" as const;
  constructor(identity: string) {
    super(`Unknown capability node "${identity}"`);
    this.name = "UnknownCapabilityError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type GraphBuildError = {
  readonly message: string;
};

/**
 * Build a CapabilityGraph from node/edge lists, validating integrity:
 * unique ids, well-formed identities, edge endpoints exist, no duplicate
 * edges. Throws on invalid input (catalog authors get hard feedback).
 */
export function createGraph(
  metadata: GraphMetadata,
  nodes: readonly CapabilityNode[],
  edges: readonly CapabilityEdge[],
): CapabilityGraph {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    const identity = n.identity;
    if (!isCapabilityIdentity(identity)) {
      errors.push(`node identity is not a valid id: "${identity}"`);
    }
    if (seen.has(identity)) {
      errors.push(`duplicate node identity: "${identity}"`);
    }
    seen.add(identity);
    if (n.intentSignature.length === 0) {
      errors.push(`node "${identity}" has no intent signatures`);
    }
    if (n.domain.kind === "enum" && n.domain.values.length === 0) {
      errors.push(`node "${identity}" has an empty enum domain`);
    }
  }
  const edgeKeys = new Set<string>();
  for (const e of edges) {
    if (!seen.has(e.from)) {
      errors.push(`edge ${e.type} from unknown node "${e.from}"`);
    }
    if (!seen.has(e.to)) {
      errors.push(`edge ${e.type} to unknown node "${e.to}"`);
    }
    if (e.from === e.to) {
      errors.push(`self edge on "${e.from}"`);
    }
    const key = `${e.type}|${e.from}|${e.to}`;
    if (edgeKeys.has(key)) {
      errors.push(`duplicate edge ${key}`);
    }
    edgeKeys.add(key);
  }
  if (errors.length > 0) {
    throw new Error(`invalid capability graph:\n${errors.join("\n")}`);
  }
  return { metadata, nodes: [...nodes], edges: [...edges] };
}

/** Find a node by identity; undefined when absent. */
export function findNode(
  graph: CapabilityGraph,
  identity: string,
): CapabilityNode | undefined {
  return graph.nodes.find((n) => n.identity === identity);
}

/** Find a node by identity; throws UnknownCapabilityError when absent. */
export function requireNode(
  graph: CapabilityGraph,
  identity: string,
): CapabilityNode {
  const node = findNode(graph, identity);
  if (node === undefined) {
    throw new UnknownCapabilityError(identity);
  }
  return node;
}

/** All edges touching a node (either direction), as IncidentEdge views. */
export function incidentEdges(
  graph: CapabilityGraph,
  identity: string,
): IncidentEdge[] {
  const out: IncidentEdge[] = [];
  for (const e of graph.edges) {
    if (e.from === identity) {
      out.push({
        type: e.type,
        other: e.to,
        outgoing: true,
        note: e.note,
        ...(e.condition !== undefined ? { condition: e.condition } : {}),
      });
    } else if (e.to === identity) {
      out.push({
        type: e.type,
        other: e.from,
        outgoing: false,
        note: e.note,
        ...(e.condition !== undefined ? { condition: e.condition } : {}),
      });
    }
  }
  return out;
}

/** Direct children of a category node via generalizes edges. */
export function childrenViaGeneralizes(
  graph: CapabilityGraph,
  identity: string,
): CapabilityNode[] {
  const children: CapabilityNode[] = [];
  for (const e of graph.edges) {
    if (e.type === "generalizes" && e.from === identity) {
      const child = findNode(graph, e.to);
      if (child !== undefined) children.push(child);
    }
  }
  return children;
}

/** Edges of one type from a node (outgoing). */
export function outgoingEdges(
  graph: CapabilityGraph,
  identity: string,
  type: CapabilityEdge["type"],
): CapabilityEdge[] {
  return graph.edges.filter((e) => e.type === type && e.from === identity);
}

/** Nodes representable on an engine (engineScope absent or includes it). */
export function nodesForEngine(
  graph: CapabilityGraph,
  engine: NonNullable<GraphMetadata["engine"]>,
): CapabilityNode[] {
  return graph.nodes.filter(
    (n) => n.engineScope === undefined || n.engineScope.includes(engine),
  );
}

/** Convenience: brand an id for tests/catalogs. */
export function id(value: string): CapabilityIdentity {
  return asCapabilityIdentity(value);
}
