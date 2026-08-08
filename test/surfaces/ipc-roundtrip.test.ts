/**
 * Phase-2 daemon IPC — server/client round trip (unit, stub runtime).
 *
 * Transport-level proof: dispatch → status → wait → cancel → signal → wake
 * ride the HTTP envelope; notify records (parked/settled/failed) push over
 * SSE without client polling; runId filter works; error paths surface codes.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { InProcessNotifier } from "../../src/adapters/notify/in-process.ts";
import { asRunId } from "../../src/domain/engagement.ts";
import type { NotifyRecord } from "../../src/ports/notify.ts";
import type {
  DispatchHandle,
  DispatchInput,
  PlanSpec,
  RuntimePort,
  RuntimeStatus,
} from "../../src/ports/runtime.ts";
import { createIpcRuntimeClient } from "../../src/surfaces/ipc-client.ts";
import { createIpcServer } from "../../src/surfaces/ipc-server.ts";
import type { IpcServerHandle } from "../../src/surfaces/ipc-server.ts";

/** Stub RuntimePort — deterministic status map, wake completes the run. */
class StubRuntime implements RuntimePort {
  readonly statuses = new Map<string, RuntimeStatus>();

  async dispatch(input: DispatchInput): Promise<DispatchHandle> {
    const runId = asRunId(input.clientRequestId ?? `stub-${this.statuses.size + 1}`);
    this.statuses.set(runId, { state: "running", parked: false });
    return { runId };
  }

  async runPlan(plan: PlanSpec): Promise<DispatchHandle> {
    const runId = asRunId(plan.id);
    this.statuses.set(runId, { state: "running" });
    return { runId };
  }

  async sendSignal(runId: string, name: string): Promise<void> {
    if (name === "wake") {
      this.statuses.set(runId, {
        state: "completed",
        result: { kind: "settled", sessionRef: `${runId}-sess` },
      });
    }
  }

  async cancel(runId: string): Promise<void> {
    this.statuses.set(runId, { state: "canceled" });
  }

  async getStatus(runId: string): Promise<RuntimeStatus> {
    return this.statuses.get(runId) ?? { state: "pending" };
  }

  async wait(runId: string): Promise<RuntimeStatus> {
    return this.getStatus(runId);
  }
}

const tmpDirs: string[] = [];
const servers: IpcServerHandle[] = [];

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ipc-roundtrip-"));
  tmpDirs.push(d);
  return d;
}

afterEach(async () => {
  for (const s of servers) {
    try { await s.stop(); } catch {
      // ignore
    }
  }
  servers.length = 0;
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true }); } catch {
      // already gone
    }
  }
  tmpDirs.length = 0;
});

function makeServer(runtime: RuntimePort, notifier: InProcessNotifier, endpoint: string) {
  const server = createIpcServer({ runtime, notifier, endpoint });
  servers.push(server);
  return server;
}

describe("daemon IPC server/client round trip (stub runtime)", () => {
  it("dispatch → status → cancel → wait over the HTTP envelope", async () => {
    const dir = tmpDir();
    const endpoint = `unix:${path.join(dir, "ipc.sock")}`;
    const runtime = new StubRuntime();
    const server = makeServer(runtime, new InProcessNotifier(), endpoint);
    await server.start();
    const client = createIpcRuntimeClient({ endpoint });

    try {
      const handle = await client.runtime.dispatch({
        agent: { name: "rt-agent", rootDir: "/tmp/rt" },
        task: "round trip",
        clientRequestId: "rt-1",
      });
      assert.equal(handle.runId, "rt-1");

      const running = await client.runtime.getStatus(handle.runId);
      assert.equal(running.state, "running");

      await client.runtime.cancel(handle.runId);
      const canceled = await client.runtime.wait(handle.runId);
      assert.equal(canceled.state, "canceled");
    } finally {
      await client.stop();
    }
  });

  it("wake verb completes a running run; status reflects settled", async () => {
    const dir = tmpDir();
    const endpoint = `unix:${path.join(dir, "ipc.sock")}`;
    const runtime = new StubRuntime();
    const server = makeServer(runtime, new InProcessNotifier(), endpoint);
    await server.start();
    const client = createIpcRuntimeClient({ endpoint });

    try {
      const handle = await client.runtime.dispatch({
        agent: { name: "wake-agent", rootDir: "/tmp/w" },
        task: "wake me",
        clientRequestId: "wake-1",
      });
      await client.runtime.sendSignal(handle.runId, "wake", {
        payloadText: "go",
        mode: "continue",
      });
      const status = await client.runtime.wait(handle.runId);
      assert.equal(status.state, "completed");
    } finally {
      await client.stop();
    }
  });

  it("SSE push: subscribed client receives settle record without polling", async () => {
    const dir = tmpDir();
    const endpoint = `unix:${path.join(dir, "ipc.sock")}`;
    const notifier = new InProcessNotifier();
    const server = makeServer(new StubRuntime(), notifier, endpoint);
    await server.start();
    const client = createIpcRuntimeClient({ endpoint });

    const received: NotifyRecord[] = [];
    const sub = client.subscribe(undefined, (record) => {
      received.push(record);
    });
    await sub.ready;

    try {
      await notifier.notify({
        runId: asRunId("run-a"),
        sessionRef: undefined,
        event: "settled",
        payload: { result: { kind: "settled" } },
      });
      await notifier.notify({
        runId: asRunId("run-b"),
        event: "parked",
        payload: { reason: "waiting" },
      });

      // small settle window for SSE delivery
      await new Promise((resolve) => { setTimeout(resolve, 80); });
      assert.equal(received.length, 2);
      assert.equal(received[0]?.event, "settled");
      assert.equal(received[0]?.runId, "run-a");
      assert.equal(received[1]?.event, "parked");
      assert.equal(received[1]?.runId, "run-b");
    } finally {
      sub.unsubscribe();
      await client.stop();
    }
  });

  it("SSE runId filter: only matching records are delivered", async () => {
    const dir = tmpDir();
    const endpoint = `unix:${path.join(dir, "ipc.sock")}`;
    const notifier = new InProcessNotifier();
    const server = makeServer(new StubRuntime(), notifier, endpoint);
    await server.start();
    const client = createIpcRuntimeClient({ endpoint });

    const received: NotifyRecord[] = [];
    const sub = client.subscribe("run-x", (record) => {
      received.push(record);
    });
    await sub.ready;

    try {
      await notifier.notify({ runId: asRunId("run-y"), event: "settled" });
      await notifier.notify({ runId: asRunId("run-x"), event: "failed" });
      await new Promise((resolve) => { setTimeout(resolve, 80); });
      assert.equal(received.length, 1);
      assert.equal(received[0]?.runId, "run-x");
      assert.equal(received[0]?.event, "failed");
    } finally {
      sub.unsubscribe();
      await client.stop();
    }
  });

  it("health endpoint reports daemon metadata", async () => {
    const dir = tmpDir();
    const endpoint = `unix:${path.join(dir, "ipc.sock")}`;
    const server = makeServer(new StubRuntime(), new InProcessNotifier(), endpoint);
    await server.start();
    const client = createIpcRuntimeClient({ endpoint });

    try {
      const res = await requestHealth(endpoint);
      assert.equal(res.ok, true);
      assert.equal(res.result.pid, process.pid);
      assert.equal(res.result.socketPath, path.join(dir, "ipc.sock"));
    } finally {
      await client.stop();
    }
  });

  it("client surfaces daemon-not-running for a dead endpoint", async () => {
    const dir = tmpDir();
    const endpoint = `unix:${path.join(dir, "no-server.sock")}`;
    const client = createIpcRuntimeClient({ endpoint });
    try {
      await assert.rejects(
        () => client.runtime.getStatus(asRunId("nope")),
        /DAEMON_NOT_RUNNING/u,
      );
    } finally {
      await client.stop();
    }
  });

  it("runtime errors surface as envelope codes (not raw HTTP errors)", async () => {
    const dir = tmpDir();
    const endpoint = `unix:${path.join(dir, "ipc.sock")}`;
    const runtime = new StubRuntime();
    runtime.getStatus = async () => {
      throw new Error("boom");
    };
    const server = makeServer(runtime, new InProcessNotifier(), endpoint);
    await server.start();
    const client = createIpcRuntimeClient({ endpoint });
    try {
      await assert.rejects(
        () => client.runtime.getStatus(asRunId("x")),
        /RUNTIME_FAILED/u,
      );
    } finally {
      await client.stop();
    }
  });

  it("unknown endpoint returns NOT_FOUND envelope", async () => {
    const dir = tmpDir();
    const endpoint = `unix:${path.join(dir, "ipc.sock")}`;
    const server = makeServer(new StubRuntime(), new InProcessNotifier(), endpoint);
    await server.start();
    const res = await rawRequest(endpoint, "GET", "/api/nope");
    assert.equal(res.status, 404);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error!.code, "NOT_FOUND");
  });
});

function requestHealth(endpoint: string): Promise<{
  ok: boolean;
  result: { pid: number; socketPath: string | null };
}> {
  return rawRequest(endpoint, "GET", "/api/health").then(
    (r) => r.body as { ok: boolean; result: { pid: number; socketPath: string | null } },
  );
}

function rawRequest(
  endpoint: string,
  method: string,
  ipcPath: string,
  body?: unknown,
): Promise<{ status: number; body: { ok: boolean; error?: { code: string }; result?: unknown } }> {
  let resolveFn!: (v: { status: number; body: { ok: boolean; error?: { code: string }; result?: unknown } }) => void;
  let rejectFn!: (e: unknown) => void;
  const settledPromise = new Promise<{ status: number; body: { ok: boolean; error?: { code: string }; result?: unknown } }>(
    (res, rej) => { resolveFn = res; rejectFn = rej; },
  );
  let settled = false;
  const settle = (fn: () => void) => { if (settled) return; settled = true; fn(); };
  {
    const bodyText = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        socketPath: endpoint.slice("unix:".length),
        method,
        path: ipcPath,
        agent: false,
        headers: bodyText !== undefined
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyText) }
          : {},
      },
      (res) => {
        let text = "";
        res.on("data", (chunk: Buffer) => { text += chunk.toString("utf8"); });
        res.on("end", () => {
          settle(() => {
            try {
              resolveFn({ status: res.statusCode ?? 0, body: JSON.parse(text) });
            } catch (err) {
              rejectFn(err);
            }
          });
        });
      },
    );
    req.on("error", (err) => settle(() => rejectFn(err)));
    if (bodyText !== undefined) req.write(bodyText);
    req.end();
  }
  return settledPromise;
}
