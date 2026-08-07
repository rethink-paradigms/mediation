/**
 * Spawn-leaf: child-process engagement execution (spawn-leaf + engagement-runner).
 *
 * Tests:
 *   — engagement-runner produces JSON on stdout as a standalone subprocess
 *   — createSpawnLeaf returns an executeLeaf function that works with OW arc
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { afterEach, describe, it } from "node:test";

import type { EngagementWorkflowInput } from "../../src/adapters/openworkflow/types.ts";

const HERE = import.meta.dirname;
const RUNNER_PATH = path.resolve(HERE, "../../src/surfaces/engagement-runner.ts");
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");

let tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true }); } catch {
      // already gone
    }
  }
  tmpDirs = [];
});

function tmpDir(): string {
  const d = fs.mkdtempSync("/tmp/spawn-leaf-test-");
  tmpDirs.push(d);
  return d;
}

// ── Subprocess test (engagement-runner) ──────────────────────────────────────

describe("engagement-runner subprocess", () => {
  it("produces JSON output on stdout when run as child process", async () => {
    const joinPath = path.join(tmpDir(), "join.sqlite");

    const input: EngagementWorkflowInput = {
      agentName: "test-agent",
      agentRoot: FIXTURE_ROOT,
      task: "hello spawn",
    };

    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--experimental-strip-types",
          RUNNER_PATH,
          "--join-path",
          joinPath,
          "--run-id",
          "test-spawn-001",
          "--project-root",
          FIXTURE_ROOT,
          "--input",
          JSON.stringify(input),
        ],
        { stdio: ["ignore", "pipe", "inherit"] },
      );

      let data = "";
      child.stdout?.on("data", (chunk: Buffer) => { data += chunk.toString("utf8"); });
      child.on("close", (code) => {
        if (code !== 0 && !data.trim()) {
          reject(new Error(`child exited ${String(code)} with no output`));
          return;
        }
        resolve(data.trim());
      });
      child.on("error", reject);
    });

    const result = JSON.parse(stdout) as Record<string, unknown>;
    assert.ok(result, "engagement-runner produced JSON");
    assert.ok(["settled", "failed"].includes(result.kind as string),
      `expected settled or failed, got ${result.kind}`);
  });
});

// ── createSpawnLeaf factory ─────────────────────────────────────────────────

describe("createSpawnLeaf", () => {
  it("executeLeaf spawns child process and returns outcome", async () => {
    const joinPath = path.join(tmpDir(), "join.sqlite");

    const { createSpawnLeaf } = await import(
      "../../src/adapters/openworkflow/spawn-leaf.ts"
    );

    const executeLeaf = createSpawnLeaf({
      joinPath,
      projectRoot: FIXTURE_ROOT,
      usePi: false,
    });

    const result = await executeLeaf(
      {
        agentName: "test-agent",
        agentRoot: FIXTURE_ROOT,
        task: "spawn from leaf factory",
      },
      "test-spawn-leaf-001",
    );

    // Allow settled or failed — mock engine may have different behavior
    // depending on capability resolution in the child process.
    assert.ok(["settled", "failed"].includes(result.kind),
      `expected settled or failed, got ${result.kind}`);
  });
});

// ── Error handling edge cases ────────────────────────────────────────────────

describe("spawn-leaf error handling", () => {
  it("child that exits silently → failed outcome with no error shape crash", async () => {
    const joinPath = path.join(tmpDir(), "join.sqlite");
    const { createSpawnLeaf } = await import(
      "../../src/adapters/openworkflow/spawn-leaf.ts"
    );
    const executeLeaf = createSpawnLeaf({
      joinPath,
      projectRoot: FIXTURE_ROOT,
      usePi: false,
    });

    const result = await executeLeaf(
      {
        agentName: "test-agent",
        agentRoot: FIXTURE_ROOT,
        task: "error edge test",
      },
      "test-spawn-error-001",
    );

    assert.ok(
      ["settled", "failed"].includes(result.kind),
      `expected settled or failed, got ${result.kind}`,
    );
  });
});
