/**
 * ABS-R1: RegistryCapabilityStore stub — publish→get round-trip, no HTTP.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createRegistryCapabilityStore,
  RegistryCapabilityStore,
} from "../../../src/adapters/capability/registry-store.ts";
import { asCapabilityId } from "../../../src/domain/capability.ts";
import type { CapabilityStore } from "../../../src/ports/capability-store.ts";
import type { CapabilityPublisher } from "../../../src/ports/capability-store.ts";

describe("RegistryCapabilityStore (ABS-R1)", () => {
  it("get returns null for unknown id", async () => {
    const store = new RegistryCapabilityStore();
    const missing = await store.get(asCapabilityId("registry/missing"));
    assert.equal(missing, null);
  });

  it("publish → get round-trip (in-process registry, no network)", async () => {
    const store = createRegistryCapabilityStore();
    const id = asCapabilityId("tools/pytool/echo");
    const ref = await store.publish({
      ref: {
        id,
        kind: "custom-tool",
        origin: "inline",
        version: "1.0.0",
        locator: { registryKey: "tools/pytool/echo@1.0.0" },
      },
      entry: { kind: "inline", value: { name: "echo", runtime: "py" } },
    });

    assert.equal(ref.id, id);
    assert.equal(ref.origin, "registry");
    assert.equal(ref.version, "1.0.0");

    const got = await store.get(id);
    assert.ok(got);
    assert.equal(got.ref.id, id);
    assert.equal(got.ref.origin, "registry");
    assert.equal(got.entry.kind, "inline");
    if (got.entry.kind === "inline") {
      assert.deepEqual(got.entry.value, { name: "echo", runtime: "py" });
    }
  });

  it("get honors optional version selector", async () => {
    const store = new RegistryCapabilityStore();
    const id = asCapabilityId("ext/registry-bar");

    await store.publish({
      ref: { id, kind: "extension", origin: "registry", version: "1" },
      entry: { kind: "module-path", modulePath: "registry://ext/bar@1" },
    });
    await store.publish({
      ref: { id, kind: "extension", origin: "registry", version: "2" },
      entry: {
        kind: "bytes",
        bytes: new Uint8Array([9, 8, 7]),
        contentType: "application/octet-stream",
      },
    });

    const v1 = await store.get(id, { version: "1" });
    assert.ok(v1);
    assert.equal(v1.ref.version, "1");
    assert.equal(v1.entry.kind, "module-path");

    const v2 = await store.get(id, { version: "2" });
    assert.ok(v2);
    assert.equal(v2.ref.version, "2");
    assert.equal(v2.entry.kind, "bytes");

    const none = await store.get(id, { version: "9" });
    assert.equal(none, null);

    // Unversioned get prefers most recently published version.
    const latest = await store.get(id);
    assert.ok(latest);
    assert.equal(latest.ref.version, "2");
  });

  it("seed artifacts are readable without publish", async () => {
    const id = asCapabilityId("skills/seeded");
    const store = new RegistryCapabilityStore({
      seed: [
        {
          ref: {
            id,
            kind: "skill",
            origin: "registry",
            version: "0.1",
          },
          entry: { kind: "inline", value: { prompt: "seed" } },
        },
      ],
    });
    const got = await store.get(id, { version: "0.1" });
    assert.ok(got);
    assert.equal(got.entry.kind, "inline");
  });

  it("implements CapabilityStore and CapabilityPublisher faces", () => {
    const impl = new RegistryCapabilityStore();
    const asStore: CapabilityStore = impl;
    const asPublisher: CapabilityPublisher = impl;
    assert.equal(typeof asStore.get, "function");
    assert.equal(typeof asPublisher.publish, "function");
    assert.equal(impl.size(), 0);
  });

  it("publish replaces same id+version (upsert)", async () => {
    const store = new RegistryCapabilityStore();
    const id = asCapabilityId("pack/upsert");
    await store.publish({
      ref: { id, origin: "registry", version: "1" },
      entry: { kind: "inline", value: { n: 1 } },
    });
    await store.publish({
      ref: { id, origin: "registry", version: "1" },
      entry: { kind: "inline", value: { n: 2 } },
    });
    const got = await store.get(id, { version: "1" });
    assert.ok(got);
    if (got.entry.kind === "inline") {
      assert.deepEqual(got.entry.value, { n: 2 });
    }
    // Still a single id in the registry map.
    assert.equal(store.size(), 1);
  });
});
