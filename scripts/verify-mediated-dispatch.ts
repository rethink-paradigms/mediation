/**
 * End-to-end verification: dispatch a real fleet agent through the in-process
 * Mediation façade and confirm the engagement SETTLES (not
 * CAPABILITY_RESOLVE_FAILED). Uses the mock engine so no LLM keys are needed —
 * the capability resolution path is identical across engines (the report
 * confirms pi/prime/mock all failed identically on the same resolution bug).
 *
 * Run from the mediation package:
 *   node --experimental-strip-types scripts/verify-mediated-dispatch.ts
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createHostedMediation } from "../src/index.ts";

const COMPANY_ROOT = path.resolve(import.meta.dirname, "../../..");

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mediation-fix-e2e-"));
  const dbPath = path.join(dir, "mediation-ow.sqlite");
  const joinPath = path.join(dir, "mediation-join.sqlite");

  const hosted = createHostedMediation({
    dbPath,
    joinPath,
    projectRoot: COMPANY_ROOT,
    mockEngine: true,
    pollIntervalMs: 15,
    concurrency: 1,
  });

  try {
    await hosted.worker.start();

    const handle = await hosted.mediation.dispatch({
      agent: {
        name: "web-researcher",
        rootDir: path.join(COMPANY_ROOT, "agents", "web-researcher"),
      },
      task: "verify mediated fleet dispatch settles",
      clientRequestId: "mediation-fix-e2e-1",
    });

    const status = await hosted.mediation.wait(handle.runId, {
      timeoutMs: 20_000,
    });

    assert.equal(
      status.state,
      "completed",
      `expected completed; got ${status.state} (result=${JSON.stringify(
        (status as { result?: unknown }).result,
      )})`,
    );
    const completed = status as { result?: unknown };
    const result = completed.result as {
      kind?: string;
      sessionRef?: string;
      engine?: string;
    };

    console.log(`runId: ${handle.runId}`);
    console.log(`status.state: ${status.state}`);
    console.log(`status.result: ${JSON.stringify(completed.result, null, 2)}`);
    assert.equal(
      result?.kind,
      "settled",
      `expected settled outcome; got ${JSON.stringify(result)}`,
    );
    assert.ok((result?.sessionRef ?? "").length > 0, "missing sessionRef");

    console.log("\nMediated dispatch: SETTLED (capability resolution OK)\n");
  } finally {
    await hosted.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
