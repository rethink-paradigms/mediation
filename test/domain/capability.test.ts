/**
 * ABS-A1 smoke: domain capability helpers and plan shape (no FS/adapters).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asCapabilityId,
  type CapabilityPlan,
  type CapabilityRef,
} from "../../src/domain/capability.ts";

describe("domain/capability (ABS-A1)", () => {
  it("asCapabilityId brands a string id", () => {
    const id = asCapabilityId("tools/internal/foo");
    assert.equal(id, "tools/internal/foo");
    // brand is compile-time only; runtime is plain string
    assert.equal(typeof id, "string");
  });

  it("CapabilityRef keeps locator opaque and optional", () => {
    const ref: CapabilityRef = {
      id: asCapabilityId("foo"),
      kind: "extension",
      origin: "fs",
      version: "1",
      digest: "abc",
      locator: { path: "/tmp/not-required-by-domain" },
    };
    assert.equal(ref.id, "foo");
    assert.equal(ref.origin, "fs");
    assert.deepEqual(ref.locator, { path: "/tmp/not-required-by-domain" });

    const memoryOnly: CapabilityRef = {
      id: asCapabilityId("inline-skill"),
      kind: "skill",
      origin: "memory",
    };
    assert.equal(memoryOnly.locator, undefined);
  });

  it("CapabilityPlan fail-closed shape matches packs pattern", () => {
    const okPlan: CapabilityPlan = {
      capabilities: [
        {
          id: asCapabilityId("foo"),
          origin: "registry",
        },
      ],
      diagnostics: [],
      ok: true,
    };
    assert.equal(okPlan.ok, true);
    assert.equal(okPlan.capabilities.length, 1);

    const failPlan: CapabilityPlan = {
      capabilities: [],
      diagnostics: [
        {
          level: "error",
          code: "capability_not_found",
          message: "missing bar",
          capabilityId: asCapabilityId("bar"),
        },
      ],
      ok: false,
    };
    assert.equal(failPlan.ok, false);
    assert.equal(failPlan.diagnostics[0]?.level, "error");
  });
});
