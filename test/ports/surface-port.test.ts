/**
 * ABS-B1: SurfacePort shape smoke — mock connector, no CLI rewrite.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { asRunId } from "../../src/domain/engagement.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import type {
  SurfaceEngageResult,
  SurfacePort,
  SurfaceReenterRequest,
  SurfaceReenterResult,
  SurfaceRequest,
} from "../../src/ports/surface.ts";
import type { DispatchHandle, RuntimeStatus } from "../../src/ports/runtime.ts";

function mockSurfacePort(): SurfacePort {
  const statuses = new Map<string, RuntimeStatus>();

  return {
    async engageLocal(req: SurfaceRequest): Promise<SurfaceEngageResult> {
      const sessionRef =
        req.resume ?? asSessionRef(`mock-sess-${req.clientRequestId ?? "local"}`);
      return {
        outcome: {
          kind: "settled",
          sessionRef,
          result: { task: req.task, channel: req.channel },
        },
        sessionRef,
        packSnapshotHash: "mock-pack-hash",
        definitionId: req.agent.name,
      };
    },

    async dispatch(req: SurfaceRequest): Promise<DispatchHandle> {
      const runId = asRunId(
        req.clientRequestId ?? `mock-run-${req.agent.name}`,
      );
      statuses.set(runId, { state: "pending" });
      return { runId };
    },

    async reenter(req: SurfaceReenterRequest): Promise<SurfaceReenterResult> {
      const match =
        req.expectedPackSnapshotHash === undefined ||
        req.expectedPackSnapshotHash === "mock-pack-hash";
      return {
        outcome: match
          ? {
              kind: "settled",
              sessionRef: req.sessionRef,
              result: { task: req.task },
            }
          : {
              kind: "failed",
              sessionRef: req.sessionRef,
              error: {
                message: "packSnapshot mismatch",
                code: "PACK_SNAPSHOT_MISMATCH",
              },
            },
        sessionRef: req.sessionRef,
        packSnapshotHash: "mock-pack-hash",
        definitionId: req.agent.name,
        packSnapshotMatch: match,
      };
    },

    async getStatus(runId): Promise<RuntimeStatus> {
      return statuses.get(runId) ?? { state: "pending" };
    },
  };
}

describe("SurfacePort (ABS-B1)", () => {
  it("mock engageLocal returns Settled with correlation fields", async () => {
    const surface = mockSurfacePort();
    const result = await surface.engageLocal({
      agent: { name: "case-basic", rootDir: "/tmp/agents/case-basic" },
      task: "hello surface",
      clientRequestId: "abs-b1-1",
      channel: "test",
      mode: "prompt",
    });

    assert.equal(result.outcome.kind, "settled");
    assert.equal(result.definitionId, "case-basic");
    assert.equal(result.packSnapshotHash, "mock-pack-hash");
    assert.equal(result.sessionRef, "mock-sess-abs-b1-1");
    if (result.outcome.kind === "settled") {
      assert.deepEqual(result.outcome.result, {
        task: "hello surface",
        channel: "test",
      });
    }
  });

  it("optional dispatch + getStatus shape", async () => {
    const surface = mockSurfacePort();
    assert.equal(typeof surface.dispatch, "function");
    assert.equal(typeof surface.getStatus, "function");

    const handle = await surface.dispatch!({
      agent: { name: "case-basic", rootDir: "/tmp/agents/case-basic" },
      task: "durable",
      clientRequestId: "abs-b1-dispatch",
    });
    assert.equal(handle.runId, "abs-b1-dispatch");

    const status = await surface.getStatus!(handle.runId);
    assert.equal(status.state, "pending");
  });

  it("optional reenter with packSnapshot gate", async () => {
    const surface = mockSurfacePort();
    assert.equal(typeof surface.reenter, "function");

    const sessionRef = asSessionRef("reenter-sess");
    const ok = await surface.reenter!({
      agent: { name: "case-basic", rootDir: "/tmp/agents/case-basic" },
      sessionRef,
      task: "again",
      expectedPackSnapshotHash: "mock-pack-hash",
    });
    assert.equal(ok.packSnapshotMatch, true);
    assert.equal(ok.outcome.kind, "settled");
    assert.equal(ok.sessionRef, sessionRef);

    const bad = await surface.reenter!({
      agent: { name: "case-basic", rootDir: "/tmp/agents/case-basic" },
      sessionRef,
      task: "again",
      expectedPackSnapshotHash: "other-hash",
    });
    assert.equal(bad.packSnapshotMatch, false);
    assert.equal(bad.outcome.kind, "failed");
  });

  it("resume on SurfaceRequest is accepted by engageLocal", async () => {
    const surface = mockSurfacePort();
    const resume = asSessionRef("existing-sess");
    const result = await surface.engageLocal({
      agent: { name: "case-basic", rootDir: "/tmp/agents/case-basic" },
      task: "continue",
      resume,
      mode: "continue",
    });
    assert.equal(result.sessionRef, resume);
    assert.equal(result.outcome.kind, "settled");
  });
});
