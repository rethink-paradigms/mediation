/**
 * FS capability search goldens (former PackResolverImpl suite).
 * Production materialize uses CapabilityResolver + FsCapabilityStore;
 * this proves resolveFsModule / plan parity for fixtures.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  packPlanHash,
  planHash,
  toPackSnapshot,
} from "../../src/adapters/packs/pack-snapshot.ts";
import { resolveFsModule } from "../../src/adapters/capability/fs-store.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";
import {
  packLoadPlanFromFsSpecs,
  planHasErrors,
} from "../helpers/fs-pack-plan.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");
const EXPECTED = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_ROOT, "expected.json"), "utf8"),
) as {
  extensionSpecs: string[];
  expectedPackCount: number;
  expectedSources: Record<string, string>;
  missingSpecs: string[];
};

describe("FS capability search goldens — case-basic", () => {
  it("resolves foo (internal) and bar (project-extensions)", () => {
    const plan = packLoadPlanFromFsSpecs(
      EXPECTED.extensionSpecs,
      FIXTURE_ROOT,
      NO_HOME,
    );

    assert.equal(plan.ok, true);
    assert.equal(planHasErrors(plan), false);
    assert.equal(plan.packs.length, EXPECTED.expectedPackCount);
    assert.equal(plan.diagnostics.length, 0);

    const byId = Object.fromEntries(plan.packs.map((p) => [p.id, p]));
    assert.equal(byId.foo?.source, "internal");
    assert.equal(byId.bar?.source, "project-extensions");
    assert.equal(
      byId.foo?.path,
      path.join(FIXTURE_ROOT, "tools", "internal", "foo"),
    );
    assert.equal(byId.bar?.path, path.join(FIXTURE_ROOT, "extensions", "bar"));
  });

  it("agentDef extensions list maps to same plan via FS helper", () => {
    const def = agentDefForPacks(FIXTURE_ROOT, EXPECTED.extensionSpecs);
    const plan = packLoadPlanFromFsSpecs(
      def.extensions ?? [],
      def.rootDir,
      NO_HOME,
    );
    assert.equal(plan.ok, true);
    assert.equal(plan.packs.length, 2);
  });

  it("planHash is stable across two resolves (pack_parity)", () => {
    const a = packLoadPlanFromFsSpecs(
      EXPECTED.extensionSpecs,
      FIXTURE_ROOT,
      NO_HOME,
    );
    const b = packLoadPlanFromFsSpecs(
      EXPECTED.extensionSpecs,
      FIXTURE_ROOT,
      NO_HOME,
    );

    const ha = packPlanHash(a);
    const hb = packPlanHash(b);
    assert.equal(ha, hb);
    assert.equal(ha.length, 64);
    assert.deepEqual(a.packs, b.packs);
  });

  it("missing pack nope → error diagnostic, ok false (D2 fail-closed)", () => {
    const plan = packLoadPlanFromFsSpecs(
      [...EXPECTED.extensionSpecs, ...EXPECTED.missingSpecs],
      FIXTURE_ROOT,
      NO_HOME,
    );
    assert.equal(plan.ok, false);
    assert.equal(planHasErrors(plan), true);
    assert.ok(plan.diagnostics.some((d) => d.packName === "nope" || d.message.includes("nope")));
  });

  it("search order: tools/internal before extensions", () => {
    const foo = resolveFsModule("foo", FIXTURE_ROOT, NO_HOME);
    assert.ok(foo);
    assert.equal(foo.source, "internal");
  });

  it("slash name resolves relative to projectRoot as explicit", () => {
    const p = resolveFsModule(
      "extensions/bar",
      FIXTURE_ROOT,
      NO_HOME,
    );
    assert.ok(p);
    assert.equal(p.source, "explicit");
  });

  it("internal wins for bare name foo", () => {
    const p = resolveFsModule("foo", FIXTURE_ROOT, NO_HOME);
    assert.ok(p);
    assert.equal(p.source, "internal");
  });

  it("toPackSnapshot carries planHash", () => {
    const plan = packLoadPlanFromFsSpecs(
      EXPECTED.extensionSpecs,
      FIXTURE_ROOT,
      NO_HOME,
    );
    const snap = toPackSnapshot(plan);
    assert.equal(snap.planHash, packPlanHash(plan));
    assert.equal(snap.packs.length, 2);
  });

  it("hash is order-independent of input list (canonical sort by id)", () => {
    const a = packLoadPlanFromFsSpecs(["bar", "foo"], FIXTURE_ROOT, NO_HOME);
    const b = packLoadPlanFromFsSpecs(["foo", "bar"], FIXTURE_ROOT, NO_HOME);
    assert.equal(planHash(a.packs), planHash(b.packs));
  });
});
