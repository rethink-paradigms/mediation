/**
 * DOMAIN-M first pour — SCENARIO SUITE (written BEFORE implementation per
 * TESTING-DOCTRINE.md: intent first, scenario first).
 *
 * Scenarios come from the mediation-layer design intent
 * (research/agent-configuration-knowledge-model/understanding/
 * mediation-layer-concept.md §4.3 operations + pi-sdk-feature-map.md):
 *   - resolve maps natural-language intent to capability nodes
 *   - validate enforces domain/conflict/dependency rules
 *   - compose documents emergent behavior + side effects
 *   - explain produces coherent why-choices text
 *   - the graph is medium-independent (identities are ids, never paths, D5)
 *
 * These tests were run against a missing module first (red), then the
 * implementation was built to make them pass (green). No scenario was
 * weakened or deleted to reach green.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPiCatalog } from "../../src/adapters/knowledge/catalog.ts";
import {
  composeCapabilities,
  describeCapability,
  explainConfig,
  listCapabilities,
  resolveIntent,
  validateConfig,
} from "../../src/domain/knowledge/operations.ts";
import type {
  CapabilityConfig,
  CapabilityIdentity,
} from "../../src/domain/knowledge/types.ts";

const graph = buildPiCatalog();

// ---------------------------------------------------------------------------
// RESOLVE — intent → ranked capability matches
// ---------------------------------------------------------------------------

describe("DOMAIN-M resolve scenarios", () => {
  it("resolve('make it more careful') ranks thinking first with a high/medium suggestion", () => {
    const result = resolveIntent(graph, "make it more careful");
    assert.ok(result.matches.length > 0, "expected at least one match");
    const top = result.matches[0];
    assert.ok(top !== undefined, "top match must exist");
    assert.equal(top.identity, "m.thinking");
    assert.ok(
      top.suggestion === "high" || top.suggestion === "medium",
      `expected high or medium suggestion, got ${top.suggestion}`,
    );
    assert.ok(top.score > 0.5, `expected a meaningful score, got ${top.score}`);
    // thinking:off must NOT be what a careful-reasoning intent routes to.
    assert.notEqual(top.suggestion, "off");
  });

  it("resolve('reason deeper') also ranks thinking first", () => {
    const result = resolveIntent(graph, "reason deeper");
    assert.equal(result.matches[0]?.identity, "m.thinking");
    assert.ok((result.matches[0]?.score ?? 0) > 0.5);
  });

  it("resolve('let it read files') ranks the read tool first", () => {
    const result = resolveIntent(graph, "let it read files");
    assert.equal(result.matches[0]?.identity, "m.tools.read");
  });

  it("resolve('run a command in the terminal') ranks bash first", () => {
    const result = resolveIntent(graph, "run a command in the terminal");
    assert.equal(result.matches[0]?.identity, "m.tools.bash");
  });

  it("resolve('write a new file') ranks write first", () => {
    const result = resolveIntent(graph, "write a new file");
    assert.equal(result.matches[0]?.identity, "m.tools.write");
  });

  it("resolve('find where this symbol is used') ranks grep first", () => {
    const result = resolveIntent(graph, "find where this symbol is used");
    assert.equal(result.matches[0]?.identity, "m.tools.grep");
  });

  it("resolve('edit this file') ranks edit before write", () => {
    const result = resolveIntent(graph, "edit this file");
    const top = result.matches[0]?.identity;
    assert.equal(top, "m.tools.edit");
  });

  it("resolve('add a skill') ranks skills first", () => {
    const result = resolveIntent(graph, "add a skill");
    assert.equal(result.matches[0]?.identity, "m.skills");
  });

  it("resolve('install an extension pack') ranks extensions first", () => {
    const result = resolveIntent(graph, "install an extension pack");
    assert.equal(result.matches[0]?.identity, "m.extensions");
  });

  it("resolve('keep it quick') suggests low thinking (faster)", () => {
    const result = resolveIntent(graph, "keep it quick");
    const thinking = result.matches.find((m) => m.identity === "m.thinking");
    assert.ok(thinking, "expected m.thinking among matches");
    assert.equal(thinking.suggestion, "low");
  });

  it("resolve returns ranked matches with scores in [0,1] and matched signature text", () => {
    const result = resolveIntent(graph, "make it more careful");
    assert.ok(result.matches.length >= 1);
    for (const m of result.matches) {
      assert.ok(m.score >= 0 && m.score <= 1, `score out of range: ${m.score}`);
      assert.ok(m.matchedSignature.length > 0, "expected matched signature text");
      assert.ok(m.identity.length > 0);
    }
    // ranking is descending
    for (let i = 1; i < result.matches.length; i += 1) {
      const prev = result.matches[i - 1];
      const cur = result.matches[i];
      if (prev === undefined || cur === undefined) break;
      assert.ok(prev.score >= cur.score, "matches must be ranked descending");
    }
  });

  it("resolve is deterministic (same input, same ranking)", () => {
    const a = resolveIntent(graph, "make it more careful");
    const b = resolveIntent(graph, "make it more careful");
    assert.deepEqual(a, b);
  });

  it("resolve('switch to a different model') ranks model first", () => {
    const result = resolveIntent(graph, "switch to a different model");
    assert.equal(result.matches[0]?.identity, "m.model");
  });

  it("resolve('stop it from overflowing context') ranks compaction", () => {
    const result = resolveIntent(graph, "stop it from overflowing context");
    assert.equal(result.matches[0]?.identity, "m.compaction");
  });

  it("resolve respects a limit option", () => {
    const result = resolveIntent(graph, "make it more careful", { limit: 2 });
    assert.ok(result.matches.length <= 2);
  });
});

// ---------------------------------------------------------------------------
// VALIDATE — domain / conflicts / dependencies
// ---------------------------------------------------------------------------

describe("DOMAIN-M validate scenarios", () => {
  it("validate rejects an unknown capability node", () => {
    const result = validateConfig(graph, { "m.no.such.node": "x" });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.code === "UNKNOWN_NODE"));
  });

  it("validate rejects an out-of-domain thinking value", () => {
    const result = validateConfig(graph, { "m.thinking": "turbo" });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.code === "OUT_OF_DOMAIN"));
  });

  it("validate accepts every real thinking level (fidelity: off..max)", () => {
    for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
      const result = validateConfig(graph, { "m.thinking": level });
      assert.equal(result.ok, true, `expected ${level} to be valid: ${JSON.stringify(result.violations)}`);
    }
  });

  it("validate rejects a malformed model id (missing provider slash)", () => {
    const result = validateConfig(graph, { "m.model": "no-slash-here" });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.code === "OUT_OF_DOMAIN"));
  });

  it("validate rejects tool allowlist + denylist together (real Pi conflict)", () => {
    const result = validateConfig(graph, {
      "m.tools": ["read", "bash"],
      "m.tools.denylist": ["bash"],
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.code === "CONFLICT"));
  });

  it("validate rejects notools-all together with an allowlist (hard conflict)", () => {
    const result = validateConfig(graph, {
      "m.tools.notools": "all",
      "m.tools": ["read"],
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.code === "CONFLICT"));
  });

  it("validate rejects notools-all together with a denylist", () => {
    const result = validateConfig(graph, {
      "m.tools.notools": "all",
      "m.tools.denylist": ["bash"],
    });
    assert.equal(result.ok, false);
  });

  it("validate rejects thinking:off combined with a contradictory tool policy (conflict machinery on real pair)", () => {
    // thinking:off alone is a valid engine level; combining it with an
    // internally-contradictory tool policy must still be rejected.
    const result = validateConfig(graph, {
      "m.thinking": "off",
      "m.tools": ["read", "bash"],
      "m.tools.denylist": ["bash"],
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.code === "CONFLICT"));
  });

  it("validate reports unmet depends-on (leaf tool without its category)", () => {
    const result = validateConfig(graph, { "m.tools.read": "enabled" });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.code === "UNMET_DEPENDENCY"));
  });

  it("validate reports unmet depends-on (context files need a working directory)", () => {
    const result = validateConfig(graph, { "m.context-files": "enabled" });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.code === "UNMET_DEPENDENCY"));
  });

  it("validate reports inconsistent leaf-vs-category tool declarations", () => {
    const result = validateConfig(graph, {
      "m.tools": ["bash"],
      "m.tools.read": "enabled",
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((v) => v.code === "INCONSISTENT"));
  });

  it("validate accepts a coherent realistic config", () => {
    const config: CapabilityConfig = {
      "m.model": "anthropic/claude-sonnet-4",
      "m.thinking": "high",
      "m.tools": ["read", "bash", "grep"],
      "m.session.cwd": "/work/project",
    };
    const result = validateConfig(graph, config);
    assert.equal(result.ok, true, JSON.stringify(result.violations));
  });

  it("validate accepts a leaf tool declared consistently with its category", () => {
    const config: CapabilityConfig = {
      "m.tools": ["read"],
      "m.tools.read": "enabled",
    };
    const result = validateConfig(graph, config);
    assert.equal(result.ok, true, JSON.stringify(result.violations));
  });

  it("validate accepts empty config (all defaults valid)", () => {
    const result = validateConfig(graph, {});
    assert.equal(result.ok, true);
  });
});

// ---------------------------------------------------------------------------
// COMPOSE — emergent behavior + side effects
// ---------------------------------------------------------------------------

describe("DOMAIN-M compose scenarios", () => {
  it("compose(read + grep) documents the search-then-read emergent loop", () => {
    const result = composeCapabilities(graph, ["m.tools.read", "m.tools.grep"]);
    assert.ok(result.emergences.length > 0, "expected emergent behaviors");
    const names = result.emergences.map((e) => `${e.a}+${e.b}`);
    assert.ok(
      names.some((n) => n.includes("m.tools.read") && n.includes("m.tools.grep")),
      `expected read+grep emergence, got ${JSON.stringify(result.emergences)}`,
    );
    // both endpoints need their depends-on category
    assert.ok(result.requires.some((r) => r.node === "m.tools"));
  });

  it("compose(model + thinking) documents the thinking-clamp composition", () => {
    const result = composeCapabilities(graph, ["m.model", "m.thinking"]);
    assert.ok(
      result.emergences.some((e) => e.behavior.toLowerCase().includes("clamp") ||
        e.behavior.toLowerCase().includes("support")),
      `expected thinking/model composition note, got ${JSON.stringify(result.emergences)}`,
    );
  });

  it("compose(extensions + custom tools) documents extension-registered tools", () => {
    const result = composeCapabilities(graph, ["m.extensions", "m.tools.custom"]);
    assert.ok(result.emergences.length > 0);
  });

  it("compose(model + tools) documents emergent behavior and side effects", () => {
    const result = composeCapabilities(graph, [
      "m.model",
      "m.tools.read",
      "m.tools.grep",
    ]);
    assert.ok(result.summary.length > 0);
    // affects edges to absent nodes surface as side effects (model → thinking, model → compaction)
    assert.ok(result.sideEffects.length > 0, "expected side effects from affects edges");
  });

  it("compose of a single capability yields no emergence but reports dependencies", () => {
    const result = composeCapabilities(graph, ["m.tools.read"]);
    assert.equal(result.emergences.length, 0);
    assert.ok(result.requires.some((r) => r.node === "m.tools"));
  });
});

// ---------------------------------------------------------------------------
// EXPLAIN — why-choices in natural language
// ---------------------------------------------------------------------------

describe("DOMAIN-M explain scenarios", () => {
  it("explain produces coherent why-choices text for a config", () => {
    const result = explainConfig(graph, {
      "m.thinking": "high",
      "m.tools": ["read", "grep"],
    });
    assert.ok(result.summary.length > 0);
    assert.ok(result.statements.length === 2, `expected 2 statements, got ${result.statements.length}`);
    const thinking = result.statements.find((s) => s.node === "m.thinking");
    assert.ok(thinking, "expected a thinking statement");
    assert.equal(thinking.value, "high");
    assert.ok(thinking.effect.length > 0, "expected an effect description");
    assert.ok(thinking.tradeoffs.length > 0, "expected trade-offs");
    const tools = result.statements.find((s) => s.node === "m.tools");
    assert.ok(tools);
    assert.ok(tools.effect.length > 0);
  });

  it("explain mentions label and value so a user learns the vocabulary", () => {
    const result = explainConfig(graph, { "m.thinking": "medium" });
    const stmt = result.statements[0];
    assert.ok(stmt !== undefined);
    assert.ok(stmt.label.length > 0);
    assert.ok(stmt.label !== "m.thinking", "label should be human-readable, not the id");
    assert.ok(result.summary.includes(stmt.label));
  });

  it("explain explains unknown config entries as errors", () => {
    const result = explainConfig(graph, { "m.bogus.node": "x" });
    assert.ok(result.unknown.length > 0);
  });
});

// ---------------------------------------------------------------------------
// LIST / DESCRIBE — traversal
// ---------------------------------------------------------------------------

describe("DOMAIN-M list/describe scenarios", () => {
  it("list returns all nodes; category filter returns tool children only", () => {
    const all = listCapabilities(graph, {});
    assert.ok(all.length >= 12, `expected >= 12 nodes, got ${all.length}`);
    const tools = listCapabilities(graph, { category: "m.tools" });
    assert.ok(tools.length >= 7, `expected >= 7 tool children, got ${tools.length}`);
    assert.ok(tools.some((n) => n.identity === "m.tools.read"));
    assert.ok(!tools.some((n) => n.identity === "m.thinking"));
  });

  it("list query filter finds thinking by label and by intent phrase", () => {
    const byLabel = listCapabilities(graph, { query: "thinking" });
    assert.ok(byLabel.some((n) => n.identity === "m.thinking"));
    const byIntent = listCapabilities(graph, { query: "reason deeper" });
    assert.ok(byIntent.some((n) => n.identity === "m.thinking"));
  });

  it("list filter by domain kind (enum) excludes free-form model", () => {
    const enums = listCapabilities(graph, { domainKind: "enum" });
    assert.ok(enums.every((n) => n.domainKind === "enum"));
    assert.ok(enums.some((n) => n.identity === "m.thinking"));
    assert.ok(!enums.some((n) => n.identity === "m.model"));
  });

  it("describe returns full node with domain, default, and incident edges", () => {
    const node = describeCapability(graph, "m.thinking");
    assert.equal(node.identity, "m.thinking");
    assert.ok(node.label.length > 0);
    assert.ok(node.description.length > 0);
    assert.equal(node.domain.kind, "enum");
    assert.equal(node.domain.values.length, 7);
    assert.ok(node.default !== undefined);
    assert.ok(node.incidentEdges.length > 0, "expected incident edges");
    assert.ok(node.intentSignature.length > 0);
  });

  it("describe lists both directions of incident edges", () => {
    const node = describeCapability(graph, "m.tools");
    const types = node.incidentEdges.map((e) => e.type);
    assert.ok(types.includes("generalizes"), `expected generalizes edges: ${types.join(",")}`);
    assert.ok(types.includes("conflicts-with"), `expected conflicts-with edges: ${types.join(",")}`);
  });

  it("describe on unknown identity throws a typed error", () => {
    assert.throws(() => describeCapability(graph, "m.unknown"), /unknown|not found/iu);
  });
});

// ---------------------------------------------------------------------------
// MEDIUM INDEPENDENCE (D5) — identities are ids, never paths
// ---------------------------------------------------------------------------

describe("DOMAIN-M medium independence (D5)", () => {
  it("no node identity is or contains a filesystem path", () => {
    const nodes = listCapabilities(graph, {});
    for (const n of nodes) {
      assert.ok(
        /^m\.[a-z0-9-]+(\.[a-z0-9-]+)*$/u.test(n.identity),
        `identity not an id: ${n.identity}`,
      );
      assert.ok(!n.identity.includes("/"), `identity contains slash: ${n.identity}`);
      assert.ok(!n.identity.includes("\\"), `identity contains backslash: ${n.identity}`);
      assert.ok(!n.identity.includes(".."), `identity contains dotdot: ${n.identity}`);
      assert.ok(!n.identity.startsWith(".") || n.identity.startsWith("m."), `identity starts with dot: ${n.identity}`);
    }
  });

  it("every node id in the graph resolves via describe (ids are canonical)", () => {
    for (const n of listCapabilities(graph, {})) {
      const d = describeCapability(graph, n.identity as CapabilityIdentity);
      assert.equal(d.identity, n.identity);
    }
  });
});
