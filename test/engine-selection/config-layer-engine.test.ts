/**
 * S2e: CapabilitySpec.engine merge — later layer overrides earlier
 * (identical to tools.agentMode), order-independent via kind sorting.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mergeCapabilitySpecs,
  type ConfigLayer,
} from "../../src/domain/config-layer.ts";
import { capabilitySpecFromDefinition } from "../../src/app/factory.ts";
import type { AgentDefinition } from "../../src/domain/definition.ts";

function layer(
  kind: ConfigLayer["kind"],
  spec: ConfigLayer["spec"],
): ConfigLayer {
  return { kind, spec };
}

describe("domain/config-layer engine (S2e)", () => {
  it("single agent layer engine passes through", () => {
    const effective = mergeCapabilitySpecs([
      layer("agent", { engine: "prime" }),
    ]);
    assert.equal(effective.engine, "prime");
  });

  it("later layer overrides earlier (root → family → agent)", () => {
    const effective = mergeCapabilitySpecs([
      layer("root", { engine: "pi" }),
      layer("family", { engine: "mock" }),
      layer("agent", { engine: "prime" }),
    ]);
    assert.equal(effective.engine, "prime");
  });

  it("engine override respects kind order even when input scrambled", () => {
    const effective = mergeCapabilitySpecs([
      layer("agent", { engine: "mock" }),
      layer("root", { engine: "prime" }),
      layer("family", { engine: "pi" }),
    ]);
    // agent (last kind) wins regardless of input order
    assert.equal(effective.engine, "mock");
  });

  it("partial layers: only declared engine survives (no wipe)", () => {
    const effective = mergeCapabilitySpecs([
      layer("root", { engine: "prime" }),
      // agent layer declares no engine — must not clear root's engine
      layer("agent", { extensions: ["x"] }),
    ]);
    assert.equal(effective.engine, "prime");
  });

  it("no engine anywhere → effective spec has no engine field", () => {
    const effective = mergeCapabilitySpecs([
      layer("root", { extensions: ["a"] }),
    ]);
    assert.deepEqual(effective.extensions.map(String), ["a"]);
    assert.ok(!("engine" in effective));
  });

  it("engine merges alongside tools policy (agentMode parity)", () => {
    const effective = mergeCapabilitySpecs([
      layer("root", {
        engine: "pi",
        tools: { agentMode: "static", builtin: ["read"] },
      }),
      layer("agent", {
        engine: "prime",
        tools: { agentMode: "dynamic" },
      }),
    ]);
    assert.equal(effective.engine, "prime");
    assert.equal(effective.tools.agentMode, "dynamic");
    assert.deepEqual(effective.tools.builtin, ["read"]);
  });
});

describe("capabilitySpecFromDefinition engine (S2e)", () => {
  it("copies definition.engine into the agent-layer spec", () => {
    const def: AgentDefinition = {
      id: "a",
      name: "a",
      rootDir: "/tmp/a",
      model: "test/model",
      engine: "prime",
    };
    const spec = capabilitySpecFromDefinition(def);
    assert.equal(spec.engine, "prime");
  });

  it("omits engine when definition has none", () => {
    const def: AgentDefinition = {
      id: "a",
      name: "a",
      rootDir: "/tmp/a",
      model: "test/model",
    };
    const spec = capabilitySpecFromDefinition(def);
    assert.ok(!("engine" in spec));
  });
});

