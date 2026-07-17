/**
 * ABS-A5: pure root · family · agent CapabilitySpec merge (in-memory fixtures).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asCapabilityId } from "../../src/domain/capability.ts";
import {
  mergeCapabilitySpecs,
  type ConfigLayer,
  type EffectiveCapabilitySpec,
} from "../../src/domain/config-layer.ts";

function layer(
  kind: ConfigLayer["kind"],
  spec: ConfigLayer["spec"],
): ConfigLayer {
  return { kind, spec };
}

describe("domain/config-layer (ABS-A5)", () => {
  it("empty layers yield empty effective spec", () => {
    const effective = mergeCapabilitySpecs([]);
    assert.deepEqual(effective, {
      extensions: [],
      tools: {},
      skills: [],
    } satisfies EffectiveCapabilitySpec);
  });

  it("single agent layer passes through (branding extensions)", () => {
    const effective = mergeCapabilitySpecs([
      layer("agent", {
        extensions: ["ext/a", asCapabilityId("ext/b")],
        skills: ["skill-x"],
        tools: {
          builtin: ["read", "bash"],
          agentMode: "dynamic",
          activeTools: ["read"],
          exclude: ["write"],
        },
      }),
    ]);
    assert.deepEqual(effective.extensions, [
      asCapabilityId("ext/a"),
      asCapabilityId("ext/b"),
    ]);
    assert.deepEqual(effective.skills, ["skill-x"]);
    assert.deepEqual(effective.tools, {
      builtin: ["read", "bash"],
      exclude: ["write"],
      agentMode: "dynamic",
      activeTools: ["read"],
    });
  });

  it("extensions: ordered unique union root → family → agent", () => {
    const effective = mergeCapabilitySpecs([
      layer("root", { extensions: ["core", "shared"] }),
      layer("family", { extensions: ["shared", "family-x"] }),
      layer("agent", { extensions: ["core", "agent-y"] }),
    ]);
    assert.deepEqual(effective.extensions.map(String), [
      "core",
      "shared",
      "family-x",
      "agent-y",
    ]);
  });

  it("skills: ordered unique union across layers", () => {
    const effective = mergeCapabilitySpecs([
      layer("root", { skills: ["base", "common"] }),
      layer("family", { skills: ["common", "family"] }),
      layer("agent", { skills: ["agent", "base"] }),
    ]);
    assert.deepEqual(effective.skills, ["base", "common", "family", "agent"]);
  });

  it("tools.builtin and tools.exclude are ordered unique unions", () => {
    const effective = mergeCapabilitySpecs([
      layer("root", {
        tools: { builtin: ["read", "bash"], exclude: ["danger"] },
      }),
      layer("family", {
        tools: { builtin: ["bash", "write"], exclude: ["danger", "net"] },
      }),
      layer("agent", {
        tools: { builtin: ["edit"], exclude: ["net"] },
      }),
    ]);
    assert.deepEqual(effective.tools.builtin, ["read", "bash", "write", "edit"]);
    assert.deepEqual(effective.tools.exclude, ["danger", "net"]);
  });

  it("tools.custom unions like builtin", () => {
    const effective = mergeCapabilitySpecs([
      layer("family", { tools: { custom: ["tool_finder"] } }),
      layer("agent", { tools: { custom: ["tool_finder", "local_tool"] } }),
    ]);
    assert.deepEqual(effective.tools.custom, ["tool_finder", "local_tool"]);
  });

  it("tools.agentMode: later layer overrides earlier", () => {
    const effective = mergeCapabilitySpecs([
      layer("root", { tools: { agentMode: "static" } }),
      layer("family", { tools: { agentMode: "dynamic" } }),
      layer("agent", { tools: { agentMode: "static" } }),
    ]);
    assert.equal(effective.tools.agentMode, "static");
  });

  it("tools.activeTools: later layer replaces (not union)", () => {
    const effective = mergeCapabilitySpecs([
      layer("root", { tools: { activeTools: ["read", "bash", "write"] } }),
      layer("agent", { tools: { activeTools: ["read"] } }),
    ]);
    assert.deepEqual(effective.tools.activeTools, ["read"]);
  });

  it("agentMode override without activeTools leaves prior activeTools", () => {
    const effective = mergeCapabilitySpecs([
      layer("family", {
        tools: { agentMode: "static", activeTools: ["read", "bash"] },
      }),
      layer("agent", { tools: { agentMode: "dynamic" } }),
    ]);
    assert.equal(effective.tools.agentMode, "dynamic");
    assert.deepEqual(effective.tools.activeTools, ["read", "bash"]);
  });

  it("sorts by kind even when input order is scrambled", () => {
    const effective = mergeCapabilitySpecs([
      layer("agent", { extensions: ["a"] }),
      layer("root", { extensions: ["r"] }),
      layer("family", { extensions: ["f"] }),
    ]);
    assert.deepEqual(effective.extensions.map(String), ["r", "f", "a"]);
  });

  it("preserves relative order among same-kind layers", () => {
    const effective = mergeCapabilitySpecs([
      layer("family", { extensions: ["f1"] }),
      layer("family", { extensions: ["f2"] }),
      layer("root", { extensions: ["r"] }),
    ]);
    assert.deepEqual(effective.extensions.map(String), ["r", "f1", "f2"]);
  });

  it("full root/family/agent fixture merges policy + ids", () => {
    const effective = mergeCapabilitySpecs([
      layer("root", {
        extensions: ["packs/core"],
        skills: ["company-base"],
        tools: {
          builtin: ["read", "bash", "write", "edit"],
          agentMode: "static",
          exclude: [],
        },
      }),
      layer("family", {
        extensions: ["packs/core", "ext/family-memory"],
        skills: ["family-playbook"],
        tools: {
          builtin: ["ls", "grep"],
          agentMode: "dynamic",
          activeTools: ["read", "bash", "tool_finder"],
          custom: ["tool_finder"],
        },
      }),
      layer("agent", {
        extensions: ["ext/agent-local"],
        skills: ["agent-special"],
        tools: {
          exclude: ["write"],
          activeTools: ["read", "bash"],
        },
      }),
    ]);

    assert.deepEqual(effective.extensions.map(String), [
      "packs/core",
      "ext/family-memory",
      "ext/agent-local",
    ]);
    assert.deepEqual(effective.skills, [
      "company-base",
      "family-playbook",
      "agent-special",
    ]);
    assert.deepEqual(effective.tools.builtin, [
      "read",
      "bash",
      "write",
      "edit",
      "ls",
      "grep",
    ]);
    assert.deepEqual(effective.tools.custom, ["tool_finder"]);
    assert.deepEqual(effective.tools.exclude, ["write"]);
    assert.equal(effective.tools.agentMode, "dynamic");
    assert.deepEqual(effective.tools.activeTools, ["read", "bash"]);
  });
});
