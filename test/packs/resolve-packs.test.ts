/**
 * S1 goldens: PackResolver order, fail-closed missing packs, planHash stability.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  packPlanHash,
  planHash,
  toPackSnapshot,
} from "../../src/adapters/packs/pack-snapshot.ts";
import {
  PackResolverImpl,
  agentDefForPacks,
  planHasErrors,
  resolveExtensionPath,
} from "../../src/adapters/packs/resolve-packs.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const EXPECTED = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_ROOT, "expected.json"), "utf8"),
) as {
  extensionSpecs: string[];
  expectedPackCount: number;
  expectedSources: Record<string, string>;
  missingSpecs: string[];
};

describe("PackResolverImpl — case-basic", () => {
  const resolver = new PackResolverImpl({
    homeDir: path.join(FIXTURE_ROOT, "_no_home"),
  });

  it("resolves foo (internal) and bar (project-extensions) via port resolve", () => {
    const plan = resolver.resolve(
      { extensionSpecs: EXPECTED.extensionSpecs },
      { projectRoot: FIXTURE_ROOT },
    );

    assert.equal(plan.ok, true);
    assert.equal(planHasErrors(plan), false);
    assert.equal(plan.packs.length, EXPECTED.expectedPackCount);
    assert.equal(plan.diagnostics.length, 0);

    const byId = Object.fromEntries(plan.packs.map((p) => [p.id, p]));
    assert.equal(byId.foo?.source, "internal");
    assert.equal(byId.bar?.source, "project-extensions");
    assert.equal(byId.foo?.path, path.join(FIXTURE_ROOT, "tools", "internal", "foo"));
    assert.equal(byId.bar?.path, path.join(FIXTURE_ROOT, "extensions", "bar"));
  });

  it("resolveDefinition uses AgentDefinition.extensions + rootDir", () => {
    const def = agentDefForPacks(FIXTURE_ROOT, EXPECTED.extensionSpecs);
    const plan = resolver.resolveDefinition(def);
    assert.equal(plan.ok, true);
    assert.equal(plan.packs.length, 2);
  });

  it("planHash is stable across two resolves (pack_parity)", () => {
    const req = { extensionSpecs: EXPECTED.extensionSpecs };
    const opts = { projectRoot: FIXTURE_ROOT };
    const a = resolver.resolve(req, opts);
    const b = resolver.resolve(req, opts);

    const ha = packPlanHash(a);
    const hb = packPlanHash(b);
    assert.equal(ha, hb);
    assert.equal(ha.length, 64); // sha256 hex
    assert.deepEqual(a.packs, b.packs);
  });

  it("missing pack nope → error diagnostic, ok false (D2 fail-closed)", () => {
    const plan = resolver.resolve(
      {
        extensionSpecs: [...EXPECTED.extensionSpecs, ...EXPECTED.missingSpecs],
      },
      { projectRoot: FIXTURE_ROOT },
    );

    assert.equal(plan.ok, false);
    assert.equal(planHasErrors(plan), true);
    assert.equal(plan.packs.length, EXPECTED.expectedPackCount);
    const errors = plan.diagnostics.filter((d) => d.level === "error");
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.packName, "nope");
    assert.equal(errors[0]?.code, "pack_not_found");
    assert.match(errors[0]?.message ?? "", /nope/);
  });

  it("search order: .pi/extensions and tools/families", () => {
    const plan = resolver.resolve(
      { extensionSpecs: ["baz", "qux"] },
      { projectRoot: FIXTURE_ROOT },
    );
    assert.equal(plan.ok, true);
    assert.equal(plan.packs[0]?.source, "agent");
    assert.equal(plan.packs[1]?.source, "families");
  });

  it("slash name resolves relative to projectRoot as explicit", () => {
    const plan = resolver.resolve(
      { extensionSpecs: ["vendor/extra"] },
      { projectRoot: FIXTURE_ROOT },
    );
    assert.equal(plan.ok, true);
    assert.equal(plan.packs[0]?.source, "explicit");
    assert.equal(plan.packs[0]?.path, path.join(FIXTURE_ROOT, "vendor", "extra"));
  });

  it("internal wins for bare name foo", () => {
    const p = resolveExtensionPath(
      "foo",
      FIXTURE_ROOT,
      path.join(FIXTURE_ROOT, "_no_home"),
    );
    assert.ok(p);
    assert.equal(p!.source, "internal");
  });

  it("toPackSnapshot carries planHash", () => {
    const plan = resolver.resolve(
      { extensionSpecs: EXPECTED.extensionSpecs },
      { projectRoot: FIXTURE_ROOT },
    );
    const snap = toPackSnapshot(plan, "2020-01-01T00:00:00.000Z");
    assert.equal(snap.planHash, planHash(plan.packs));
    assert.equal(snap.createdAt, "2020-01-01T00:00:00.000Z");
    assert.equal(snap.packs.length, 2);
  });

  it("hash is order-independent of input list (canonical sort by id)", () => {
    const plan1 = resolver.resolve(
      { extensionSpecs: ["foo", "bar"] },
      { projectRoot: FIXTURE_ROOT },
    );
    const plan2 = resolver.resolve(
      { extensionSpecs: ["bar", "foo"] },
      { projectRoot: FIXTURE_ROOT },
    );
    assert.notDeepEqual(
      plan1.packs.map((p) => p.id),
      plan2.packs.map((p) => p.id),
    );
    assert.equal(packPlanHash(plan1), packPlanHash(plan2));
  });
});
