/**
 * S11: legacy spawn stub is private, fail-closed, adapters-only.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { spawnEngage } from "../../src/adapters/legacy/spawn-engage.ts";
import { MediationError } from "../../src/domain/errors.ts";

describe("legacy spawnEngage (private, fail-closed)", () => {
  it("throws MediationError with SPAWN_DISABLED reason", () => {
    assert.throws(
      () => spawnEngage({ agentRef: "x" }),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "POLICY_VIOLATION");
        assert.match(err.message, /SPAWN_DISABLED/);
        assert.deepEqual(err.details, { reason: "SPAWN_DISABLED" });
        return true;
      },
    );
  });

  it("is importable only via adapters path (not public product door)", async () => {
    // Public package surface is src/index.ts — must not re-export spawnEngage.
    const mod = await import("../../src/index.ts");
    assert.equal(
      "spawnEngage" in mod,
      false,
      "spawnEngage must not be a public export",
    );
    assert.equal(
      "SpawnEngageAdapter" in mod,
      false,
      "SpawnEngageAdapter must not be a public export",
    );
  });
});
