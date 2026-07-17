/**
 * ABS-A8 — Pi bind paths from packPlan only (D5 L4).
 * No live Pi: pure path mapping from PackLoadPlan / A7-style refs.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extensionPathsFromPackPlan } from "../../src/adapters/pi/create-session.ts";
import { packLoadPlanFromCapabilityArtifacts } from "../../src/app/factory.ts";
import { asCapabilityId } from "../../src/domain/capability.ts";
import type { PackLoadPlan } from "../../src/domain/packs.ts";
import type { CapabilityArtifact } from "../../src/ports/capability-store.ts";

describe("extensionPathsFromPackPlan (ABS-A8)", () => {
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
          // locator.path must not win when entry is module-path
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
        // non-module-path entry → factory falls back to locator.path
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
