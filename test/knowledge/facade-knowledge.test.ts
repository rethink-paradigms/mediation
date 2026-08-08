/**
 * PHASE 2 — DOMAIN-M wired into the product: the Mediation façade exposes a
 * `knowledge` face (capability-graph ops) reachable through the composition
 * roots, plus the optional catalog→agent bridge (agentFor) for
 * resolveIntent → agent → engage flows.
 *
 * The Pi-extension's mediation_agents tool consumes exactly this face off
 * @company/mediation — these tests pin its public shape.
 */

import path from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createHostedMediation,
  createLocalMediation,
} from "../../src/adapters/compose.ts";
import {
  buildPiCatalog,
  buildPrimeCatalog,
} from "../../src/adapters/knowledge/catalog.ts";
import {
  createKnowledgeService,
  KnowledgeService,
} from "../../src/adapters/knowledge/service.ts";
import { createGraph } from "../../src/domain/knowledge/graph.ts";
import type { AgentRef } from "../../src/domain/definition.ts";
import type {
  CapabilityNode,
  GraphMetadata,
} from "../../src/domain/knowledge/types.ts";
import type { KnowledgePort } from "../../src/ports/knowledge.ts";
import { Mediation } from "../../src/app/mediation.ts";
import { createYamlDefinitionLoader } from "../../src/adapters/definition/yaml-definition-loader.ts";

function node(
  identity: string,
  overrides: Partial<CapabilityNode> = {},
): CapabilityNode {
  return {
    identity: identity as CapabilityNode["identity"],
    label: identity,
    description: "test node",
    domain: { kind: "enum", values: [{ value: "a", description: "a" }] },
    effect: { summary: "no effect" },
    intentSignature: [identity],
    ...overrides,
  };
}

describe("Mediation knowledge face (phase 2 wiring)", () => {
  it("createLocalMediation wires the knowledge face by default (list/describe/resolve)", async () => {
    const { mediation } = createLocalMediation({ mockEngine: true });
    assert.ok(
      mediation.knowledge,
      "composition must expose facade.knowledge",
    );
    const k = mediation.knowledge!;

    const listed = await k.listCapabilities({});
    assert.ok(listed.length >= 12, `expected catalog nodes, got ${listed.length}`);
    assert.ok(listed.some((n) => n.identity === "m.thinking"));

    const described = await k.describeCapability("m.thinking");
    assert.equal(described.identity, "m.thinking");
    assert.ok(described.incidentEdges.length > 0);
    assert.equal(described.domain.kind, "enum");

    const resolved = await k.resolveIntent("make it more careful");
    assert.equal(resolved.matches[0]?.identity, "m.thinking");
    assert.equal(resolved.matches[0]?.suggestion, "high");
  });

  it("knowledge face validate/compose/explain delegate to the port", async () => {
    const { mediation } = createLocalMediation({ mockEngine: true });
    const k = mediation.knowledge!;

    const validated = await k.validate({
      "m.thinking": "high",
      "m.tools": ["read"],
    });
    assert.equal(validated.ok, true);

    const composed = await k.compose(["m.tools.read", "m.tools.grep"]);
    assert.ok(composed.emergences.length > 0);
    assert.ok(composed.requires.some((r) => r.node === "m.tools"));

    const explained = await k.explain({ "m.thinking": "medium" });
    assert.equal(explained.statements.length, 1);
    assert.ok(explained.summary.length > 0);
  });

  it("knowledge face supports filtered list + describe errors through the facade", async () => {
    const { mediation } = createLocalMediation({ mockEngine: true });
    const k = mediation.knowledge!;

    const tools = await k.listCapabilities({ category: "m.tools" });
    assert.ok(tools.some((n) => n.identity === "m.tools.read"));
    assert.ok(!tools.some((n) => n.identity === "m.thinking"));

    await assert.rejects(
      k.describeCapability("m.not.a.node"),
      /unknown capability node/iu,
    );
  });

  it("createHostedMediation wires the knowledge face by default", async () => {
    const hosted = createHostedMediation({ dbPath: ":memory:", mockEngine: true });
    try {
      assert.ok(hosted.mediation.knowledge);
      const k = hosted.mediation.knowledge!;
      const resolved = await k.resolveIntent("run a command in the terminal");
      assert.equal(resolved.matches[0]?.identity, "m.tools.bash");
      const described = await k.describeCapability("m.tools.bash");
      assert.ok(described.incidentEdges.length > 0);
    } finally {
      await hosted.stop();
    }
  });

  it("an explicit KnowledgePort injection wins over the default", async () => {
    // Prime-scoped port: m.tools.denylist is pi-only, so describe must reject.
    const primePort = createKnowledgeService(buildPrimeCatalog());
    const { mediation } = createLocalMediation({
      mockEngine: true,
      knowledge: primePort,
    });
    const k = mediation.knowledge!;
    await assert.rejects(
      k.describeCapability("m.tools.denylist"),
      /unknown capability node/iu,
    );
    const listed = await k.listCapabilities({});
    assert.ok(!listed.some((n) => n.identity === "m.tools.denylist"));
  });
});

describe("Mediation knowledge bridge (catalog → agent)", () => {
  it("runtime mapping layer: agentFor returns the AgentRef for a mapped capability", async () => {
    const agentRefs: Readonly<Record<string, AgentRef>> = {
      "m.tools.read": { name: "web-researcher", rootDir: "/agents/web-researcher" },
      "m.tools.bash": { name: "ops-runner", rootDir: "/agents/ops-runner" },
    };
    const port = createKnowledgeService(buildPiCatalog(), agentRefs);
    const { mediation } = createLocalMediation({ mockEngine: true, knowledge: port });
    const k = mediation.knowledge!;
    assert.ok(k.agentFor, "face must surface the bridge when the port has one");

    const ref = await k.agentFor!("m.tools.read");
    assert.equal(ref?.name, "web-researcher");
    assert.equal(ref?.rootDir, "/agents/web-researcher");
    // definition-loader-resolvable shape (name + rootDir)
    assert.equal(typeof ref?.name, "string");
    assert.equal(typeof ref?.rootDir, "string");

    // unmapped capability → undefined
    assert.equal(await k.agentFor!("m.thinking"), undefined);
  });

  it("resolveIntent → agentFor → AgentRef round-trips a real intent", async () => {
    const agentRefs: Readonly<Record<string, AgentRef>> = {
      "m.tools.read": { name: "web-researcher", rootDir: "/agents/web-researcher" },
    };
    const port = createKnowledgeService(buildPiCatalog(), agentRefs);
    const { mediation } = createLocalMediation({ mockEngine: true, knowledge: port });
    const k = mediation.knowledge!;

    const { matches } = await k.resolveIntent("let it read files");
    assert.equal(matches[0]?.identity, "m.tools.read");
    const ref = await k.agentFor!(matches[0]!.identity);
    assert.equal(ref?.name, "web-researcher");
    assert.equal(ref?.rootDir, "/agents/web-researcher");
    // Full seam: resolveIntent → agentFor → AgentRef (definition-loader shape).
    assert.equal(typeof ref?.name, "string");
    assert.equal(typeof ref?.rootDir, "string");
  });

  it("node-declared agentRef is honored by the bridge (catalog seam)", async () => {
    const META: GraphMetadata = { name: "agent-seam", version: "1", source: "test" };
    const nodes: CapabilityNode[] = [
      node("m.thinker", {
        label: "Thinker agent",
        agentRef: { name: "thinker-agent", rootDir: "/agents/thinker" },
      }),
    ];
    const graph = createGraph(META, nodes, []);
    // No runtime mapping — only the node-declared agentRef can bridge.
    const port = new KnowledgeService(graph);
    const ref = await port.agentFor("m.thinker");
    assert.equal(ref?.name, "thinker-agent");
    assert.equal(ref?.rootDir, "/agents/thinker");
    assert.equal(await port.agentFor("m.unknown"), undefined);
  });

  it("the plain service default (engine catalog) maps no capabilities to agents", async () => {
    // createKnowledgeService() defaults to DEFAULT_CATALOG — the pure engine
    // capability catalog, which has no agent nodes. The fleet mapping is the
    // COMPOSITION default (createLocal/HostedMediation wire
    // buildDefaultKnowledgeCatalog), covered in fleet-catalog.test.ts.
    const port = createKnowledgeService();
    const all = await port.list({});
    for (const n of all) {
      assert.equal(await port.agentFor?.(n.identity), undefined);
    }
  });

  it("the composition default maps fleet agents when a fleet root is wired", async () => {
    // Deterministic: an explicit agentsRoot is honored by the compose default
    // knowledge wiring (production uses the company convention / env var).
    const { mediation } = createLocalMediation({
      mockEngine: true,
      fleetAgentsRoot: path.resolve(
        import.meta.dirname,
        "../../fixtures/fleet-agents",
      ),
    });
    const k = mediation.knowledge!;
    assert.ok(k.agentFor, "fleet wiring must surface the bridge");
    const ref = await k.agentFor!("agent.web-researcher");
    assert.equal(ref?.name, "web-researcher");
    assert.ok(ref?.rootDir.endsWith("web-researcher"));
  });

  it("face exposes no agentFor when the wired port implements none", async () => {
    const noBridge: KnowledgePort = {
      loadGraph: async () => buildPiCatalog(),
      list: async () => [],
      describe: async () => {
        throw new Error("not wired");
      },
      resolve: async () => ({ intent: "x", matches: [] }),
      validate: async () => ({ ok: true, violations: [] }),
      compose: async () => ({ composed: [], emergences: [], sideEffects: [], requires: [], summary: "" }),
      explain: async () => ({ statements: [], unknown: [], summary: "" }),
    };
    const { mediation } = createLocalMediation({ mockEngine: true, knowledge: noBridge });
    assert.equal(mediation.knowledge!.agentFor, undefined);
  });
});

describe("Mediation knowledge face construction edge cases", () => {
  it("direct new Mediation without a KnowledgePort has no knowledge face", async () => {
    const mediation = new Mediation({
      loader: createYamlDefinitionLoader(),
      factory: {
        materialize: async () => {
          throw new Error("not used");
        },
      },
      join: undefined,
    });
    assert.equal(mediation.knowledge, undefined);
  });
});
