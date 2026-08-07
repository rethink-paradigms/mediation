/**
 * DOMAIN-M six operations over a CapabilityGraph (spec §4.3).
 * Pure functions — no engine, vendor, or adapter imports.
 *
 *   list      — discover capabilities (filter by category/query/domain/engine)
 *   describe  — full node + incident edges
 *   resolve   — intent text → ranked capability matches (fuzzy scoring)
 *   validate  — config → violations (unknown/out-of-domain/conflicts/deps)
 *   compose   — capability set → emergent behavior + side effects + requires
 *   explain   — config → natural-language why-choices
 */

import {
  childrenViaGeneralizes,
  findNode,
  incidentEdges,
  nodesForEngine,
  requireNode,
} from "./graph.ts";
import type {
  CapabilityConfig,
  CapabilityDomain,
  CapabilityGraph,
  CapabilityNode,
  CapabilityValue,
  ComposeResult,
  EmergentBehavior,
  ExplainResult,
  ExplainStatement,
  RequiredCapability,
  SideEffect,
  IntentMatch,
  ListFilter,
  NodeSummary,
  ResolveOptions,
  ResolveResult,
  ValidationResult,
  ValidationViolation,
} from "./types.ts";
import { intentSuggests, intentText, intentWeight } from "./types.ts";

// ---------------------------------------------------------------------------
// Text matching helpers (no dependencies — pure fuzzy scoring)
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s-]/gu, " ")
    .split(/\s+/u)
    .filter((t) => t.length > 0);
}

function tokenSet(tokens: readonly string[]): Set<string> {
  return new Set(tokens);
}

/** |intersection| / |union| over tokens. */
function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = tokenSet(a);
  const inter = b.filter((t) => setA.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

/** |intersection| / |b| — how much of the signature appears in the intent. */
function coverage(sig: readonly string[], intent: readonly string[]): number {
  if (sig.length === 0) return 0;
  const setIntent = tokenSet(intent);
  const hit = sig.filter((t) => setIntent.has(t)).length;
  return hit / sig.length;
}

/** Character bigrams of a normalized string (used by bigramDice). */
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i += 1) {
    out.add(s.slice(i, i + 2));
  }
  return out;
}

/** Dice coefficient over character bigrams (typographical similarity). */
function bigramDice(a: string, b: string): number {
  const normA = a.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
  const normB = b.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
  if (normA.length < 2 || normB.length < 2) {
    return normA === normB ? 1 : 0;
  }
  const ga = bigrams(normA);
  const gb = bigrams(normB);
  let inter = 0;
  for (const g of ga) {
    if (gb.has(g)) inter += 1;
  }
  return (2 * inter) / (ga.size + gb.size);
}

/** Similarity of an intent text against one signature phrase, in [0,1]. */
export function signatureMatchScore(intent: string, signature: string): number {
  const intentTokens = tokenize(intent);
  const sigTokens = tokenize(signature);
  const intentNorm = intentTokens.join(" ");
  const sigNorm = sigTokens.join(" ");
  if (sigNorm.length > 0 && intentNorm === sigNorm) return 1;
  if (
    sigNorm.length > 0 &&
    (intentNorm.includes(sigNorm) || sigNorm.includes(intentNorm))
  ) {
    return 0.85;
  }
  if (sigTokens.length === 0 || intentTokens.length === 0) return 0;
  const j = jaccard(sigTokens, intentTokens);
  const c = coverage(sigTokens, intentTokens);
  const d = bigramDice(intentNorm, sigNorm);
  return Math.min(1, 0.7 * j + 0.3 * c + 0.1 * d);
}

/** Score a whole node against an intent (best signature + label bonus). */
function nodeMatchScore(
  node: CapabilityNode,
  intent: string,
): { score: number; matched: string; suggests?: CapabilityValue } {
  let best = 0;
  let matched = "";
  let suggests: CapabilityValue | undefined;
  for (const sig of node.intentSignature) {
    const raw = signatureMatchScore(intent, intentText(sig));
    const score = Math.min(1, raw * intentWeight(sig));
    if (score > best) {
      best = score;
      matched = intentText(sig);
      suggests = intentSuggests(sig);
    }
  }
  // Label bonus: an intent naming the capability itself (e.g. "thinking").
  const labelScore = 0.3 * coverage(tokenize(node.label), tokenize(intent));
  const score = Math.min(1, Math.max(best, labelScore));
  if (labelScore > best) {
    matched = node.label;
    suggests = undefined;
  }
  return { score, matched, suggests };
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

/** Return capabilities, optionally filtered (spec §4.3 list). */
export function listCapabilities(
  graph: CapabilityGraph,
  filter: ListFilter,
): NodeSummary[] {
  let nodes = filter.engine
    ? nodesForEngine(graph, filter.engine)
    : [...graph.nodes];
  if (filter.category !== undefined) {
    nodes = childrenViaGeneralizes(graph, filter.category).filter((n) =>
      filter.engine === undefined ||
      n.engineScope === undefined ||
      n.engineScope.includes(filter.engine),
    );
  }
  if (filter.domainKind !== undefined) {
    nodes = nodes.filter((n) => n.domain.kind === filter.domainKind);
  }
  if (filter.query !== undefined && filter.query.trim().length > 0) {
    const q = filter.query;
    nodes = nodes.filter(
      (n) => nodeMatchScore(n, q).score > 0.05 || n.label.toLowerCase().includes(q.toLowerCase()),
    );
  }
  return nodes.map((n) => {
    const summary: NodeSummary = {
      identity: n.identity,
      label: n.label,
      description: n.description,
      domainKind: n.domain.kind,
    };
    if (n.default !== undefined) {
      return Object.assign(summary, { default: n.default });
    }
    return summary;
  });
}

// ---------------------------------------------------------------------------
// describe
// ---------------------------------------------------------------------------

/** Full node structure + all incident edges (spec §4.3 describe). */
export function describeCapability(
  graph: CapabilityGraph,
  identity: string,
): CapabilityNode & { readonly incidentEdges: NonNullable<CapabilityNode["incidentEdges"]> } {
  const node = requireNode(graph, identity);
  return { ...node, incidentEdges: incidentEdges(graph, identity) };
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

/** Map intent text to ranked capability matches (spec §4.3 resolve). */
export function resolveIntent(
  graph: CapabilityGraph,
  intent: string,
  options: ResolveOptions = {},
): ResolveResult {
  const limit = options.limit ?? 5;
  const threshold = options.threshold ?? 0;
  const scored = graph.nodes
    .map((node) => {
      const { score, matched, suggests } = nodeMatchScore(node, intent);
      return { node, score, matched, suggests };
    })
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score || a.node.identity.localeCompare(b.node.identity))
    .slice(0, limit);
  const matches: IntentMatch[] = scored.map((s) => {
    const match: IntentMatch = {
      identity: s.node.identity,
      label: s.node.label,
      score: s.score,
      matchedSignature: s.matched,
    };
    if (s.suggests !== undefined) {
      return Object.assign(match, { suggestion: s.suggests });
    }
    return match;
  });
  return { intent, matches };
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

function valuesEqual(a: CapabilityValue | undefined, b: CapabilityValue): boolean {
  if (a === undefined) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

function displayValue(value: CapabilityValue): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function domainAccepts(domain: CapabilityDomain, value: CapabilityValue): boolean {
  if (Array.isArray(value)) {
    if (domain.kind !== "enum") return domain.kind === "free";
    return value.every(
      (v) => typeof v === "string" && domain.values.some((ev) => ev.value === v),
    );
  }
  switch (domain.kind) {
    case "enum": {
      if (typeof value !== "string") return false;
      if (!domain.values.some((ev) => ev.value === value)) return false;
      if (domain.format !== undefined) {
        return new RegExp(domain.format, "u").test(value);
      }
      return true;
    }
    case "range":
      return (
        typeof value === "number" &&
        value >= domain.min &&
        value <= domain.max
      );
    case "free": {
      if (typeof value === "string" && domain.format !== undefined) {
        return new RegExp(domain.format, "u").test(value);
      }
      return true;
    }
  }
}

/**
 * Validate a proposed configuration (spec §4.3 validate):
 * unknown nodes, out-of-domain values, conflicts-with (hard), unmet
 * depends-on, and leaf/category consistency.
 */
export function validateConfig(
  graph: CapabilityGraph,
  config: CapabilityConfig,
): ValidationResult {
  const violations: ValidationViolation[] = [];
  const entries = Object.entries(config) as [
    string,
    CapabilityValue,
  ][];

  for (const [identity, value] of entries) {
    const node = findNode(graph, identity);
    if (node === undefined) {
      violations.push({
        severity: "error",
        code: "UNKNOWN_NODE",
        node: identity,
        message: `"${identity}" is not a capability in graph "${graph.metadata.name}"`,
      });
      continue;
    }
    if (!domainAccepts(node.domain, value)) {
      violations.push({
        severity: "error",
        code: "OUT_OF_DOMAIN",
        node: identity,
        message: `value ${JSON.stringify(value)} is outside the domain of "${identity}" (${node.domain.kind})`,
      });
    }
  }

  // conflicts-with — hard constraint; both endpoints present → violation.
  for (const e of graph.edges) {
    if (e.type !== "conflicts-with") continue;
    const aIn = config[e.from] !== undefined;
    const bIn = config[e.to] !== undefined;
    if (!aIn || !bIn) continue;
    if (e.condition !== undefined) {
      const cond = config[e.condition.on];
      if (!valuesEqual(cond, e.condition.value)) continue;
    }
    violations.push({
      severity: "error",
      code: "CONFLICT",
      node: e.from,
      message: `"${e.from}" (${displayValue(config[e.from] ?? "")}) conflicts-with "${e.to}": ${e.note}`,
    });
  }

  // depends-on — configured capability needs its dependency present.
  for (const e of graph.edges) {
    if (e.type !== "depends-on") continue;
    const fromIn = config[e.from] !== undefined;
    const toIn = config[e.to] !== undefined;
    if (fromIn && !toIn) {
      violations.push({
        severity: "error",
        code: "UNMET_DEPENDENCY",
        node: e.from,
        message: `"${e.from}" depends-on "${e.to}": ${e.note}`,
      });
    }
  }

  // generalizes consistency — leaf declared enabled but category omits it.
  for (const e of graph.edges) {
    if (e.type !== "generalizes") continue;
    const parentValue = config[e.from];
    const childValue = config[e.to];
    const child = findNode(graph, e.to);
    if (parentValue === undefined || childValue === undefined || child === undefined) {
      continue;
    }
    const catValue = child.categoryValue;
    if (catValue === undefined) continue;
    const childEnabled = childValue === "enabled" || childValue === true;
    if (childEnabled && Array.isArray(parentValue) && !parentValue.includes(catValue)) {
      violations.push({
        severity: "error",
        code: "INCONSISTENT",
        node: e.to,
        message: `"${e.to}" is enabled but category "${e.from}" omits "${catValue}": ${e.note}`,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// compose
// ---------------------------------------------------------------------------

/** Emergent behavior + side effects of composing capabilities (spec §4.3). */
export function composeCapabilities(
  graph: CapabilityGraph,
  ids: readonly string[],
): ComposeResult {
  const inSet = new Set(ids);
  const emergences: EmergentBehavior[] = [];
  const sideEffects: SideEffect[] = [];
  const requires: RequiredCapability[] = [];

  for (const e of graph.edges) {
    if (e.type === "composes-with") {
      if (inSet.has(e.from) && inSet.has(e.to)) {
        emergences.push({ a: e.from, b: e.to, behavior: e.note });
      }
    } else if (e.type === "affects" && inSet.has(e.from) && !inSet.has(e.to)) {
      sideEffects.push({ from: e.from, to: e.to, effect: e.note });
    } else if (e.type === "depends-on" && inSet.has(e.from) && !inSet.has(e.to)) {
      requires.push({ node: e.to, reason: e.note });
    }
  }

  const labels = ids
    .map((i) => findNode(graph, i)?.label ?? i)
    .join(", ");
  const parts: string[] = [];
  if (emergences.length > 0) {
    parts.push(
      `emergent behaviors: ${emergences.map((em) => em.behavior).join("; ")}`,
    );
  }
  if (sideEffects.length > 0) {
    parts.push(
      `side effects on: ${sideEffects.map((s) => `${s.to} (${s.effect})`).join("; ")}`,
    );
  }
  if (requires.length > 0) {
    parts.push(
      `requires: ${requires.map((r) => `${r.node} (${r.reason})`).join("; ")}`,
    );
  }
  const summary =
    parts.length > 0
      ? `Composing ${ids.length} capabilities (${labels}): ${parts.join(". ")}.`
      : `Composing ${ids.length} capabilities (${labels}) produces no documented interactions in this catalog.`;

  return { composed: [...ids], emergences, sideEffects, requires, summary };
}

// ---------------------------------------------------------------------------
// explain
// ---------------------------------------------------------------------------

/** Why-choices explanation for a configuration (spec §4.3 explain). */
export function explainConfig(
  graph: CapabilityGraph,
  config: CapabilityConfig,
): ExplainResult {
  const statements: ExplainStatement[] = [];
  const unknown: string[] = [];
  const entries = Object.entries(config) as [
    string,
    CapabilityValue,
  ][];

  for (const [identity, value] of entries) {
    const node = findNode(graph, identity);
    if (node === undefined) {
      unknown.push(identity);
      continue;
    }
    const valueLabel = displayValue(value);
    const perValue = node.effect.perValue?.find((pv) => pv.value === valueLabel);
    const effect =
      perValue?.effect ??
      (node.domain.kind === "enum"
        ? node.effect.summary
        : node.effect.summary);

    const tradeoffs: string[] = [];
    if (node.default !== undefined && !valuesEqual(value, node.default)) {
      tradeoffs.push(
        `differs from the default (${displayValue(node.default)})${node.defaultRationale !== undefined ? ` — ${node.defaultRationale}` : ""}`,
      );
    }
    const edges = incidentEdges(graph, identity);
    for (const e of edges) {
      if (e.type === "conflicts-with" && config[e.other] !== undefined) {
        tradeoffs.push(
          `conflicts with "${e.other}" when both are declared (${e.note})`,
        );
      }
      if (e.type === "depends-on" && !e.outgoing && config[e.other] === undefined) {
        tradeoffs.push(
          `"${e.other}" is required by this capability but not configured (${e.note})`,
        );
      }
    }

    const related = edges.map(
      (e) => `${e.outgoing ? "out" : "in"}:${e.type} ${e.other} — ${e.note}`,
    );

    statements.push({
      node: identity,
      label: node.label,
      value,
      effect,
      tradeoffs,
      related,
    });
  }

  const summaryParts = statements.map(
    (s) => `${s.label} = ${displayValue(s.value ?? "")} (${s.effect})`,
  );
  const summary =
    summaryParts.length > 0
      ? `Configuration explanation: ${summaryParts.join("; ")}.`
      : "Configuration explanation: no known capabilities configured.";

  return { statements, unknown, summary };
}
