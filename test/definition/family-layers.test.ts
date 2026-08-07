/**
 * COMPOSITION (issue #4) — multi-file family yaml load scenario suite (D5 L3).
 *
 * Convention (EVIDENCE-COMPOSITION.md): each layer is an agent.yaml-shaped
 * file; the agent layer declares `extends: <name-or-path>` (family) and
 * `root: <name-or-path>` (root); the loader option `rootConfigPath` supplies
 * an implicit company root. Layers merge root → family → agent.
 *
 * Real-world situations:
 *   F1  root sets model, family sets thinking+engine, agent overrides tools
 *       → merged model/engine/thinking/tools correct (precedence).
 *   F2  extends cycle A→B→A fails closed (DEFINITION_INVALID).
 *   F3  self-extends fails closed.
 *   F4  missing family fails closed (DEFINITION_NOT_FOUND).
 *   F5  three-level family chain: base engine flows through mid to agent.
 *   F6  single-file agents (no extends/root) load exactly as before.
 *   F7  explicit loadDefinition rootRef/familyRef override declared refs.
 *   F8  loader rootConfigPath is the implicit company root; agent `root:`
 *       overrides it.
 *   F9  factory materialize uses the MERGED spec: family+root extensions
 *       resolve, family engine selects the engine port, unknown capability
 *       fails closed (CAPABILITY_RESOLVE_FAILED).
 *   F10 prompt files resolve relative to the DECLARING layer directory.
 *   F11 root/family layers may omit name/model (agent supplies them).
 *   F12 missing root file fails closed.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";
import { MemoryCapabilityStore } from "../../src/adapters/capability/memory-store.ts";
import { MockEnginePort, MockEngineSessionHandle } from "../../src/adapters/mock/engine-adapter.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import {
  YamlDefinitionLoader,
  createYamlDefinitionLoader,
  resolveLayerFile,
} from "../../src/adapters/definition/yaml-definition-loader.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { asCapabilityId } from "../../src/domain/capability.ts";
import { MediationError } from "../../src/domain/errors.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import type { CapabilityArtifact } from "../../src/ports/capability-store.ts";
import type { EnginePort, EngineRegistry } from "../../src/ports/engine.ts";
import type { OpenSessionRequest } from "../../src/ports/engine.ts";

const HERE = import.meta.dirname;
const CASE_BASIC = path.resolve(HERE, "../../fixtures/definition/case-basic");

/** Build a tmp layer tree; returns the tmp root. */
function buildTree(
  files: Record<string, string>,
  tag = "fam",
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `mediation-${tag}-`));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }
  return root;
}

/** Recording engine port that captures the openSession request. */
class CapturingEngine implements EnginePort {
  readonly opened: OpenSessionRequest[] = [];
  async openSession(req: OpenSessionRequest) {
    this.opened.push(req);
    return new MockEngineSessionHandle(asSessionRef("capture-sess"));
  }
}

function artifact(id: string, modulePath: string): CapabilityArtifact {
  return {
    ref: {
      id: asCapabilityId(id),
      kind: "extension",
      origin: "memory",
      locator: { path: modulePath, source: "internal" },
    },
    entry: { kind: "module-path", modulePath },
  };
}

describe("family-layers — scenario suite (issue #4)", () => {
  it("F1: root sets model, family sets thinking+engine, agent overrides tools (precedence)", async () => {
    const tmp = buildTree({
      "root.yaml": `name: root-layer
model: root/model
engine: prime
extensions: [ext-root]
tools:
  builtin: [read]
skills: [skill-root]
`,
      "agents/base-fam/agent.yaml": `name: base-fam
thinking: high
engine: prime
extensions: [ext-family]
tools:
  builtin: [bash]
  activeTools: [family-tool]
`,
      "agents/agent-a/agent.yaml": `name: agent-a
extends: base-fam
root: ../../root.yaml
extensions: [ext-agent]
active_tools: [agent-tool]
tools:
  builtin: [write]
`,
    });
    const loader = createYamlDefinitionLoader();
    const def = await loader.load({
      name: "agent-a",
      rootDir: path.join(tmp, "agents", "agent-a"),
    });

   
   // root → model; family → thinking + engine; agent → tools.
    assert.equal(def.model, "root/model");
    assert.equal(def.thinking, "high");
    assert.equal(def.engine, "prime");
    assert.equal(def.root, "../../root.yaml");
    assert.equal(def.extends, "base-fam");

   
   // extensions: ordered unique union root → family → agent.
    assert.deepEqual(def.extensions, ["ext-root", "ext-family", "ext-agent"]);
    assert.deepEqual(def.skills, ["skill-root"]);

   
   // tools: builtin union; activeTools agent wins (top-level mirror).
    assert.deepEqual(def.tools?.builtin, ["read", "bash", "write"]);
    assert.deepEqual(def.tools?.activeTools, ["agent-tool"]);

   
   // name comes from the agent layer only.
    assert.equal(def.name, "agent-a");
    assert.equal(def.id, "agent-a");
  });

  it("F2: extends cycle A→B→A fails closed (DEFINITION_INVALID)", async () => {
    const tmp = buildTree({
      "agents/agent-a/agent.yaml": `name: agent-a
extends: base-fam
model: test/model
`,
      "agents/base-fam/agent.yaml": `name: base-fam
extends: agent-a
model: test/model
`,
    });
    const loader = createYamlDefinitionLoader();
    await assert.rejects(
      () =>
        loader.load({ name: "agent-a", rootDir: path.join(tmp, "agents", "agent-a") }),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "DEFINITION_INVALID");
        assert.match(err.message, /cycle/u);
        return true;
      },
    );
  });

  it("F3: self-extends fails closed", async () => {
    const tmp = buildTree({
      "agents/selfy/agent.yaml": `name: selfy
extends: selfy
model: test/model
`,
    });
    const loader = createYamlDefinitionLoader();
    await assert.rejects(
      () =>
        loader.load({ name: "selfy", rootDir: path.join(tmp, "agents", "selfy") }),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "DEFINITION_INVALID");
        assert.match(err.message, /cycle/u);
        return true;
      },
    );
  });

  it("F4: missing family fails closed (DEFINITION_NOT_FOUND)", async () => {
    const tmp = buildTree({
      "agents/ghosty/agent.yaml": `name: ghosty
extends: no-such-family
model: test/model
`,
    });
    const loader = createYamlDefinitionLoader();
    await assert.rejects(
      () =>
        loader.load({ name: "ghosty", rootDir: path.join(tmp, "agents", "ghosty") }),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "DEFINITION_NOT_FOUND");
        assert.match(err.message, /family layer not found/u);
        return true;
      },
    );
  });

  it("F5: three-level chain — base engine flows through mid; agent wins scalars", async () => {
    const tmp = buildTree({
      "agents/base/agent.yaml": `name: base
engine: mock
thinking: minimal
model: base/model
tools:
  builtin: [base-tool]
`,
      "agents/mid/agent.yaml": `name: mid
extends: base
model: mid/model
tools:
  builtin: [mid-tool]
`,
      "agents/top/agent.yaml": `name: top
extends: mid
thinking: high
tools:
  builtin: [top-tool]
`,
    });
    const loader = createYamlDefinitionLoader();
    const def = await loader.load({
      name: "top",
      rootDir: path.join(tmp, "agents", "top"),
    });

    assert.equal(def.model, "mid/model");
    // mid overrides base; top omits.
    assert.equal(def.thinking, "high");
    // agent wins.
    assert.equal(def.engine, "mock");
    // base engine flows through both.
    assert.deepEqual(def.tools?.builtin, [
      "base-tool",
      "mid-tool",
      "top-tool",
    ]);
    assert.equal(def.extends, "mid");
    // agent's own extends survives.
  });

  it("F6: single-file agents (no extends/root) load exactly as before", async () => {
   
   // The case-basic fixture has no extends/root — golden fields unchanged.
    const loader = createYamlDefinitionLoader();
    const def = await loader.load({ name: "case-basic", rootDir: CASE_BASIC });
    assert.equal(def.name, "case-basic");
    assert.equal(def.model, "deepseek/deepseek-v4-flash");
    assert.equal(def.thinking, "low");
    assert.equal(def.engine, undefined);
    assert.deepEqual(def.extensions, ["context-memory", "foo"]);
    assert.deepEqual(def.skills, ["./skill/"]);
    assert.deepEqual(def.tools?.builtin, [
      "read",
      "bash",
      "write",
      "edit",
      "ls",
      "find",
      "grep",
    ]);
    assert.deepEqual(def.tools?.custom, ["web_search"]);
    assert.equal(def.tools?.agentMode, "dynamic");
    assert.deepEqual(def.tools?.activeTools, ["read", "bash", "tool_finder"]);
    assert.equal(def.noCoreSkills, false);
    assert.deepEqual(def.memory, {
      enabled: true,
      namespace: "agent/case-basic",
      recallLimit: 3,
    });
    assert.equal(def.maxTokens, 4096);
    assert.deepEqual(def.meta, { tracing: false });
    assert.ok(def.prompt?.includes("case-basic"));

   
   // A minimal single-file agent with NO tools/extensions/skills stays
   
   // field-absent (no empty-object leakage from the merge).
    const minimal = buildTree({
      "agent.yaml": `name: solo
model: test/solo
`,
    });
    const solo = await loader.load({ name: "solo", rootDir: minimal });
    assert.equal(solo.name, "solo");
    assert.ok(!("tools" in solo));
    assert.ok(!("extensions" in solo));
    assert.ok(!("skills" in solo));
    assert.ok(!("root" in solo));
  });

  it("F7: explicit loadDefinition rootRef/familyRef override declared refs", async () => {
    const tmp = buildTree({
      "root.yaml": `name: root-layer
model: root/model
`,
      "other-root.yaml": `name: other-root
model: other/model
`,
      "agents/base-fam/agent.yaml": `name: base-fam
thinking: high
`,
      "agents/other-fam/agent.yaml": `name: other-fam
thinking: low
`,
      "agents/agent-b/agent.yaml": `name: agent-b
extends: base-fam
root: ../../root.yaml
`,
    });
    const loader = createYamlDefinitionLoader();
    const agentRoot = path.join(tmp, "agents", "agent-b");

    const def = await loader.loadDefinition(
      { name: "agent-b", rootDir: agentRoot },
      { familyRef: "other-fam", rootRef: "../../other-root.yaml" },
    );
    assert.equal(def.model, "other/model");
    // explicit root wins.
    assert.equal(def.thinking, "low");
    // explicit family wins.
    assert.equal(def.extends, "base-fam");
    // declared extends still carried.
    assert.equal(def.root, "../../root.yaml");
  });

  it("F8: loader rootConfigPath is the implicit company root; agent root: overrides", async () => {
    const tmp = buildTree({
      "company-root.yaml": `name: company-root
model: company/model
extensions: [ext-company]
`,
      "agents/plain/agent.yaml": `name: plain
`,
      "agents/custom/agent.yaml": `name: custom
root: ../../custom-root.yaml
`,
      "custom-root.yaml": `name: custom-root
model: custom/model
`,
    });
    const loader = new YamlDefinitionLoader({
      rootConfigPath: path.join(tmp, "company-root.yaml"),
    });

    const plain = await loader.load({
      name: "plain",
      rootDir: path.join(tmp, "agents", "plain"),
    });
    assert.equal(plain.model, "company/model");
    assert.deepEqual(plain.extensions, ["ext-company"]);

    const custom = await loader.load({
      name: "custom",
      rootDir: path.join(tmp, "agents", "custom"),
    });
    assert.equal(custom.model, "custom/model");
    // agent root: wins.
    assert.ok(!("extensions" in custom));
    // no company root merged.
  });

  it("F9a: factory materialize uses the MERGED spec — family+root extensions resolve, family engine selects the port", async () => {
    const tmp = buildTree({
      "root.yaml": `name: root-layer
model: root/model
extensions: [ext-root]
`,
      "agents/fam9/agent.yaml": `name: fam9
thinking: medium
engine: prime
extensions: [ext-family]
`,
      "agents/agent9/agent.yaml": `name: agent9
extends: fam9
root: ../../root.yaml
extensions: [ext-agent]
tools:
  builtin: [write]
`,
    });
    const loader = createYamlDefinitionLoader();
    const def = await loader.load({
      name: "agent9",
      rootDir: path.join(tmp, "agents", "agent9"),
    });
    assert.equal(def.engine, "prime");
    assert.equal(def.thinking, "medium");

    const engine = new CapturingEngine();
    const registry: EngineRegistry = {
      kinds: ["prime", "mock"],
      has: (k) => k === "prime" || k === "mock",
      get: async (k) => {
        if (k === "prime") return engine;
        return new MockEnginePort();
      },
    };
    const store = new MemoryCapabilityStore([
      artifact("ext-root", path.join(tmp, "root-ext.js")),
      artifact("ext-family", path.join(tmp, "family-ext.js")),
      artifact("ext-agent", path.join(tmp, "agent-ext.js")),
    ]);
    const factory = new DefaultPresenceFactory({
      registry,
      defaultEngine: "mock",
      toPackSnapshot,
      capabilityResolver: createCapabilityResolver(store),
    });

    const presence = await factory.materialize(def);
    assert.equal(presence.status, "idle");
    assert.equal(engine.opened.length, 1, "family engine (prime) must be used");
    assert.deepEqual(
      presence.packSnapshot.packs.map((pk) => pk.id),
      ["ext-root", "ext-family", "ext-agent"],
    );
   
   // Merged tools flow into openSession.
    assert.deepEqual(engine.opened[0]!.tools.builtin, ["write"]);
    assert.equal(engine.opened[0]!.settings.thinking, "medium");
    await presence.dispose();
  });

  it("F9b: unknown capability from the merged spec fails closed at materialize", async () => {
    const tmp = buildTree({
      "agents/fam9b/agent.yaml": `name: fam9b
extensions: [ext-present]
`,
      "agents/agent9b/agent.yaml": `name: agent9b
extends: fam9b
model: test/model
extensions: [ext-ghost]
`,
    });
    const loader = createYamlDefinitionLoader();
    const def = await loader.load({
      name: "agent9b",
      rootDir: path.join(tmp, "agents", "agent9b"),
    });
    assert.deepEqual(def.extensions, ["ext-present", "ext-ghost"]);

    const store = new MemoryCapabilityStore([
      artifact("ext-present", path.join(tmp, "present.js")),
    ]);
    const factory = new DefaultPresenceFactory({
      engine: new MockEnginePort(),
      toPackSnapshot,
      capabilityResolver: createCapabilityResolver(store),
    });
    await assert.rejects(
      () => factory.materialize(def),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "CAPABILITY_RESOLVE_FAILED");
        return true;
      },
    );
  });

  it("F10: prompt files resolve relative to the DECLARING layer directory", async () => {
    const tmp = buildTree({
      "agents/fam10/agent.yaml": `name: fam10
prompt: family-prompt.md
`,
      "agents/fam10/family-prompt.md": "FAMILY PROMPT TEXT",
      "agents/agent10/agent.yaml": `name: agent10
extends: fam10
model: test/model
`,
    });
    const loader = createYamlDefinitionLoader();
    const def = await loader.load({
      name: "agent10",
      rootDir: path.join(tmp, "agents", "agent10"),
    });
    assert.equal(def.prompt, "FAMILY PROMPT TEXT");

   
   // Agent inline prompt wins over family prompt (later layer).
    fs.writeFileSync(
      path.join(tmp, "agents", "agent10", "agent.yaml"),
      `name: agent10
extends: fam10
model: test/model
prompt: INLINE AGENT PROMPT
`,
      "utf8",
    );
    const def2 = await loader.load({
      name: "agent10",
      rootDir: path.join(tmp, "agents", "agent10"),
    });
    assert.equal(def2.prompt, "INLINE AGENT PROMPT");
  });

  it("F11: root/family layers may omit name/model (agent supplies them)", async () => {
    const tmp = buildTree({
      "root.yaml": `model: root/model
`,
      "agents/fam11/agent.yaml": `thinking: minimal
`,
      "agents/agent11/agent.yaml": `name: agent11
extends: fam11
root: ../../root.yaml
model: agent/model
`,
    });
    const loader = createYamlDefinitionLoader();
    const def = await loader.load({
      name: "agent11",
      rootDir: path.join(tmp, "agents", "agent11"),
    });
    assert.equal(def.name, "agent11");
    assert.equal(def.model, "agent/model");
    assert.equal(def.thinking, "minimal");
  });

  it("F12: missing root file fails closed (DEFINITION_NOT_FOUND)", async () => {
    const tmp = buildTree({
      "agents/agent12/agent.yaml": `name: agent12
root: ./missing-root.yaml
model: test/model
`,
    });
    const loader = createYamlDefinitionLoader();
    await assert.rejects(
      () =>
        loader.load({ name: "agent12", rootDir: path.join(tmp, "agents", "agent12") }),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "DEFINITION_NOT_FOUND");
        assert.match(err.message, /root layer not found/u);
        return true;
      },
    );
  });

  it("resolveLayerFile: bare name → sibling dir; path-like → from dir", () => {
    assert.equal(
      resolveLayerFile("fam-x", "/company/agents/agent-a", "agent.yaml"),
      path.join("/company/agents", "fam-x", "agent.yaml"),
    );
    assert.equal(
      resolveLayerFile("../../root.yaml", "/company/agents/agent-a", "agent.yaml"),
      path.join("/company", "root.yaml"),
    );
    assert.equal(
      resolveLayerFile("family.yaml", "/company/agents/agent-a", "agent.yaml"),
      path.join("/company/agents/agent-a", "family.yaml"),
    );
  });
});
