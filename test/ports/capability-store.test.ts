/**
 * ABS-A2: CapabilityStore port smoke — mock store only (no FS/registry adapters).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  asCapabilityId,
  type CapabilityRef,
} from "../../src/domain/capability.ts";
import type {
  CapabilityArtifact,
  CapabilityPublisher,
  CapabilityStore,
  PublishCapabilityInput,
} from "../../src/ports/capability-store.ts";

function mockCapabilityStore(
  artifacts: readonly CapabilityArtifact[],
): CapabilityStore {
  return {
    async get(id, opts) {
      const matches = artifacts.filter((a) => a.ref.id === id);
      if (matches.length === 0) return null;
      if (opts?.version !== undefined) {
        return matches.find((a) => a.ref.version === opts.version) ?? null;
      }
      return matches[0] ?? null;
    },
  };
}

function mockCapabilityPublisher(
  published: PublishCapabilityInput[],
): CapabilityPublisher {
  return {
    async publish(input) {
      published.push(input);
      return input.ref;
    },
  };
}

describe("CapabilityStore (ABS-A2)", () => {
  const fooRef: CapabilityRef = {
    id: asCapabilityId("tools/internal/foo"),
    kind: "custom-tool",
    origin: "memory",
    version: "1",
  };

  const fooArtifact: CapabilityArtifact = {
    ref: fooRef,
    entry: { kind: "inline", value: { name: "foo" } },
  };

  const barV1: CapabilityArtifact = {
    ref: {
      id: asCapabilityId("ext/bar"),
      kind: "extension",
      origin: "fs",
      version: "1",
      locator: { path: "/adapter-private/bar-v1" },
    },
    entry: { kind: "module-path", modulePath: "/adapter-private/bar-v1" },
  };

  const barV2: CapabilityArtifact = {
    ref: {
      id: asCapabilityId("ext/bar"),
      kind: "extension",
      origin: "fs",
      version: "2",
    },
    entry: {
      kind: "bytes",
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "application/octet-stream",
    },
  };

  it("get returns artifact by CapabilityId", async () => {
    const store = mockCapabilityStore([fooArtifact, barV1, barV2]);
    const got = await store.get(asCapabilityId("tools/internal/foo"));
    assert.ok(got);
    assert.equal(got.ref.id, "tools/internal/foo");
    assert.equal(got.entry.kind, "inline");
    if (got.entry.kind === "inline") {
      assert.deepEqual(got.entry.value, { name: "foo" });
    }
  });

  it("get returns null for unknown id", async () => {
    const store = mockCapabilityStore([fooArtifact]);
    const missing = await store.get(asCapabilityId("missing"));
    assert.equal(missing, null);
  });

  it("get honors optional version selector", async () => {
    const store = mockCapabilityStore([barV1, barV2]);
    const v2 = await store.get(asCapabilityId("ext/bar"), { version: "2" });
    assert.ok(v2);
    assert.equal(v2.ref.version, "2");
    assert.equal(v2.entry.kind, "bytes");

    const none = await store.get(asCapabilityId("ext/bar"), { version: "9" });
    assert.equal(none, null);
  });

  it("CapabilityPublisher stub accepts publish and echoes ref", async () => {
    const log: PublishCapabilityInput[] = [];
    const publisher = mockCapabilityPublisher(log);
    const ref = await publisher.publish({
      ref: fooRef,
      entry: fooArtifact.entry,
    });
    assert.equal(ref.id, fooRef.id);
    assert.equal(log.length, 1);
    assert.equal(log[0]?.ref.id, "tools/internal/foo");
  });
});
