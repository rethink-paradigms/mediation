/**
 * ABS-A4: MemoryCapabilityStore — get/put round-trip + optional Publisher.
 * No FS.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryCapabilityStore } from "../../../src/adapters/capability/memory-store.ts";
import { asCapabilityId } from "../../../src/domain/capability.ts";
import type { CapabilityArtifact } from "../../../src/ports/capability-store.ts";

describe("MemoryCapabilityStore (ABS-A4)", () => {
  const foo: CapabilityArtifact = {
    ref: {
      id: asCapabilityId("tools/internal/foo"),
      kind: "custom-tool",
      origin: "memory",
      version: "1",
    },
    entry: { kind: "inline", value: { name: "foo" } },
  };

  const barV1: CapabilityArtifact = {
    ref: {
      id: asCapabilityId("ext/bar"),
      kind: "extension",
      origin: "memory",
      version: "1",
    },
    entry: { kind: "inline", value: { v: 1 } },
  };

  const barV2: CapabilityArtifact = {
    ref: {
      id: asCapabilityId("ext/bar"),
      kind: "extension",
      origin: "memory",
      version: "2",
    },
    entry: {
      kind: "bytes",
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "application/octet-stream",
    },
  };

  it("put then get returns the same artifact by CapabilityId", async () => {
    const store = new MemoryCapabilityStore();
    await store.put(foo);
    const got = await store.get(asCapabilityId("tools/internal/foo"));
    assert.ok(got);
    assert.equal(got.ref.id, "tools/internal/foo");
    assert.equal(got.ref.origin, "memory");
    assert.equal(got.entry.kind, "inline");
    if (got.entry.kind === "inline") {
      assert.deepEqual(got.entry.value, { name: "foo" });
    }
  });

  it("get returns null for unknown id", async () => {
    const store = new MemoryCapabilityStore();
    assert.equal(await store.get(asCapabilityId("missing")), null);
  });

  it("seed constructor loads initial artifacts", async () => {
    const store = new MemoryCapabilityStore([foo]);
    const got = await store.get(asCapabilityId("tools/internal/foo"));
    assert.ok(got);
    assert.equal(got.ref.id, foo.ref.id);
  });

  it("get honors optional version selector", async () => {
    const store = new MemoryCapabilityStore();
    await store.put(barV1);
    await store.put(barV2);

    const v2 = await store.get(asCapabilityId("ext/bar"), { version: "2" });
    assert.ok(v2);
    assert.equal(v2.ref.version, "2");
    assert.equal(v2.entry.kind, "bytes");

    const v1 = await store.get(asCapabilityId("ext/bar"), { version: "1" });
    assert.ok(v1);
    assert.equal(v1.ref.version, "1");

    const none = await store.get(asCapabilityId("ext/bar"), { version: "9" });
    assert.equal(none, null);

    // Unversioned get returns latest put (barV2)
    const latest = await store.get(asCapabilityId("ext/bar"));
    assert.ok(latest);
    assert.equal(latest.ref.version, "2");
  });

  it("publish stores artifact and returns ref (CapabilityPublisher)", async () => {
    const store = new MemoryCapabilityStore();
    const ref = await store.publish({
      ref: foo.ref,
      entry: foo.entry,
    });
    assert.equal(ref.id, foo.ref.id);
    const got = await store.get(asCapabilityId("tools/internal/foo"));
    assert.ok(got);
    assert.equal(got.ref.id, "tools/internal/foo");
  });

  it("put overwrites same id for unversioned get", async () => {
    const store = new MemoryCapabilityStore();
    await store.put(barV1);
    await store.put({
      ref: { ...barV1.ref, version: undefined },
      entry: { kind: "inline", value: { replaced: true } },
    });
    const got = await store.get(asCapabilityId("ext/bar"));
    assert.ok(got);
    assert.equal(got.entry.kind, "inline");
    if (got.entry.kind === "inline") {
      assert.deepEqual(got.entry.value, { replaced: true });
    }
  });

  it("size and clear work for tests", async () => {
    const store = new MemoryCapabilityStore([foo, barV1]);
    assert.equal(store.size(), 2);
    store.clear();
    assert.equal(store.size(), 0);
    assert.equal(await store.get(asCapabilityId("tools/internal/foo")), null);
  });
});
