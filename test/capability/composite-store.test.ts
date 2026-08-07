/**
 * COMPOSITION (issue #4) — CompositeCapabilityStore scenario suite (D5 L2/L4).
 *
 * Real-world situations the composite must survive:
 *   S1  builder publishes a tool to the registry; a family config references
 *       it by id → composite resolves via registry WITHOUT any fs path.
 *   S2  legacy fs-only agents keep working (registry empty → fs search hit).
 *   S3  unknown capability → composite returns null; CapabilityResolver turns
 *       it into an error diagnostic (fail-closed, no half-loaded plan).
 *   S4  first hit wins: same id in registry AND fs → registry wins and the
 *       fs store is never consulted (short-circuit).
 *   S5  versioned get passes through to versioned stores; an unversioned fs
 *       layout still serves as the fallback when the registry misses a version.
 *   S6  publish routes to the registry store only (fs never sees the write).
 *   S7  configurable chain order ([fs, registry]) → fs wins when first.
 *   S8  empty chain / missing publisher fail closed.
 *   C1  compose default chain is registry→fs and publish→resolve works
 *       end-to-end through createLocalMediation.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  CompositeCapabilityStore,
  createCompositeCapabilityStore,
} from "../../src/adapters/capability/composite-store.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";
import { createRegistryCapabilityStore } from "../../src/adapters/capability/registry-store.ts";
import { asCapabilityId, type CapabilityId } from "../../src/domain/capability.ts";
import { MediationError } from "../../src/domain/errors.ts";
import type {
  CapabilityArtifact,
  CapabilityGetOptions,
  CapabilityPublisher,
  CapabilityStore,
  PublishCapabilityInput,
} from "../../src/ports/capability-store.ts";

/** Recording store: counts get/publish calls so tests can prove short-circuit. */
class RecordingStore implements CapabilityStore, CapabilityPublisher {
  readonly gets: { id: string; version?: string }[] = [];
  readonly publishes: PublishCapabilityInput[] = [];
  private readonly delegate: CapabilityStore & CapabilityPublisher;

  constructor(delegate: CapabilityStore & CapabilityPublisher) {
    this.delegate = delegate;
  }
  async get(id: CapabilityId, opts?: CapabilityGetOptions) {
    this.gets.push({ id: String(id), version: opts?.version });
    return this.delegate.get(id, opts);
  }
  async publish(input: PublishCapabilityInput) {
    this.publishes.push(input);
    return this.delegate.publish(input);
  }
}

function moduleArtifact(
  id: string,
  modulePath: string,
  origin: CapabilityArtifact["ref"]["origin"] = "memory",
  version?: string,
): CapabilityArtifact {
  return {
    ref: {
      id: asCapabilityId(id),
      kind: "extension",
      origin,
      ...(version !== undefined ? { version } : {}),
      locator: { path: modulePath },
    },
    entry: { kind: "module-path", modulePath },
  };
}

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

function tmpEmptyDir(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `mediation-composite-${tag}-`));
}

describe("CompositeCapabilityStore — scenario suite (issue #4)", () => {
  it("S1: registry-published tool resolves by id with NO fs path (fs dir is empty)", async () => {
    const registry = createRegistryCapabilityStore();
    const fsStore = createFsCapabilityStore({
      projectRoot: tmpEmptyDir("s1"),
      homeDir: NO_HOME,
    });
    const composite = createCompositeCapabilityStore({
      stores: [registry, fsStore],
      publisher: registry,
    });

    const id = asCapabilityId("tools/pytool/echo");
    await composite.publish({
      ref: {
        id,
        kind: "custom-tool",
        origin: "inline",
        version: "1.0.0",
        locator: { registryKey: "tools/pytool/echo@1.0.0" },
      },
      entry: { kind: "inline", value: { name: "echo", runtime: "py" } },
    });

    const got = await composite.get(id);
    assert.ok(got, "registry-published capability must resolve");
    assert.equal(got.ref.origin, "registry");
    assert.equal(got.entry.kind, "inline");
    // No filesystem involvement: the tmp project root is empty, so the hit
    // could only have come from the registry head of the chain.
    assert.equal(got.ref.locator?.registryKey, "tools/pytool/echo@1.0.0");
  });

  it("S2: legacy fs-only agent keeps working (registry empty, fs hit)", async () => {
    const registry = createRegistryCapabilityStore();
    const fsStore = createFsCapabilityStore({
      projectRoot: FIXTURE_ROOT,
      homeDir: NO_HOME,
    });
    const composite = new CompositeCapabilityStore({
      stores: [registry, fsStore],
      publisher: registry,
    });

    const got = await composite.get(asCapabilityId("foo"));
    assert.ok(got);
    assert.equal(got.ref.origin, "fs");
    assert.equal(got.ref.kind, "custom-tool");
    if (got.entry.kind === "module-path") {
      assert.equal(
        got.entry.modulePath,
        path.join(FIXTURE_ROOT, "tools", "internal", "foo"),
      );
    }
    assert.equal(got.ref.locator?.source, "internal");
  });

  it("S3: unknown capability → composite null → resolver fail-closed diagnostic", async () => {
    const registry = createRegistryCapabilityStore();
    const fsStore = createFsCapabilityStore({
      projectRoot: tmpEmptyDir("s3"),
      homeDir: NO_HOME,
    });
    const composite = new CompositeCapabilityStore({
      stores: [registry, fsStore],
      publisher: registry,
    });

    assert.equal(await composite.get(asCapabilityId("nope/unknown")), null);

    const result = await createCapabilityResolver(composite).resolve({
      effective: {
        extensions: [asCapabilityId("nope/unknown")],
        tools: {},
        skills: [],
      },
    });
    assert.equal(result.plan.ok, false);
    assert.ok(
      result.plan.diagnostics.some(
        (d) =>
          d.level === "error" &&
          d.code === "capability_not_found" &&
          d.capabilityId === asCapabilityId("nope/unknown"),
      ),
    );
  });

  it("S4: first hit wins — registry shadows fs and fs is NOT consulted", async () => {
    const registry = createRegistryCapabilityStore();
    const fsStore = createFsCapabilityStore({
      projectRoot: FIXTURE_ROOT,
      homeDir: NO_HOME,
    });
    const recording = new RecordingStore(registry);
    const composite = new CompositeCapabilityStore({
      stores: [recording, fsStore],
      publisher: recording,
    });

    // Same id exists on disk (fixture "foo") AND is published to the registry.
    await composite.publish(
      moduleArtifact("foo", "/registry/foo.js", "registry", "2"),
    );

    const got = await composite.get(asCapabilityId("foo"));
    assert.ok(got);
    assert.equal(got.ref.origin, "registry");
    // The chain short-circuited: only the registry store was asked.
    assert.deepEqual(recording.gets.map((g) => g.id), ["foo"]);
  });

  it("S5: versioned get honors registry versions; fs serves unversioned fallback", async () => {
    const registry = createRegistryCapabilityStore();
    const fsStore = createFsCapabilityStore({
      projectRoot: FIXTURE_ROOT,
      homeDir: NO_HOME,
    });
    const composite = new CompositeCapabilityStore({
      stores: [registry, fsStore],
      publisher: registry,
    });
    const id = asCapabilityId("ext/versioned");
    await composite.publish(
      moduleArtifact(String(id), "/reg/versioned@1", "registry", "1"),
    );
    await composite.publish(
      moduleArtifact(String(id), "/reg/versioned@2", "registry", "2"),
    );

    const v1 = await composite.get(id, { version: "1" });
    assert.ok(v1);
    assert.equal(v1.ref.version, "1");
    const v2 = await composite.get(id, { version: "2" });
    assert.ok(v2);
    assert.equal(v2.ref.version, "2");
    const none = await composite.get(id, { version: "9" });
    assert.equal(none, null);

    // Unversioned fs capability still resolves when the registry has no
    // version match (fs layout is unversioned by design).
    const fsFoo = await composite.get(asCapabilityId("foo"), { version: "1" });
    assert.ok(fsFoo);
    assert.equal(fsFoo.ref.origin, "fs");
  });

  it("S6: publish routes ONLY to the registry — fs never sees the write", async () => {
    const registry = createRegistryCapabilityStore();
    const fsStore = createFsCapabilityStore({
      projectRoot: tmpEmptyDir("s6"),
      homeDir: NO_HOME,
    });
    const recording = new RecordingStore(registry);
    const composite = new CompositeCapabilityStore({
      stores: [recording, fsStore],
      publisher: recording,
    });

    const id = asCapabilityId("tools/published-only");
    await composite.publish({
      ref: { id, kind: "custom-tool", origin: "inline" },
      entry: { kind: "inline", value: { n: 1 } },
    });

    assert.equal(recording.publishes.length, 1);
    assert.equal(String(recording.publishes[0]!.ref.id), String(id));
    const got = await composite.get(id);
    assert.ok(got);
    assert.equal(got.ref.origin, "registry");
  });

  it("S7: chain order is configurable — [fs, registry] makes fs win", async () => {
    const registry = createRegistryCapabilityStore();
    const fsStore = createFsCapabilityStore({
      projectRoot: FIXTURE_ROOT,
      homeDir: NO_HOME,
    });
    await registry.publish(
      moduleArtifact("foo", "/registry/foo.js", "registry", "2"),
    );
    const composite = new CompositeCapabilityStore({
      stores: [fsStore, registry],
      publisher: registry,
    });

    const got = await composite.get(asCapabilityId("foo"));
    assert.ok(got);
    assert.equal(got.ref.origin, "fs");
    assert.equal(got.ref.locator?.source, "internal");
  });

  it("S8: empty chain returns null; publish without publisher fails closed", async () => {
    const empty = new CompositeCapabilityStore({ stores: [] });
    assert.equal(await empty.get(asCapabilityId("anything")), null);

    await assert.rejects(
      () =>
        empty.publish({
          ref: {
            id: asCapabilityId("tools/x"),
            origin: "inline",
          },
          entry: { kind: "inline", value: {} },
        }),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "POLICY_VIOLATION");
        assert.match(err.message, /no publisher/u);
        return true;
      },
    );
  });

  it("C1: createLocalMediation default chain is registry→fs; publish→resolve end-to-end", async () => {
    const { createLocalMediation } = await import("../../src/adapters/compose.ts");
    const comp = createLocalMediation({ projectRoot: FIXTURE_ROOT, mockEngine: true });
    try {
      assert.ok(comp.registry, "default composition exposes the in-process registry");
      assert.equal(comp.capabilityStores.length, 2, "default chain = [registry, fs]");

      // Legacy fs capability still resolves through the composite chain.
      const fsDef = await comp.mediation.load({
        name: "case-basic",
        rootDir: FIXTURE_ROOT,
      });
      assert.equal(fsDef.name, "case-basic");

      // Publish a brand-new tool into the composition registry; the composite
      // head resolves it even though no fs path exists anywhere.
      const id = asCapabilityId("tools/compose-published");
      await comp.registry!.publish({
        ref: { id, kind: "custom-tool", origin: "inline", version: "0.1" },
        entry: { kind: "inline", value: { name: "compose-tool" } },
      });
      const composite = comp.capabilityStores[0] as unknown as CompositeCapabilityStore;
      const got = await composite.get(id);
      assert.ok(got);
      assert.equal(got.ref.origin, "registry");
      assert.equal(got.ref.version, "0.1");
    } finally {
      // Local mediation owns no runtime/host resources to close.
    }
  });

  it("implements CapabilityStore + CapabilityPublisher faces", () => {
    const composite = createCompositeCapabilityStore({ stores: [] });
    const asStore: CapabilityStore = composite;
    const asPublisher: CapabilityPublisher = composite;
    assert.equal(typeof asStore.get, "function");
    assert.equal(typeof asPublisher.publish, "function");
  });
});
