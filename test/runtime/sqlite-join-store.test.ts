/**
 * S6: SqliteJoinStore durability + JoinStore parity.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { SqliteJoinStore } from "../../src/adapters/join/sqlite-store.ts";
import { asRunId } from "../../src/domain/engagement.ts";
import { asSessionRef } from "../../src/domain/presence.ts";

const SNAPSHOT = {
  planHash: "abc".repeat(16).slice(0, 64),
  packs: [
    {
      id: "foo",
      path: "/tmp/foo",
      source: "agent" as const,
    },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("SqliteJoinStore", () => {
  it("put / get / updateStatus in memory", async () => {
    const join = new SqliteJoinStore({ path: ":memory:" });
    const runId = asRunId("run-mem-1");
    const sessionRef = asSessionRef("sess-mem-1");

    await join.put({
      runId,
      sessionRef,
      definitionId: "agent-a",
      packSnapshot: SNAPSHOT,
      status: "materializing",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const got = await join.getByRunId(runId);
    assert.ok(got);
    assert.equal(got.status, "materializing");
    assert.equal(got.definitionId, "agent-a");
    assert.equal(got.packSnapshot.planHash, SNAPSHOT.planHash);

    const bySession = await join.getBySessionRef(sessionRef);
    assert.ok(bySession);
    assert.equal(bySession.runId, runId);

    await join.updateStatus(runId, "settled");
    assert.equal((await join.getByRunId(runId))?.status, "settled");

    join.close();
  });

  it("survives close + reopen on file path", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mediation-join-s6-"));
    const dbPath = path.join(dir, "join.sqlite");
    const runId = asRunId("run-file-1");
    const sessionRef = asSessionRef("sess-file-1");

    {
      const join = new SqliteJoinStore({ path: dbPath });
      await join.put({
        runId,
        sessionRef,
        definitionId: "durable-agent",
        packSnapshot: SNAPSHOT,
        status: "engaging",
        parked: { reason: "need-human", resumeToken: "tok-1" },
        updatedAt: "2026-06-01T12:00:00.000Z",
      });
      join.close();
    }

    {
      const join = new SqliteJoinStore({ path: dbPath });
      const got = await join.getByRunId(runId);
      assert.ok(got);
      assert.equal(got.status, "engaging");
      assert.equal(got.definitionId, "durable-agent");
      assert.equal(got.parked?.resumeToken, "tok-1");
      assert.equal(
        (await join.getBySessionRef(sessionRef))?.runId,
        runId,
      );
      join.close();
    }

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("updateStatus on missing run throws", async () => {
    const join = new SqliteJoinStore({ path: ":memory:" });
    await assert.rejects(
      () => join.updateStatus(asRunId("nope"), "failed"),
      /no record/u,
    );
    join.close();
  });

  it("re-put same runId overwrites; session unique moves", async () => {
    const join = new SqliteJoinStore({ path: ":memory:" });
    const runId = asRunId("run-move");
    await join.put({
      runId,
      sessionRef: asSessionRef("s-old"),
      definitionId: "d",
      packSnapshot: SNAPSHOT,
      status: "engaging",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await join.put({
      runId,
      sessionRef: asSessionRef("s-new"),
      definitionId: "d",
      packSnapshot: SNAPSHOT,
      status: "settled",
      updatedAt: "2026-01-01T01:00:00.000Z",
    });

    assert.equal((await join.getBySessionRef(asSessionRef("s-old"))), null);
    assert.equal(
      (await join.getBySessionRef(asSessionRef("s-new")))?.status,
      "settled",
    );
    join.close();
  });
});
