/**
 * CUT / ABS-A7: DefaultPresenceFactory + required CapabilityResolver.
 * MemoryCapabilityStore / FsCapabilityStore → Settled;
 * missing capability fail-closed (no openSession).
 * No PackResolver dual path.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";
import { MemoryCapabilityStore } from "../../src/adapters/capability/memory-store.ts";
import { MockEnginePort } from "../../src/adapters/mock/engine-adapter.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";
import {
  capabilitySpecFromDefinition,
  DefaultPresenceFactory,
  packLoadPlanFromCapabilityArtifacts,
} from "../../src/app/factory.ts";
import { asCapabilityId } from "../../src/domain/capability.ts";
import { MediationError } from "../../src/domain/errors.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import type { CapabilityArtifact } from "../../src/ports/capability-store.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

function moduleArtifact(
  id: string,
  modulePath: string,
  source: string = "internal",
): CapabilityArtifact {
  return {
    ref: {
      id: asCapabilityId(id),
      kind: "extension",
      origin: "memory",
      locator: { path: modulePath, source },
    },
    entry: { kind: "module-path", modulePath },
  };
}

describe("DefaultPresenceFactory + CapabilityResolver (CUT)", () => {
  it("materialize with MemoryCapabilityStore + createCapabilityResolver → Settled", async () => {
    const fooPath = path.join(FIXTURE_ROOT, "tools", "internal", "foo");
    const barPath = path.join(FIXTURE_ROOT, "extensions", "bar");
    const store = new MemoryCapabilityStore([
      moduleArtifact("foo", fooPath, "internal"),
      moduleArtifact("bar", barPath, "project-extensions"),
    ]);
    const engine = new MockEnginePort({
      sessionRefFactory: () => asSessionRef("mock-session-a7"),
    });
    const factory = new DefaultPresenceFactory({
      engine,
      toPackSnapshot,
      capabilityResolver: createCapabilityResolver(store),
    });

    const definition = agentDefForPacks(
      FIXTURE_ROOT,
      ["foo", "bar"],
      "case-a7-capability",
    );

    const presence = await factory.materialize(definition);
    assert.equal(presence.status, "idle");
    assert.equal(presence.sessionRef, "mock-session-a7");
    assert.equal(presence.packSnapshot.packs.length, 2);
    assert.equal(presence.packSnapshot.packs[0]?.id, "foo");
    assert.equal(presence.packSnapshot.packs[0]?.path, fooPath);
    assert.equal(presence.packSnapshot.packs[0]?.source, "internal");
    assert.equal(presence.packSnapshot.packs[1]?.id, "bar");
    assert.equal(presence.packSnapshot.packs[1]?.path, barPath);
    assert.equal(presence.packSnapshot.packs[1]?.source, "project-extensions");
    assert.equal(engine.opened.length, 1);

    const outcome = await presence.engage({ text: "hello a7 capability" });
    assert.equal(outcome.kind, "settled");
    if (outcome.kind === "settled") {
      assert.equal(outcome.sessionRef, "mock-session-a7");
    }
    assert.equal(presence.status, "idle");

    await presence.dispose();
    assert.equal(presence.status, "disposed");
  });

  it("materialize with default FsCapabilityStore path → Settled", async () => {
    const engine = new MockEnginePort({
      sessionRefFactory: () => asSessionRef("mock-session-fs"),
    });
    const factory = new DefaultPresenceFactory({
      engine,
      toPackSnapshot,
      capabilityResolver: createCapabilityResolver(
        createFsCapabilityStore({
          projectRoot: FIXTURE_ROOT,
          homeDir: NO_HOME,
        }),
      ),
    });

    const definition = agentDefForPacks(
      FIXTURE_ROOT,
      ["foo", "bar"],
      "case-cut-fs",
    );
    const presence = await factory.materialize(definition);
    assert.equal(presence.packSnapshot.packs.length, 2);
    const outcome = await presence.engage({ text: "fs capability path" });
    assert.equal(outcome.kind, "settled");
    await presence.dispose();
  });

  it("missing capability fails materialize (no openSession)", async () => {
    const store = new MemoryCapabilityStore([
      moduleArtifact("foo", "/virtual/foo"),
    ]);
    const engine = new MockEnginePort();
    const factory = new DefaultPresenceFactory({
      engine,
      toPackSnapshot,
      capabilityResolver: createCapabilityResolver(store),
    });

    const definition = agentDefForPacks(
      FIXTURE_ROOT,
      ["foo", "nope-missing"],
      "case-a7-missing",
    );

    await assert.rejects(
      () => factory.materialize(definition),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "CAPABILITY_RESOLVE_FAILED");
        assert.match(err.message, /Capability resolve failed/);
        return true;
      },
    );
    assert.equal(engine.opened.length, 0);
  });

  it("capabilitySpecFromDefinition maps extensions, tools, skills", () => {
    const definition = {
      ...agentDefForPacks(FIXTURE_ROOT, ["ext-a"], "spec-map"),
      skills: ["skill-x"],
      tools: { builtin: ["read"], agentMode: "dynamic" as const },
    };
    const spec = capabilitySpecFromDefinition(definition);
    assert.deepEqual(spec.extensions, ["ext-a"]);
    assert.deepEqual(spec.skills, ["skill-x"]);
    assert.deepEqual(spec.tools?.builtin, ["read"]);
    assert.equal(spec.tools?.agentMode, "dynamic");
  });

  it("packLoadPlanFromCapabilityArtifacts maps module-path + locator fallback", () => {
    const withEntry: CapabilityArtifact = moduleArtifact(
      "via-entry",
      "/mod/via-entry",
      "families",
    );
    const locatorOnly: CapabilityArtifact = {
      ref: {
        id: asCapabilityId("via-locator"),
        kind: "extension",
        origin: "memory",
        locator: { path: "/mod/via-locator", source: "agent" },
      },
      entry: { kind: "inline", value: { note: "no module-path entry" } },
    };
    const noPath: CapabilityArtifact = {
      ref: {
        id: asCapabilityId("no-path"),
        kind: "extension",
        origin: "memory",
      },
      entry: { kind: "inline", value: {} },
    };

    const okPlan = packLoadPlanFromCapabilityArtifacts(
      [withEntry, locatorOnly],
      {
        capabilities: [withEntry.ref, locatorOnly.ref],
        diagnostics: [],
        ok: true,
      },
    );
    assert.equal(okPlan.ok, true);
    assert.equal(okPlan.packs.length, 2);
    assert.equal(okPlan.packs[0]?.path, "/mod/via-entry");
    assert.equal(okPlan.packs[0]?.source, "families");
    assert.equal(okPlan.packs[1]?.path, "/mod/via-locator");
    assert.equal(okPlan.packs[1]?.source, "agent");

    const failPlan = packLoadPlanFromCapabilityArtifacts([noPath], {
      capabilities: [noPath.ref],
      diagnostics: [],
      ok: true,
    });
    assert.equal(failPlan.ok, false);
    assert.equal(failPlan.packs.length, 0);
    assert.equal(failPlan.diagnostics[0]?.code, "capability_path_missing");
  });
});
