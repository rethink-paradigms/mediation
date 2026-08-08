/**
 * DOMAIN-M createGraph diagnostics — regression for CODEBASE-REVIEW.md A3:
 * error messages must interpolate the node identity, never the module-level
 * `id()` function source (was: `node "${id}" has no intent signatures`
 * printed the function body — the exact diagnostic a catalog author sees).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createGraph } from "../../src/domain/knowledge/graph.ts";
import type {
  CapabilityEdge,
  CapabilityNode,
  GraphMetadata,
} from "../../src/domain/knowledge/types.ts";

const META: GraphMetadata = {
  name: "graph-diagnostics",
  version: "1",
  source: "test",
};

function badNode(
  identity: string,
  overrides: Partial<CapabilityNode> = {},
): CapabilityNode {
  return {
    identity: identity as CapabilityNode["identity"],
    label: "Bad node",
    description: "a node missing required content",
    domain: {
      kind: "enum",
      values: [{ value: "a", description: "a" }],
    },
    effect: { summary: "no effect" },
    intentSignature: ["some intent"],
    ...overrides,
  };
}

describe("DOMAIN-M createGraph diagnostics (A3)", () => {
  it("node without intent signatures names the identity, not the id() function", () => {
    const node = badNode("m.bad-signatures", { intentSignature: [] });
    assert.throws(
      () => createGraph(META, [node], []),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        assert.ok(
          msg.includes("m.bad-signatures"),
          `expected the identity in the message, got: ${msg}`,
        );
        assert.ok(
          !msg.includes("function"),
          `message must not contain the id() function source, got: ${msg}`,
        );
        assert.ok(msg.includes("has no intent signatures"), msg);
        return true;
      },
    );
  });

  it("node with an empty enum domain names the identity, not the id() function", () => {
    const node = badNode("m.bad-enum", {
      domain: { kind: "enum", values: [] },
    });
    assert.throws(
      () => createGraph(META, [node], []),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        assert.ok(
          msg.includes("m.bad-enum"),
          `expected the identity in the message, got: ${msg}`,
        );
        assert.ok(
          !msg.includes("function"),
          `message must not contain the id() function source, got: ${msg}`,
        );
        assert.ok(msg.includes("has an empty enum domain"), msg);
        return true;
      },
    );
  });

  it("a healthy node still builds a graph (no regression)", () => {
    const nodes: CapabilityNode[] = [
      badNode("m.healthy", {
        label: "Healthy",
        intentSignature: ["a healthy intent"],
      }),
    ];
    const edges: CapabilityEdge[] = [];
    const graph = createGraph(META, nodes, edges);
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.nodes[0]?.identity, "m.healthy");
  });
});
