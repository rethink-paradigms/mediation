/**
 * Verification script: capability resolution for real fleet agents.
 *
 * Mirrors the resolution that DefaultPresenceFactory.materialize performs via
 * CapabilityResolver + FsCapabilityStore, but calls the pieces directly so it
 * can run without opening any engine session. Asserts plan.ok === true for
 * web-researcher (context-memory) and lego-researcher (context-memory + github).
 *
 * Run from the mediation package:
 *   node --experimental-strip-types scripts/verify-fleet-resolution.ts
 */

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import {
  capabilitySpecFromDefinition,
  createCapabilityResolver,
  createFsCapabilityStore,
  createYamlDefinitionLoader,
  resolveFsModule,
} from "../src/index.ts";

const COMPANY_ROOT = path.resolve(import.meta.dirname, "../../..");

async function verifyAgent(agentName: string): Promise<void> {
  const agentRoot = path.join(COMPANY_ROOT, "agents", agentName);
  const loader = createYamlDefinitionLoader();
  const def = await loader.load({ name: agentName, rootDir: agentRoot });

  const extensions = def.extensions ?? [];
  assert.ok(extensions.length > 0, `${agentName} declares no extensions`);

  const store = createFsCapabilityStore({
    projectRoot: COMPANY_ROOT,
    homeDir: os.homedir(),
  });
  const resolver = createCapabilityResolver(store);

  const resolved = await resolver.resolve({
    layers: [{ kind: "agent", spec: capabilitySpecFromDefinition(def) }],
  });

  console.log(`\n=== ${agentName} ===`);
  for (const name of extensions) {
    const hit = resolveFsModule(name, COMPANY_ROOT, os.homedir());
    console.log(
      `  ${name} -> ${hit ? `${hit.source}:${hit.path}` : "MISSING"}`,
    );
  }

  console.log(`  plan.ok = ${String(resolved.plan.ok)}`);
  if (!resolved.plan.ok) {
    console.log(
      `  diagnostics = ${JSON.stringify(resolved.plan.diagnostics, null, 2)}`,
    );
  }

  assert.equal(
    resolved.plan.ok,
    true,
    `expected ${agentName} capabilities to resolve; got ${JSON.stringify(
      resolved.plan.diagnostics,
    )}`,
  );
  assert.equal(resolved.artifacts.length, extensions.length);
}

async function main(): Promise<void> {
  await verifyAgent("web-researcher");
  await verifyAgent("lego-researcher");
  console.log("\nFleet capability resolution: OK\n");
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
