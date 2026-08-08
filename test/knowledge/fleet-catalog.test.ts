/**
 * PHASE 2 — CATALOG ACCURACY: the Domain-M catalog teaches the company fleet.
 *
 * Covers:
 *   - generative fleet builder (agent.yaml → agent.<name> nodes + AgentRef)
 *   - curated intent signatures for the agents the human dispatches
 *     (resolveIntent("dispatch our web researcher") → agent.web-researcher)
 *   - agentFor bridge: resolveIntent → agentFor → real AgentRef
 *   - describe("agent.web-researcher")
 *   - D5 medium independence for the new nodes (ids, never paths)
 *   - default knowledge catalog = engine catalog + fleet (merge)
 *   - compose roots wire the fleet default (local + hosted)
 *   - graceful degradation when no fleet root exists (engine-only default)
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildDefaultKnowledgeCatalog,
  buildFleetCatalog,
  mergeCatalogs,
} from "../../src/adapters/knowledge/fleet-catalog.ts";
import { buildPiCatalog, DEFAULT_CATALOG } from "../../src/adapters/knowledge/catalog.ts";
import { createKnowledgeService } from "../../src/adapters/knowledge/service.ts";
import {
  describeCapability,
  resolveIntent,
} from "../../src/domain/knowledge/operations.ts";
import { CAPABILITY_IDENTITY_PATTERN } from "../../src/domain/knowledge/types.ts";
import { findNode } from "../../src/domain/knowledge/graph.ts";
import {
  createHostedMediation,
  createLocalMediation,
} from "../../src/adapters/compose.ts";

const FLEET_ROOT = path.resolve(import.meta.dirname, "../../fixtures/fleet-agents");

function nodeIds(graph: ReturnType<typeof buildFleetCatalog>): string[] {
  return graph.nodes.map((n) => n.identity);
}

describe("fleet catalog — generative builder (agent.yaml → agent nodes)", () => {
  it("builds one agent.<name> node per agent.yaml directory (16 in fixture)", () => {
    const fleet = buildFleetCatalog({ agentsRoot: FLEET_ROOT });
    const ids = nodeIds(fleet);
    assert.equal(ids.length, 16, `expected 16 fleet nodes, got ${ids.length}`);
    for (const name of [
      "web-researcher",
      "brain-explorer",
      "coding-agent",
      "intel-researcher",
      "lego-researcher",
      "session-analyst",
      "pi-agent-designer",
      "email",
    ]) {
      assert.ok(ids.includes(`agent.${name}`), `missing agent.${name}`);
    }
  });

  it("adds agents NOT in the manifest generatively (mystery-agent from disk only)", () => {
    const fleet = buildFleetCatalog({ agentsRoot: FLEET_ROOT });
    const node = findNode(fleet, "agent.mystery-agent");
    assert.ok(node, "generative agent missing");
    assert.equal(node!.label, "Mystery Agent");
    // derived intents include name phrases AND custom-tool phrases
    const intents = node!.intentSignature.map((s) =>
      typeof s === "string" ? s : s.text,
    );
    assert.ok(intents.includes("mystery agent"), `intents: ${intents.join(" | ")}`);
    assert.ok(intents.includes("sniff signal"), `custom-tool intent missing: ${intents.join(" | ")}`);
  });

  it("uses yaml.description when present (dyadic-weaver), prompt first lines otherwise", () => {
    const fleet = buildFleetCatalog({ agentsRoot: FLEET_ROOT });
    const dyadic = findNode(fleet, "agent.dyadic-weaver");
    assert.ok(dyadic);
    assert.ok(
      dyadic!.description.startsWith("Builds a vocabulary of dyadic interaction patterns"),
      `expected yaml.description, got: ${dyadic!.description}`,
    );
    // curated description wins over prompt-derived for dispatched agents
    const coding = findNode(fleet, "agent.coding-agent");
    assert.ok(coding);
    assert.ok(
      coding!.description.includes("Writes correct code"),
      `expected curated description, got: ${coding!.description}`,
    );
    // mystery-agent (no curated, no yaml.description) derives from prompt.md
    const mystery = findNode(fleet, "agent.mystery-agent");
    assert.ok(mystery);
    assert.ok(
      mystery!.description.includes("Mystery Agent"),
      `expected prompt-derived description, got: ${mystery!.description}`,
    );
  });

  it("every agent node carries a definition-loader-resolvable AgentRef (name + rootDir)", () => {
    const fleet = buildFleetCatalog({ agentsRoot: FLEET_ROOT });
    for (const n of fleet.nodes) {
      assert.ok(n.agentRef, `${n.identity} must carry an agentRef`);
      assert.equal(n.agentRef!.name, n.identity.slice("agent.".length));
      assert.ok(
        n.agentRef!.rootDir.endsWith(n.agentRef!.name),
        `rootDir should end with the agent dir: ${n.agentRef!.rootDir}`,
      );
      assert.ok(
        n.agentRef!.rootDir.startsWith(FLEET_ROOT),
        `rootDir should resolve under the fleet root: ${n.agentRef!.rootDir}`,
      );
    }
  });

  it("graceful degradation: no fleet root → empty fleet graph (engine-only default)", () => {
    const empty = buildFleetCatalog({ agentsRoot: "/nonexistent/agents" });
    assert.equal(empty.nodes.length, 0);
    const merged = mergeCatalogs(DEFAULT_CATALOG, empty);
    assert.equal(merged, DEFAULT_CATALOG, "zero-node fleet must return the base unchanged");
  });
});

describe("fleet catalog — D5 medium independence (ids, never paths)", () => {
  it("all agent node identities are valid ids matching (m|agent).<segment>.*", () => {
    const fleet = buildFleetCatalog({ agentsRoot: FLEET_ROOT });
    for (const n of fleet.nodes) {
      assert.ok(
        CAPABILITY_IDENTITY_PATTERN.test(n.identity),
        `identity not an id: ${n.identity}`,
      );
      assert.ok(!n.identity.includes("/"), `identity contains slash: ${n.identity}`);
      assert.ok(!n.identity.includes("\\"), `identity contains backslash: ${n.identity}`);
      assert.ok(!n.identity.includes(".."), `identity contains dotdot: ${n.identity}`);
      assert.ok(n.identity.startsWith("agent."), `identity not namespaced: ${n.identity}`);
      // paths are VALUES on the AgentRef, never identities
      assert.ok(typeof n.agentRef!.rootDir === "string");
      assert.ok(!n.agentRef!.rootDir.includes("agent."), "rootDir must not leak the id");
    }
  });

  it("every fleet node resolves via describe (ids are canonical)", () => {
    const fleet = buildFleetCatalog({ agentsRoot: FLEET_ROOT });
    for (const n of fleet.nodes) {
      const d = describeCapability(fleet, n.identity);
      assert.equal(d.identity, n.identity);
    }
  });
});

describe("fleet catalog — curated intent resolution", () => {
  it("resolveIntent('dispatch our web researcher') ranks agent.web-researcher first", () => {
    const fleet = buildFleetCatalog({ agentsRoot: FLEET_ROOT });
    const result = resolveIntent(fleet, "dispatch our web researcher");
    assert.equal(
      result.matches[0]?.identity,
      "agent.web-researcher",
      `expected agent.web-researcher, got ${result.matches[0]?.identity} (${result.matches[0]?.score})`,
    );
    assert.ok((result.matches[0]?.score ?? 0) > 0.5);
  });

  it("resolveIntent('analyze the fleet sessions') ranks agent.session-analyst", () => {
    const fleet = buildFleetCatalog({ agentsRoot: FLEET_ROOT });
    const result = resolveIntent(fleet, "analyze the fleet sessions");
    assert.equal(result.matches[0]?.identity, "agent.session-analyst");
  });

  it("resolveIntent('find code implementations on github') ranks agent.lego-researcher", () => {
    const fleet = buildFleetCatalog({ agentsRoot: FLEET_ROOT });
    const result = resolveIntent(fleet, "find code implementations on github");
    assert.equal(result.matches[0]?.identity, "agent.lego-researcher");
  });

  it("describe('agent.web-researcher') returns a human/agent-readable node", () => {
    const fleet = buildFleetCatalog({ agentsRoot: FLEET_ROOT });
    const node = describeCapability(fleet, "agent.web-researcher");
    assert.equal(node.label, "Web Researcher");
    assert.ok(node.description.length > 20, "expected a substantive description");
    assert.equal(node.domain.kind, "free");
    assert.ok(node.effect.summary.length > 0);
    assert.equal(node.agentRef?.name, "web-researcher");
    // curated signatures present (not just auto-derived)
    const intents = node.intentSignature.map((s) => (typeof s === "string" ? s : s.text));
    assert.ok(intents.includes("web research"), `curated intents missing: ${intents.join(" | ")}`);
  });

  it("at least 5 fleet agents are covered with curated intent signatures", () => {
    const fleet = buildFleetCatalog({ agentsRoot: FLEET_ROOT });
    const curated = [
      "agent.web-researcher",
      "agent.brain-explorer",
      "agent.coding-agent",
      "agent.intel-researcher",
      "agent.lego-researcher",
      "agent.session-analyst",
      "agent.pi-agent-designer",
    ];
    for (const id of curated) {
      const n = findNode(fleet, id);
      assert.ok(n, `missing curated agent ${id}`);
      const intents = n!.intentSignature.map((s) => (typeof s === "string" ? s : s.text));
      assert.ok(intents.length >= 3, `${id} should have curated/derived intents`);
    }
  });
});

describe("fleet catalog — agentFor bridge (resolveIntent → agent → AgentRef)", () => {
  it("agentFor('agent.web-researcher') resolves to the real AgentRef via node agentRef", async () => {
    const port = createKnowledgeService(buildFleetCatalog({ agentsRoot: FLEET_ROOT }));
    const ref = await port.agentFor?.("agent.web-researcher");
    assert.ok(ref, "agentFor must resolve the fleet agent");
    assert.equal(ref!.name, "web-researcher");
    assert.equal(ref!.rootDir, path.join(FLEET_ROOT, "web-researcher"));
  });

  it("resolveIntent → agentFor → AgentRef round-trips 'dispatch our web researcher'", async () => {
    const graph = buildDefaultKnowledgeCatalog({ agentsRoot: FLEET_ROOT });
    const port = createKnowledgeService(graph);
    const { matches } = await port.resolve("dispatch our web researcher");
    const top = matches[0];
    assert.ok(top, "expected a match");
    assert.equal(top!.identity, "agent.web-researcher");
    const ref = await port.agentFor?.(top!.identity);
    assert.equal(ref?.name, "web-researcher");
    assert.equal(ref?.rootDir, path.join(FLEET_ROOT, "web-researcher"));
    // definition-loader shape (name + rootDir) survives the full seam
    assert.equal(typeof ref?.name, "string");
    assert.equal(typeof ref?.rootDir, "string");
  });

  it("engine capabilities are unaffected: agentFor on an m.* id is undefined", async () => {
    const graph = buildDefaultKnowledgeCatalog({ agentsRoot: FLEET_ROOT });
    const port = createKnowledgeService(graph);
    assert.equal(await port.agentFor?.("m.thinking"), undefined);
    assert.equal(await port.agentFor?.("m.tools.read"), undefined);
  });
});

describe("fleet catalog — default knowledge = engine catalog + fleet", () => {
  it("buildDefaultKnowledgeCatalog merges engine nodes and fleet nodes", () => {
    const graph = buildDefaultKnowledgeCatalog({ agentsRoot: FLEET_ROOT });
    assert.ok(findNode(graph, "m.thinking"), "engine node missing");
    assert.ok(findNode(graph, "m.tools.bash"), "engine node missing");
    assert.ok(findNode(graph, "agent.web-researcher"), "fleet node missing");
    assert.ok(findNode(graph, "agent.mystery-agent"), "generative fleet node missing");
    const ids = new Set(graph.nodes.map((n) => n.identity));
    assert.equal(ids.size, graph.nodes.length, "no duplicate ids after merge");
    // engine metadata preserved (pi catalog)
    assert.equal(graph.metadata.engine, "pi");
  });

  it("pure engine resolve behavior is unchanged in the merged default", () => {
    const graph = buildDefaultKnowledgeCatalog({ agentsRoot: FLEET_ROOT });
    const result = resolveIntent(graph, "make it more careful");
    assert.equal(result.matches[0]?.identity, "m.thinking");
    assert.equal(result.matches[0]?.suggestion, "high");
    const bash = resolveIntent(graph, "run a command in the terminal");
    assert.equal(bash.matches[0]?.identity, "m.tools.bash");
  });

  it("default (no fleet root) is byte-identical to the pure engine catalog", () => {
    const graph = buildDefaultKnowledgeCatalog({ agentsRoot: "/nonexistent" });
    assert.equal(graph, DEFAULT_CATALOG);
    assert.equal(graph.nodes.length, buildPiCatalog().nodes.length);
  });
});

describe("fleet catalog — compose roots wire the fleet default", () => {
  it("createLocalMediation default knowledge resolves agentFor('agent.web-researcher')", async () => {
    const { mediation } = createLocalMediation({
      mockEngine: true,
      fleetAgentsRoot: FLEET_ROOT,
    });
    const k = mediation.knowledge!;
    const ref = await k.agentFor?.("agent.web-researcher");
    assert.ok(ref, "local composition must wire the fleet mapping");
    assert.equal(ref!.name, "web-researcher");
    assert.equal(ref!.rootDir, path.join(FLEET_ROOT, "web-researcher"));

    // resolve through the facade: intent → agent → AgentRef
    const { matches } = await k.resolveIntent("dispatch our web researcher");
    assert.equal(matches[0]?.identity, "agent.web-researcher");
    const viaIntent = await k.agentFor?.(matches[0]!.identity);
    assert.equal(viaIntent?.name, "web-researcher");

    // engine face intact
    const thinking = await k.resolveIntent("make it more careful");
    assert.equal(thinking.matches[0]?.identity, "m.thinking");
  });

  it("createHostedMediation default knowledge also wires the fleet mapping", async () => {
    const hosted = createHostedMediation({
      dbPath: ":memory:",
      mockEngine: true,
      fleetAgentsRoot: FLEET_ROOT,
    });
    try {
      const k = hosted.mediation.knowledge!;
      const ref = await k.agentFor?.("agent.coding-agent");
      assert.ok(ref, "hosted composition must wire the fleet mapping");
      assert.equal(ref!.name, "coding-agent");
      assert.equal(ref!.rootDir, path.join(FLEET_ROOT, "coding-agent"));
    } finally {
      await hosted.stop();
    }
  });

  it("an explicit KnowledgePort still wins over the fleet default", async () => {
    const port = createKnowledgeService(buildPiCatalog());
    const { mediation } = createLocalMediation({
      mockEngine: true,
      knowledge: port,
      fleetAgentsRoot: FLEET_ROOT,
    });
    const k = mediation.knowledge!;
    // pure engine port — no fleet nodes, even though a fleet root was offered
    assert.equal(await k.agentFor?.("agent.web-researcher"), undefined);
    const listed = await k.listCapabilities({});
    assert.ok(!listed.some((n) => n.identity.startsWith("agent.")));
  });
});

describe("fleet catalog — manifest integrity", () => {
  it("every curated entry produces a node with a non-empty curated description", () => {
    const fleet = buildFleetCatalog({ agentsRoot: FLEET_ROOT });
    for (const id of [
      "agent.web-researcher",
      "agent.brain-explorer",
      "agent.coding-agent",
      "agent.intel-researcher",
      "agent.lego-researcher",
      "agent.session-analyst",
      "agent.pi-agent-designer",
      "agent.storyline-agent",
      "agent.cognitive-cartographer",
      "agent.yt-researcher",
      "agent.email",
      "agent.product-researcher",
      "agent.visual-cortex",
      "agent.notion",
    ]) {
      const n = findNode(fleet, id);
      assert.ok(n, `missing manifest agent ${id}`);
      assert.ok((n!.description ?? "").length > 40, `${id} needs a real description`);
    }
  });
});
