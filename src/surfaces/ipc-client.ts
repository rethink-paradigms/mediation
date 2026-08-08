/**
 * Daemon IPC client — RuntimePort transport over HTTP (unix socket default;
 * TCP loopback fallback) + SSE notify subscription + daemon auto-spawn.
 *
 * Shape matches `createRuntimeClient` (adapters/openworkflow/host.ts):
 *   { runtime: RuntimePort, stop(): Promise<void> }
 * plus `subscribe` for server→client push (parked/settled/failed/interrupted)
 * and `ensureDaemon` for first-connect lifecycle.
 *
 * Layer: L5 surfaces — implements ports/runtime.ts only; no app/adapters.
 */

import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";

import type {
  DispatchHandle,
  DispatchInput,
  PlanSpec,
  RuntimePort,
  RuntimeStatus,
} from "../ports/runtime.ts";
import type { NotifyRecord } from "../ports/notify.ts";
import {
  IPC_ENDPOINT_CANCEL,
  IPC_ENDPOINT_DISPATCH,
  IPC_ENDPOINT_EVENTS,
  IPC_ENDPOINT_HEALTH,
  IPC_ENDPOINT_PLAN,
  IPC_ENDPOINT_SIGNAL,
  IPC_ENDPOINT_STATUS,
  IPC_ENDPOINT_WAIT,
  parseIpcEndpoint,
  parseSseFrames,
  type IpcEndpoint,
  type IpcResponse,
  type IpcTransport,
} from "./ipc-protocol.ts";

/** Absolute path to the daemon entry point (auto-spawn). */
const DAEMON_PATH = path.resolve(import.meta.dirname, "daemon.ts");

export type IpcClientOptions = {
  /** unix:/path.sock or http://127.0.0.1:port. */
  readonly endpoint: IpcEndpoint;
  /** Per-request timeout (default 310s — covers daemon-side wait default). */
  readonly timeoutMs?: number;
};

export type IpcRuntimeClient = {
  readonly runtime: RuntimePort;
  /** Endpoint string this client talks to. */
  readonly endpoint: IpcEndpoint;
  /**
   * Subscribe to notify push (SSE). Optional runId filter. Resolves when the
   * server acknowledged the subscription (connected frame) or rejects on
   * connect error.
   */
  subscribe(
    runId?: string,
    listener?: (record: NotifyRecord) => void,
  ): { readonly ready: Promise<void>; readonly unsubscribe: () => void };
  /** Close all open connections (idempotent). */
  stop(): Promise<void>;
};

export type IpcClientError = Error & { readonly code?: string };

function ipcError(code: string, message: string): IpcClientError {
  const err = new Error(`ipc: ${code}: ${message}`) as IpcClientError;
  (err as { code?: string }).code = code;
  return err;
}

function requestJson<T>(
  transport: IpcTransport,
  method: string,
  ipcPath: string,
  body: unknown,
  timeoutMs: number,
): Promise<IpcResponse<T>> {
  return new Promise<IpcResponse<T>>((resolve, reject) => {
    const bodyText = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        ...(transport.socketPath !== undefined
          ? { socketPath: transport.socketPath }
          : { host: transport.host, port: transport.port }),
        method,
        path: ipcPath,
        headers: {
          "Content-Type": "application/json",
          ...(bodyText !== undefined ? { "Content-Length": Buffer.byteLength(bodyText) } : {}),
        },
      },
      (res) => {
        let text = "";
        res.on("data", (chunk: Buffer) => {
          text += chunk.toString("utf8");
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(text) as IpcResponse<T>;
            resolve(parsed);
          } catch {
            reject(ipcError("BAD_RESPONSE", `non-JSON response (status ${res.statusCode ?? "?"}): ${text.slice(0, 200)}`));
          }
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(ipcError("TIMEOUT", `request timed out after ${timeoutMs}ms`));
    });
    req.on("error", (err) => {
      const code = (err as { readonly code?: string }).code;
      reject(
        code === "ECONNREFUSED" || code === "ENOENT" || code === "EADDRINUSE"
          ? ipcError("DAEMON_NOT_RUNNING", `cannot reach daemon at ${describeTransport(transport)} (${String(code)})`)
          : err,
      );
    });
    if (bodyText !== undefined) req.write(bodyText);
    req.end();
  });
}

function describeTransport(transport: IpcTransport): string {
  return transport.socketPath !== undefined
    ? `unix:${transport.socketPath}`
    : `http://${String(transport.host)}:${String(transport.port)}`;
}

function unwrap<T>(response: IpcResponse<T>): T {
  if (response.ok) return response.result;
  throw ipcError(response.error.code, response.error.message);
}

/**
 * Build a RuntimePort over the daemon IPC transport + SSE subscription.
 * Caller owns `stop()` (closes the SSE connection).
 */
export function createIpcRuntimeClient(opts: IpcClientOptions): IpcRuntimeClient {
  const transport = parseIpcEndpoint(opts.endpoint);
  const timeoutMs = opts.timeoutMs ?? 310_000;
  const sseConnections = new Set<http.ClientRequest>();

  const runtime: RuntimePort = {
    async dispatch(input: DispatchInput): Promise<DispatchHandle> {
      const res = await requestJson<DispatchHandle>(transport, "POST", IPC_ENDPOINT_DISPATCH, input, timeoutMs);
      return unwrap(res);
    },
    async runPlan(plan: PlanSpec): Promise<DispatchHandle> {
      const res = await requestJson<DispatchHandle>(transport, "POST", IPC_ENDPOINT_PLAN, plan, timeoutMs);
      return unwrap(res);
    },
    async sendSignal(runId, name, data): Promise<void> {
      const res = await requestJson(transport, "POST", IPC_ENDPOINT_SIGNAL, { runId, name, data }, timeoutMs);
      unwrap(res);
    },
    async cancel(runId): Promise<void> {
      const res = await requestJson(transport, "POST", IPC_ENDPOINT_CANCEL, { runId }, timeoutMs);
      unwrap(res);
    },
    async getStatus(runId): Promise<RuntimeStatus> {
      const q = new URLSearchParams({ runId });
      const res = await requestJson<RuntimeStatus>(transport, "GET", `${IPC_ENDPOINT_STATUS}?${q.toString()}`, undefined, timeoutMs);
      return unwrap(res);
    },
    async wait(runId, wopts): Promise<RuntimeStatus> {
      const res = await requestJson<RuntimeStatus>(
        transport,
        "POST",
        IPC_ENDPOINT_WAIT,
        { runId, timeoutMs: wopts?.timeoutMs },
        timeoutMs,
      );
      return unwrap(res);
    },
  };

  function subscribe(
    runId?: string,
    listener?: (record: NotifyRecord) => void,
  ): { readonly ready: Promise<void>; readonly unsubscribe: () => void } {
    let settled = false;
    let readyResolve!: () => void;
    let readyReject!: (err: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });

    const q = new URLSearchParams();
    if (runId !== undefined) q.set("runId", runId);
    const query = q.toString();
    const req = http.request(
      {
        ...(transport.socketPath !== undefined
          ? { socketPath: transport.socketPath }
          : { host: transport.host, port: transport.port }),
        method: "GET",
        path: query === "" ? IPC_ENDPOINT_EVENTS : `${IPC_ENDPOINT_EVENTS}?${query}`,
        agent: false,
        headers: { Accept: "text/event-stream" },
      },
      (res) => {
        if (res.statusCode !== 200) {
          const err = ipcError("SUBSCRIBE_FAILED", `events endpoint returned ${String(res.statusCode)}`);
          if (!settled) {
            settled = true;
            readyReject(err);
          }
          res.resume();
          return;
        }
        let buffer = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf8");
          // Frame boundary: blank line (LF or CRLF).
          const boundary = /\r?\n\r?\n/u;
          let match: RegExpExecArray | null;
          while ((match = boundary.exec(buffer)) !== null) {
            const frameText = buffer.slice(0, match.index);
            buffer = buffer.slice(match.index + match[0].length);
            for (const frame of parseSseFrames(frameText)) {
              handleFrame(frame.event, frame.data);
            }
          }
        });
        res.on("end", () => {
          // tail frame without trailing blank line
          for (const frame of parseSseFrames(buffer)) {
            handleFrame(frame.event, frame.data);
          }
          buffer = "";
        });
        res.on("error", (err) => {
          if (!settled) {
            settled = true;
            readyReject(err);
          }
        });
      },
    );

    req.on("error", (err) => {
      const code = (err as { readonly code?: string }).code;
      if (!settled) {
        settled = true;
        readyReject(
          code === "ECONNREFUSED" || code === "ENOENT"
            ? ipcError("DAEMON_NOT_RUNNING", `cannot reach daemon at ${describeTransport(transport)} (${String(code)})`)
            : err,
        );
      }
    });

    // GET — flush the request (server pushes frames; no body).
    req.end();

    sseConnections.add(req);
    const unsubscribe = () => {
      req.destroy();
      sseConnections.delete(req);
    };

    function handleFrame(event: string, data: string): void {
      if (event === "connected") {
        if (!settled) {
          settled = true;
          readyResolve();
        }
        return;
      }
      if (listener === undefined) return;
      try {
        const record = JSON.parse(data) as NotifyRecord;
        if (runId !== undefined && record.runId !== runId) return;
        listener(record);
      } catch {
        // malformed record frame — ignore (protocol hygiene)
      }
    }

    return { ready, unsubscribe };
  }

  return {
    runtime,
    endpoint: opts.endpoint,
    subscribe,
    async stop(): Promise<void> {
      for (const req of [...sseConnections]) {
        req.destroy();
      }
      sseConnections.clear();
    },
  };
}

// ── Auto-spawn ───────────────────────────────────────────────────────────────

export type EnsureDaemonOptions = {
  /** unix:/path.sock or http://127.0.0.1:port — where the daemon must answer. */
  readonly endpoint: IpcEndpoint;
  /** Extra env for the daemon child (merged over process.env). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Wait budget for the socket to answer (default 10_000ms). */
  readonly timeoutMs?: number;
  /** Override daemon entry (tests). */
  readonly daemonPath?: string;
};

export type EnsureDaemonResult = {
  /** True when this call spawned the daemon. */
  readonly spawned: boolean;
};

/**
 * First-connect lifecycle: probe the endpoint; if nothing answers, spawn the
 * daemon child and wait for it to serve /api/health. Returns once the daemon
 * is reachable (or rejects after timeoutMs).
 *
 * The daemon is detached from the caller's stdio (everliving process); env is
 * inherited so MEDIATION_DB_PATH / MEDIATION_PROJECT_ROOT / MEDIATION_IPC flow
 * through. The daemon itself derives its socket from MEDIATION_IPC when set.
 */
export async function ensureDaemon(opts: EnsureDaemonOptions): Promise<EnsureDaemonResult> {
  const endpoint = opts.endpoint;
  const transport = parseIpcEndpoint(endpoint);
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const daemonPath = opts.daemonPath ?? DAEMON_PATH;

  if (await pingDaemon(transport, 700)) {
    return { spawned: false };
  }

  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", daemonPath],
    {
      env: {
        ...process.env,
        ...opts.env,
        MEDIATION_IPC: endpoint,
      },
      stdio: "ignore",
    },
  );
  child.unref();

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await pingDaemon(transport, 700)) {
      return { spawned: true };
    }
    if (Date.now() >= deadline) {
      throw ipcError(
        "DAEMON_SPAWN_TIMEOUT",
        `daemon did not answer at ${describeTransport(transport)} within ${timeoutMs}ms`,
      );
    }
    await sleep(120);
  }
}

/** Probe /api/health once; resolves false on any connect/response failure. */
function pingDaemon(transport: IpcTransport, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req = http.request(
      {
        ...(transport.socketPath !== undefined
          ? { socketPath: transport.socketPath }
          : { host: transport.host, port: transport.port }),
        method: "GET",
        path: IPC_ENDPOINT_HEALTH,
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}
