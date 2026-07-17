/**
 * ABS-A3: FsCapabilityStore — FS search order via fixtures/packs/case-basic.
 * D5: origin "fs"; entry.kind "module-path"; path only in entry/locator.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createFsCapabilityStore,
  FsCapabilityStore,
  resolveFsModule,
} from "../../src/adapters/capability/fs-store.ts";
import { asCapabilityId } from "../../src/domain/capability.ts";
import type { CapabilityStore } from "../../src/ports/capability-store.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

describe("FsCapabilityStore (ABS-A3)", () => {
  const store: CapabilityStore = new FsCapabilityStore({
    projectRoot: FIXTURE_ROOT,
    homeDir: NO_HOME,
  });

  it("get(foo) → internal tools path, origin fs, module-path entry", async () => {
    const got = await store.get(asCapabilityId("foo"));
    assert.ok(got);
    assert.equal(got.ref.id, "foo");
    assert.equal(got.ref.origin, "fs");
    assert.equal(got.ref.kind, "custom-tool");
    assert.equal(got.entry.kind, "module-path");
    if (got.entry.kind === "module-path") {
      assert.equal(
        got.entry.modulePath,
        path.join(FIXTURE_ROOT, "tools", "internal", "foo"),
      );
    }
    assert.equal(got.ref.locator?.path, path.join(FIXTURE_ROOT, "tools", "internal", "foo"));
    assert.equal(got.ref.locator?.source, "internal");
  });

  it("get(bar) → project-extensions", async () => {
    const got = await store.get(asCapabilityId("bar"));
    assert.ok(got);
    assert.equal(got.ref.origin, "fs");
    assert.equal(got.ref.kind, "extension");
    assert.equal(got.ref.locator?.source, "project-extensions");
    if (got.entry.kind === "module-path") {
      assert.equal(
        got.entry.modulePath,
        path.join(FIXTURE_ROOT, "extensions", "bar"),
      );
    }
  });

  it("get(baz) → .pi/extensions (agent)", async () => {
    const got = await store.get(asCapabilityId("baz"));
    assert.ok(got);
    assert.equal(got.ref.locator?.source, "agent");
    if (got.entry.kind === "module-path") {
      assert.equal(
        got.entry.modulePath,
        path.join(FIXTURE_ROOT, ".pi", "extensions", "baz"),
      );
    }
  });

  it("get(qux) → tools/families", async () => {
    const got = await store.get(asCapabilityId("qux"));
    assert.ok(got);
    assert.equal(got.ref.locator?.source, "families");
    assert.equal(got.ref.kind, "custom-tool");
    if (got.entry.kind === "module-path") {
      assert.equal(
        got.entry.modulePath,
        path.join(FIXTURE_ROOT, "tools", "families", "qux"),
      );
    }
  });

  it("get(vendor/extra) slash name → explicit under projectRoot", async () => {
    const got = await store.get(asCapabilityId("vendor/extra"));
    assert.ok(got);
    assert.equal(got.ref.locator?.source, "explicit");
    assert.equal(got.ref.kind, "other");
    if (got.entry.kind === "module-path") {
      assert.equal(
        got.entry.modulePath,
        path.join(FIXTURE_ROOT, "vendor", "extra"),
      );
    }
  });

  it("get unknown → null", async () => {
    const missing = await store.get(asCapabilityId("nope"));
    assert.equal(missing, null);
  });

  it("createFsCapabilityStore factory implements CapabilityStore", async () => {
    const s = createFsCapabilityStore({
      projectRoot: FIXTURE_ROOT,
      homeDir: NO_HOME,
    });
    const got = await s.get(asCapabilityId("foo"));
    assert.ok(got);
    assert.equal(got.ref.origin, "fs");
  });

  it("resolveFsModule matches fixture search order (internal wins for foo)", () => {
    const p = resolveFsModule("foo", FIXTURE_ROOT, NO_HOME);
    assert.ok(p);
    assert.equal(p.source, "internal");
    assert.equal(p.path, path.join(FIXTURE_ROOT, "tools", "internal", "foo"));
  });

  it("path is never CapabilityId identity — id stays bare name", async () => {
    const got = await store.get(asCapabilityId("bar"));
    assert.ok(got);
    assert.equal(got.ref.id, "bar");
    assert.notEqual(got.ref.id, got.ref.locator?.path);
    if (got.entry.kind === "module-path") {
      assert.notEqual(got.ref.id, got.entry.modulePath);
    }
  });
});
