/**
 * Unit: Prime create-session pure mappings (no live prime-agent).
 *   - ABS-A8 extension paths from PackLoadPlan (same invariant as Pi).
 *   - findModel loop over ModelRegistry.getAll() (fork has no getModel).
 *   - primeToolsFromPolicy: allowlist mapping (fork has NO excludeTools).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extensionPathsFromPackPlan,
  findModel,
  primeToolsFromPolicy,
} from "../../src/adapters/prime/create-session.ts";
import { packLoadPlanFromCapabilityArtifacts } from "../../src/app/factory.ts";
import { asCapabilityId } from "../../src/domain/capability.ts";
import type { PackLoadPlan } from "../../src/domain/packs.ts";
import type { CapabilityArtifact } from "../../src/ports/capability-store.ts";

describe("extensionPathsFromPackPlan (ABS-A8, prime)", () => {
  it("reads only PackRef.path in plan order; skips empty", () => {
    const plan: PackLoadPlan = {
      packs: [
        { id: "a", path: "/abs/a/index.ts", source: "explicit" },
        { id: "empty", path: "", source: "agent" },
        { id: "b", path: "/abs/b/index.ts", source: "project-extensions" },
      ],
      diagnostics: [],
      ok: true,
    };
    assert.deepEqual(extensionPathsFromPackPlan(plan), [
      "/abs/a/index.ts",
      "/abs/b/index.ts",
    ]);
  });

  it("accepts PackLoadPlan adapted from capability artifacts (A7 mapping)", () => {
    const artifacts: CapabilityArtifact[] = [
      {
        ref: {
          id: asCapabilityId("ext.foo"),
          kind: "extension",
          origin: "memory",
          locator: { path: "/should/not/win", source: "explicit" },
        },
        entry: {
          kind: "module-path",
          modulePath: "/from/entry/modulePath.ts",
        },
      },
      {
        ref: {
          id: asCapabilityId("ext.bar"),
          kind: "extension",
          origin: "memory",
          locator: { path: "/from/locator/path.ts", source: "agent" },
        },
        entry: { kind: "inline", value: {} },
      },
    ];
    const plan = packLoadPlanFromCapabilityArtifacts(artifacts, {
      capabilities: artifacts.map((a) => a.ref),
      diagnostics: [],
      ok: true,
    });
    assert.equal(plan.ok, true);
    assert.deepEqual(extensionPathsFromPackPlan(plan), [
      "/from/entry/modulePath.ts",
      "/from/locator/path.ts",
    ]);
  });

  it("empty plan → no extension paths", () => {
    assert.deepEqual(
      extensionPathsFromPackPlan({ packs: [], diagnostics: [], ok: true }),
      [],
    );
  });
});

describe("findModel (fork: no getModel helper — find loop over getAll())", () => {
  const fakeRegistry = {
    getAll: () => [
      { provider: "deepseek", id: "deepseek-v4-flash" },
      { provider: "anthropic", id: "claude-opus-4-5" },
    ],
  };

  it("finds by provider + id", () => {
    const m = findModel(fakeRegistry, "deepseek", "deepseek-v4-flash");
    assert.deepEqual(m, { provider: "deepseek", id: "deepseek-v4-flash" });
  });

  it("undefined for unknown provider/id", () => {
    assert.equal(findModel(fakeRegistry, "deepseek", "nope"), undefined);
    assert.equal(findModel(fakeRegistry, "openai", "gpt-x"), undefined);
  });
});

describe("primeToolsFromPolicy (fork: no excludeTools — allowlist mapping)", () => {
  it("builtin allowlist → tools; no noTools", () => {
    const m = primeToolsFromPolicy({ agentMode: "static", builtin: ["ipython", "bash"] });
    assert.deepEqual(m.tools, ["ipython", "bash"]);
    assert.equal(m.noTools, undefined);
    assert.deepEqual(m.droppedExcludes, []);
  });

  it("no builtin list → noTools all (start with none), no tools", () => {
    const m = primeToolsFromPolicy({ agentMode: "static" });
    assert.equal(m.tools, undefined);
    assert.equal(m.noTools, "all");
    assert.deepEqual(m.droppedExcludes, []);
  });

  it("exclude + builtin → allowlist subtraction", () => {
    const m = primeToolsFromPolicy({
      agentMode: "static",
      builtin: ["ipython", "bash", "edit"],
      exclude: ["bash"],
    });
    assert.deepEqual(m.tools, ["ipython", "edit"]);
    assert.equal(m.noTools, undefined);
    assert.deepEqual(m.droppedExcludes, []);
  });

  it("exclude without builtin → dropped (fork cannot express), surfaced not silent", () => {
    const m = primeToolsFromPolicy({
      agentMode: "static",
      exclude: ["bash"],
    });
    assert.equal(m.tools, undefined);
    assert.equal(m.noTools, "all");
    assert.deepEqual(m.droppedExcludes, ["bash"]);
  });

  it("empty builtin list behaves like no allowlist", () => {
    const m = primeToolsFromPolicy({ agentMode: "static", builtin: [] });
    assert.equal(m.tools, undefined);
    assert.equal(m.noTools, "all");
  });
});
