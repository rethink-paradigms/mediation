/**
 * S11 / D3: spawn_public_export_count must be 0 on real index;
 * synthetic violation strings must be detected by the pure scanner.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  detectSpawnPublicExports,
  measureSpawnPublicExportCount,
} from "../../scripts/gauges/spawn-death.ts";

describe("spawn_public_export_count (S11)", () => {
  it("real src/index.ts has spawn_public_export_count=0", () => {
    const g = measureSpawnPublicExportCount();
    assert.equal(g.name, "spawn_public_export_count");
    assert.equal(
      g.value,
      0,
      `expected 0, got ${g.value}: ${JSON.stringify(g.details)}`,
    );
  });

  it("detects synthetic export { SpawnEngageAdapter } violation", () => {
    const synthetic = `
export type { AgentRef } from "./domain/definition.ts";
export { SpawnEngageAdapter } from "./adapters/legacy/spawn-engage.ts";
export { Mediation } from "./app/mediation.ts";
`;
    const g = detectSpawnPublicExports(synthetic);
    assert.ok(g.value >= 1, "must detect at least one violation");
    assert.ok(
      g.details.some(
        (d) =>
          d.match.includes("SpawnEngage") ||
          d.match.includes("legacy") ||
          d.match.includes("spawn-engage"),
      ),
      `details should mention spawn/legacy: ${JSON.stringify(g.details)}`,
    );
  });

  it("detects synthetic spawnEngage function export", () => {
    const synthetic = `
export function spawnEngage(): void {}
export { Mediation } from "./app/mediation.ts";
`;
    const g = detectSpawnPublicExports(synthetic);
    assert.ok(g.value >= 1);
    assert.ok(g.details.some((d) => /spawnEngage/iu.test(d.match)));
  });

  it("detects re-export from adapters/legacy path", () => {
    const synthetic = `
export { somethingInnocent } from "./adapters/legacy/spawn-engage.ts";
`;
    const g = detectSpawnPublicExports(synthetic);
    assert.ok(g.value >= 1);
    assert.ok(
      g.details.some((d) => d.kind === "from_path" || d.kind === "export_line"),
    );
  });

  it("allows Mediation / materialize surface without false positive", () => {
    const ok = `
export { Mediation } from "./app/mediation.ts";
export { DefaultPresenceFactory } from "./app/factory.ts";
export type { PresenceFactory, MaterializeOptions } from "./domain/presence.ts";
`;
    const g = detectSpawnPublicExports(ok);
    assert.equal(g.value, 0, JSON.stringify(g.details));
  });
});
