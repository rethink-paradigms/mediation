/**
 * ABS-A6: DefaultCapabilityResolver — merge layers + store.get fail-closed.
 * Primary store: MemoryCapabilityStore. Optional FsCapabilityStore fixture smoke.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  createCapabilityResolver,
  DefaultCapabilityResolver,
} from "../../../src/adapters/capability/resolve.ts";
import { FsCapabilityStore } from "../../../src/adapters/capability/fs-store.ts";
import { MemoryCapabilityStore } from "../../../src/adapters/capability/memory-store.ts";
import { asCapabilityId } from "../../../src/domain/capability.ts";
import type { ConfigLayer } from "../../../src/domain/config-layer.ts";
import type { CapabilityArtifact } from "../../../src/ports/capability-store.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

function layer(
  kind: ConfigLayer["kind"],
  spec: ConfigLayer["spec"],
): ConfigLayer {
  return { kind, spec };
}

function memArtifact(
  id: string,
  opts?: { kind?: CapabilityArtifact["ref"]["kind"]; origin?: CapabilityArtifact["ref"]["origin"] },
): CapabilityArtifact {
  return {
    ref: {
      id: asCapabilityId(id),
      kind: opts?.kind ?? "extension",
      origin: opts?.origin ?? "memory",
    },
    entry: { kind: "inline", value: { id } },
  };
}

describe("DefaultCapabilityResolver (ABS-A6)", () => {
  it("happy path: merges layers and resolves each extension id from store", async () => {
    const store = new MemoryCapabilityStore([
      memArtifact("ext/root"),
      memArtifact("ext/family"),
      memArtifact("ext/agent"),
    ]);
    const resolver = new DefaultCapabilityResolver({ store });

    const result = await resolver.resolve({
      layers: [
        layer("root", {
          extensions: ["ext/root"],
          skills: ["skill-a"],
          tools: { builtin: ["read"] },
        }),
        layer("family", {
          extensions: ["ext/family", "ext/root"],
          tools: { agentMode: "dynamic" },
        }),
        layer("agent", {
          extensions: ["ext/agent"],
          skills: ["skill-b"],
          tools: { activeTools: ["read"] },
        }),
      ],
    });

    assert.deepEqual(result.effective.extensions, [
      asCapabilityId("ext/root"),
      asCapabilityId("ext/family"),
      asCapabilityId("ext/agent"),
    ]);
    assert.deepEqual(result.effective.skills, ["skill-a", "skill-b"]);
    assert.equal(result.effective.tools.agentMode, "dynamic");
    assert.deepEqual(result.effective.tools.activeTools, ["read"]);

    assert.equal(result.plan.ok, true);
    assert.equal(result.plan.diagnostics.length, 0);
    assert.equal(result.diagnostics.length, 0);
    assert.equal(result.plan.capabilities.length, 3);
    assert.equal(result.artifacts.length, 3);
    assert.deepEqual(
      result.plan.capabilities.map((c) => c.id),
      ["ext/root", "ext/family", "ext/agent"],
    );
    assert.deepEqual(
      result.artifacts.map((a) => a.ref.id),
      result.plan.capabilities.map((c) => c.id),
    );
    for (const ref of result.plan.capabilities) {
      assert.equal(ref.origin, "memory");
    }
    // Convenience face mirrors plan diagnostics
    assert.equal(result.diagnostics, result.plan.diagnostics);
  });

  it("missing extension id → fail-closed diagnostic + plan.ok false", async () => {
    const store = new MemoryCapabilityStore([memArtifact("ext/present")]);
    const resolver = createCapabilityResolver(store);

    const result = await resolver.resolve({
      layers: [
        layer("agent", {
          extensions: ["ext/present", "ext/missing"],
        }),
      ],
    });

    assert.equal(result.plan.ok, false);
    assert.equal(result.plan.capabilities.length, 1);
    assert.equal(result.plan.capabilities[0]?.id, "ext/present");
    assert.equal(result.diagnostics.length, 1);
    const d = result.diagnostics[0];
    assert.ok(d);
    assert.equal(d.level, "error");
    assert.equal(d.code, "capability_not_found");
    assert.equal(d.capabilityId, asCapabilityId("ext/missing"));
    assert.match(d.message, /ext\/missing/u);
  });

  it("all missing → empty capabilities, multiple errors", async () => {
    const store = new MemoryCapabilityStore();
    const resolver = createCapabilityResolver(store);

    const result = await resolver.resolve({
      layers: [
        layer("root", { extensions: ["a", "b"] }),
      ],
    });

    assert.equal(result.plan.ok, false);
    assert.equal(result.plan.capabilities.length, 0);
    assert.equal(result.diagnostics.length, 2);
    assert.ok(result.diagnostics.every((d) => d.level === "error"));
    assert.ok(
      result.diagnostics.every((d) => d.code === "capability_not_found"),
    );
  });

  it("empty layers → empty effective + ok plan", async () => {
    const store = new MemoryCapabilityStore();
    const resolver = createCapabilityResolver(store);
    const result = await resolver.resolve({ layers: [] });
    assert.deepEqual(result.effective.extensions, []);
    assert.equal(result.plan.ok, true);
    assert.equal(result.plan.capabilities.length, 0);
    assert.equal(result.diagnostics.length, 0);
  });

  it("pre-merged effective skips layer merge", async () => {
    const store = new MemoryCapabilityStore([
      memArtifact("only-via-effective"),
    ]);
    const resolver = createCapabilityResolver(store);

    const result = await resolver.resolve({
      effective: {
        extensions: [asCapabilityId("only-via-effective")],
        tools: { agentMode: "static" },
        skills: ["s"],
      },
    });

    assert.equal(result.plan.ok, true);
    assert.equal(result.effective.tools.agentMode, "static");
    assert.deepEqual(result.effective.skills, ["s"]);
    assert.equal(result.plan.capabilities[0]?.id, "only-via-effective");
  });

  it("layers win over effective when both provided", async () => {
    const store = new MemoryCapabilityStore([
      memArtifact("from-layers"),
      memArtifact("from-effective"),
    ]);
    const resolver = createCapabilityResolver(store);

    const result = await resolver.resolve({
      layers: [layer("agent", { extensions: ["from-layers"] })],
      effective: {
        extensions: [asCapabilityId("from-effective")],
        tools: {},
        skills: [],
      },
    });

    assert.deepEqual(result.effective.extensions, [
      asCapabilityId("from-layers"),
    ]);
    assert.equal(result.plan.capabilities[0]?.id, "from-layers");
  });

  it("optional FsCapabilityStore fixture smoke (bar + missing)", async () => {
    const store = new FsCapabilityStore({
      projectRoot: FIXTURE_ROOT,
      homeDir: NO_HOME,
    });
    const resolver = createCapabilityResolver(store);

    const okResult = await resolver.resolve({
      layers: [layer("agent", { extensions: ["bar"] })],
    });
    assert.equal(okResult.plan.ok, true);
    assert.equal(okResult.plan.capabilities.length, 1);
    assert.equal(okResult.plan.capabilities[0]?.id, "bar");
    assert.equal(okResult.plan.capabilities[0]?.origin, "fs");

    const failResult = await resolver.resolve({
      layers: [layer("agent", { extensions: ["bar", "nope-not-real"] })],
    });
    assert.equal(failResult.plan.ok, false);
    assert.equal(failResult.plan.capabilities.length, 1);
    assert.equal(failResult.diagnostics.length, 1);
    assert.equal(failResult.diagnostics[0]?.code, "capability_not_found");
    assert.equal(
      failResult.diagnostics[0]?.capabilityId,
      asCapabilityId("nope-not-real"),
    );
  });
});
