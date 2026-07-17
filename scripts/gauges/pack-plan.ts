/**
 * Gauge: pack_plan_hash + pack_parity for fixtures/packs/*
 *
 * Observational: prints hashes; exit 0 unless fixture tree missing.
 * Usage: node --experimental-strip-types scripts/gauges/pack-plan.ts
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { packPlanHash } from "../../src/adapters/packs/pack-snapshot.ts";
import {
  PackResolverImpl,
  planHasErrors,
} from "../../src/adapters/packs/resolve-packs.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, "../..");
const FIXTURES = path.join(PKG_ROOT, "fixtures", "packs");

export type PackPlanGaugeRow = {
  fixture: string;
  pack_count: number;
  ok: boolean;
  pack_plan_hash: string;
  pack_parity_delta: number;
  error_diagnostics: number;
};

export function runPackPlanGauges(fixturesRoot: string = FIXTURES): PackPlanGaugeRow[] {
  if (!fs.existsSync(fixturesRoot)) {
    throw new Error(`fixtures root missing: ${fixturesRoot}`);
  }

  const resolver = new PackResolverImpl({
    homeDir: path.join(fixturesRoot, "_no_home"),
  });
  const rows: PackPlanGaugeRow[] = [];

  const cases = fs
    .readdirSync(fixturesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name)
    .sort();

  for (const name of cases) {
    const root = path.join(fixturesRoot, name);
    const expectedPath = path.join(root, "expected.json");
    const agentPath = path.join(root, "agent.json");

    let extensionSpecs: string[] = [];
    if (fs.existsSync(expectedPath)) {
      const exp = JSON.parse(fs.readFileSync(expectedPath, "utf8")) as {
        extensionSpecs?: string[];
      };
      extensionSpecs = exp.extensionSpecs ?? [];
    } else if (fs.existsSync(agentPath)) {
      const agent = JSON.parse(fs.readFileSync(agentPath, "utf8")) as {
        extensionSpecs?: string[];
        extensions?: string[];
      };
      extensionSpecs = agent.extensionSpecs ?? agent.extensions ?? [];
    }

    const planA = resolver.resolveSpecs(extensionSpecs, { projectRoot: root });
    const planB = resolver.resolveSpecs(extensionSpecs, { projectRoot: root });
    const hashA = packPlanHash(planA);
    const hashB = packPlanHash(planB);
    const parity = hashA === hashB ? 0 : 1;

    rows.push({
      fixture: name,
      pack_count: planA.packs.length,
      ok: planA.ok && !planHasErrors(planA),
      pack_plan_hash: hashA,
      pack_parity_delta: parity,
      error_diagnostics: planA.diagnostics.filter((d) => d.level === "error").length,
    });
  }

  return rows;
}

function main(): void {
  const rows = runPackPlanGauges();
  console.log("=== pack gauges (S1) ===");
  for (const r of rows) {
    console.log(
      [
        `fixture=${r.fixture}`,
        `pack_count=${r.pack_count}`,
        `ok=${r.ok}`,
        `pack_plan_hash=${r.pack_plan_hash}`,
        `pack_parity_delta=${r.pack_parity_delta}`,
        `error_diagnostics=${r.error_diagnostics}`,
      ].join(" "),
    );
  }
  if (rows.length === 0) {
    console.log("(no fixtures under fixtures/packs)");
  }
  const anyParity = rows.some((r) => r.pack_parity_delta !== 0);
  console.log(`summary pack_parity_delta_total=${anyParity ? 1 : 0} fixtures=${rows.length}`);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main();
}
