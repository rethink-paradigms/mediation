/**
 * DOMAIN-M KnowledgePort smoke — the port surface app/surfaces will consume.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPrimeCatalog } from "../../src/adapters/knowledge/catalog.ts";
import {
  createKnowledgeService,
} from "../../src/adapters/knowledge/service.ts";
import { asCapabilityIdentity } from "../../src/domain/knowledge/types.ts";
import type { KnowledgePort } from "../../src/ports/knowledge.ts";

describe("DOMAIN-M KnowledgePort", () => {
  it("createKnowledgeService returns a working KnowledgePort (default pi catalog)", async () => {
    const port: KnowledgePort = createKnowledgeService();
    const graph = await port.loadGraph();
    assert.equal(graph.metadata.engine, "pi");
    assert.ok(graph.nodes.length >= 12);

    const listed = await port.list({});
    assert.ok(listed.length === graph.nodes.length);

    const resolved = await port.resolve("make it more careful");
    assert.equal(resolved.matches[0]?.identity, "m.thinking");

    const validated = await port.validate({
      "m.thinking": "high",
      "m.tools": ["read"],
    });
    assert.equal(validated.ok, true);

    const composed = await port.compose(["m.tools.read", "m.tools.grep"]);
    assert.ok(composed.emergences.length > 0);

    const explained = await port.explain({ "m.thinking": "medium" });
    assert.ok(explained.statements.length === 1);
    assert.ok(explained.summary.length > 0);

    const described = await port.describe(asCapabilityIdentity("m.thinking"));
    assert.ok(described.incidentEdges.length > 0);
  });

  it("port can be constructed over an engine-scoped catalog", async () => {
    const port = createKnowledgeService(buildPrimeCatalog());
    const graph = await port.loadGraph();
    assert.equal(graph.metadata.engine, "prime");
    // pi-scoped node must not be reachable on prime
    const listed = await port.list({});
    assert.ok(!listed.some((n) => n.identity === "m.tools.denylist"));
  });

  it("describe on an unknown identity rejects via the port", async () => {
    const port = createKnowledgeService();
    await assert.rejects(
      port.describe(asCapabilityIdentity("m.not.a.node")),
      /unknown capability node/iu,
    );
  });
});
