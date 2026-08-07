/**
 * DOMAIN-M fidelity + graph integrity tests.
 *
 * Fidelity = the catalog must match the REAL engine surface:
 *   - ThinkingLevel: "off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max"
 *     (verified: @earendil-works/pi-agent-core/dist/types.d.ts line 250)
 *   - ToolName: read|bash|edit|write|grep|find|ls
 *     (verified: @earendil-works/pi-coding-agent/dist/core/tools/index.d.ts)
 *   - mediation adapter defaults (src/adapters/pi/create-session.ts):
 *     thinking ?? "off"; noTools:"all" when no allowlist declared
 *   - prime fork: same ThinkingLevel/ToolName; NO excludeTools
 *     (src/adapters/prime/create-session.ts primeToolsFromPolicy)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCatalog,
  buildMockCatalog,
  buildPiCatalog,
  buildPrimeCatalog,
} from "../../src/adapters/knowledge/catalog.ts";
import { describeCapability } from "../../src/domain/knowledge/operations.ts";
import { CAPABILITY_IDENTITY_PATTERN } from "../../src/domain/knowledge/types.ts";

/** Pi ThinkingLevel — pinned from pi-agent-core types.d.ts:250. */
const PI_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

/** Pi ToolName — pinned from pi-coding-agent tools/index.d.ts. */
const PI_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

const ENGINE_KINDS = ["pi", "prime", "mock"] as const;

describe("DOMAIN-M fidelity: catalog matches real Pi/Prime options", () => {
  it("m.thinking domain equals Pi ThinkingLevel (7 levels)", () => {
    const graph = buildPiCatalog();
    const node = describeCapability(graph, "m.thinking");
    assert.equal(node.domain.kind, "enum");
    assert.equal(node.domain.kind === "enum" ? node.domain.values.length : -1, 7);
    if (node.domain.kind === "enum") {
      const values = node.domain.values.map((v) => v.value);
      assert.deepEqual(values, [...PI_THINKING_LEVELS]);
    }
  });

  it("m.tools domain equals Pi ToolName set", () => {
    const graph = buildPiCatalog();
    const node = describeCapability(graph, "m.tools");
    assert.equal(node.domain.kind, "enum");
    if (node.domain.kind === "enum") {
      const values = node.domain.values.map((v) => v.value);
      assert.deepEqual(values, [...PI_TOOL_NAMES]);
    }
  });

  it("m.thinking default is 'off' (mediation adapter effective default)", () => {
    const graph = buildPiCatalog();
    const node = describeCapability(graph, "m.thinking");
    assert.equal(node.default, "off");
    // The rationale must be honest about WHERE the default comes from
    // (adapter overrides Pi core's own 'medium').
    assert.ok(
      (node.defaultRationale ?? "").toLowerCase().includes("adapter"),
      "default rationale should cite the mediation adapter",
    );
    assert.ok(
      (node.defaultRationale ?? "").toLowerCase().includes("off"),
      "default rationale should state the effective default",
    );
  });

  it("m.tools default is [] (adapter noTools:'all' when no allowlist)", () => {
    const graph = buildPiCatalog();
    const node = describeCapability(graph, "m.tools");
    assert.deepEqual(node.default, []);
    assert.ok((node.defaultRationale ?? "").toLowerCase().includes("notools"));
  });

  it("m.tools.denylist is engine-scoped to pi (prime has no excludeTools)", () => {
    const pi = buildPiCatalog();
    const prime = buildPrimeCatalog();
    const denylistOnPi = pi.nodes.some((n) => n.identity === "m.tools.denylist");
    const denylistOnPrime = prime.nodes.some((n) => n.identity === "m.tools.denylist");
    assert.ok(denylistOnPi, "denylist must exist on the pi catalog");
    assert.ok(!denylistOnPrime, "prime fork cannot express standalone exclude (no excludeTools)");
  });

  it("prime catalog keeps the shared thinking/tools surface", () => {
    const prime = buildPrimeCatalog();
    const thinking = describeCapability(prime, "m.thinking");
    if (thinking.domain.kind === "enum") {
      assert.deepEqual(
        thinking.domain.values.map((v) => v.value),
        [...PI_THINKING_LEVELS],
      );
    }
    const tools = describeCapability(prime, "m.tools");
    if (tools.domain.kind === "enum") {
      assert.deepEqual(tools.domain.values.map((v) => v.value), [...PI_TOOL_NAMES]);
    }
  });

  it("mock catalog is a thin variant marker with engine 'mock'", () => {
    const mock = buildMockCatalog();
    assert.equal(mock.metadata.engine, "mock");
    assert.ok(mock.nodes.length >= 20);
  });

  it("engine-scoped catalogs stay internally consistent (no dangling edges)", () => {
    for (const engine of ENGINE_KINDS) {
      const graph = buildCatalog(engine);
      const ids = new Set(graph.nodes.map((n) => n.identity));
      for (const e of graph.edges) {
        assert.ok(ids.has(e.from), `${engine}: edge from missing node ${e.from}`);
        assert.ok(ids.has(e.to), `${engine}: edge to missing node ${e.to}`);
      }
    }
  });
});

describe("DOMAIN-M graph integrity", () => {
  it("node identities are valid ids (medium independence, D5)", () => {
    for (const engine of ENGINE_KINDS) {
      const graph = buildCatalog(engine);
      for (const n of graph.nodes) {
        assert.ok(
          CAPABILITY_IDENTITY_PATTERN.test(n.identity),
          `${engine}: bad identity ${n.identity}`,
        );
        assert.ok(!n.identity.includes("/") && !n.identity.includes(".."));
      }
    }
  });

  it("node ids are unique", () => {
    const graph = buildPiCatalog();
    const ids = graph.nodes.map((n) => n.identity);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("every node has intent signatures and enum values carry descriptions", () => {
    const graph = buildPiCatalog();
    for (const n of graph.nodes) {
      assert.ok(n.intentSignature.length > 0, `${n.identity} has no intent signatures`);
      if (n.domain.kind === "enum") {
        for (const v of n.domain.values) {
          assert.ok(v.description.length > 0, `${n.identity} value ${v.value} lacks description`);
        }
      }
    }
  });

  it("every edge endpoint exists; every edge has a note", () => {
    const graph = buildPiCatalog();
    const ids = new Set(graph.nodes.map((n) => n.identity));
    const edgeKeys = new Set<string>();
    for (const e of graph.edges) {
      assert.ok(ids.has(e.from));
      assert.ok(ids.has(e.to));
      assert.ok(e.note.length > 0, `edge ${e.type} ${e.from}->${e.to} lacks a note`);
      const key = `${e.type}|${e.from}|${e.to}`;
      assert.ok(!edgeKeys.has(key), `duplicate edge ${key}`);
      edgeKeys.add(key);
    }
  });

  it("node engineScope values are valid engine kinds", () => {
    const graph = buildPiCatalog();
    for (const n of graph.nodes) {
      for (const scope of n.engineScope ?? []) {
        assert.ok((ENGINE_KINDS as readonly string[]).includes(scope));
      }
    }
  });

  it("catalog size: at least 12 nodes, at least one conflicts-with and one generalizes", () => {
    const graph = buildPiCatalog();
    assert.ok(graph.nodes.length >= 12, `nodes=${graph.nodes.length}`);
    assert.ok(graph.edges.some((e) => e.type === "conflicts-with"));
    assert.ok(graph.edges.some((e) => e.type === "generalizes"));
    assert.ok(graph.edges.some((e) => e.type === "depends-on"));
    assert.ok(graph.edges.some((e) => e.type === "composes-with"));
    assert.ok(graph.edges.some((e) => e.type === "affects"));
  });
});
