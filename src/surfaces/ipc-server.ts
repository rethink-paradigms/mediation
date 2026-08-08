/**
 * Daemon IPC server — L5 surface exposing a RuntimePort + notify push over
 * HTTP (Unix domain socket by default; TCP loopback fallback).
 *
 * Layer law (D4 A1/A3, D5): this is a thin connector over INJECTED ports only.
 * It wraps the daemon's `RuntimePort` for control verbs and an
 * `ObservableNotifyPort` for server→client push (SSE). It never imports app
 * internals, adapters, or vendors, and it never constructs a Presence — the
 * monocoque one-door law is untouched.
 *
 * Endpoints (see ipc-protocol.ts):
 *   POST /api/dispatch | /api/plan | /api/wait | /api/cancel
 *        /api/signal  | /api/wake
 *   GET  /api/status?runId= | /api/events[?runId=] | /api/health
 *
 * Usage (daemon composition root wires the ports):
 *   const server = createIpcServer({ runtime, notifier, endpoint });
 *   await server.start();
 *   ...
 *   await server.stop();
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";

import type { RuntimePort } from "../ports/runtime.ts";
import type { ObservableNotifyPort } from "../ports/notify.ts";
import {
  IPC_ENDPOINT_CANCEL,
  IPC_ENDPOINT_DISPATCH,
  IPC_ENDPOINT_EVENTS,
  IPC_ENDPOINT_HEALTH,
  IPC_ENDPOINT_PLAN,
  IPC_ENDPOINT_SIGNAL,
  IPC_ENDPOINT_STATUS,
  IPC_ENDPOINT_WAIT,
  IPC_ENDPOINT_WAKE,
  ipcFailure,
  ipcStatus,
  ipcSuccess,
  parseIpcEndpoint,
  sseFrame,
  type IpcEndpoint,
  type IpcTransport,
} from "./ipc-protocol.ts";

/** Wake signal name — aligned with adapters/openworkflow/signals.ts (kept in
 * the protocol so the surface layer does not import the adapter module). */
export const IPC_WAKE_SIGNAL_NAME = "wake" as const;

export type IpcServerOptions = {
  /** RuntimePort the daemon composes (dispatch/status/wait/cancel/signal). */
  readonly runtime: RuntimePort;
  /** In-process observable notifier the daemon wires (SSE fan-out). */
  readonly notifier: ObservableNotifyPort;
  /**
   * Endpoint string: unix:/path.sock (POSIX) or http://127.0.0.1:port (TCP
   * fallback). Default: unix:<dbDir>/mediation-ipc.sock is chosen by the
   * caller (daemon) — this option is required for explicitness.
   */
  readonly endpoint: IpcEndpoint;
  /** Max request body bytes (default 1 MiB) — fail-closed overlimit. */
  readonly maxBodyBytes?: number;
};

export type IpcServerHandle = {
  /** Start listening (unix socket or tcp). Resolves when bound. */
  start(): Promise<void>;
  /** Close the http server + remove the socket file (idempotent). */
  stop(): Promise<void>;
  /** Endpoint string actually bound (tcp ephemeral ports resolved here). */
  readonly endpoint: IpcEndpoint;
  /** Bound address (unix: { path }; tcp: { address, port }). */
  address(): { path?: string; host?: string; port?: number };
  /** Uptime ms since start. */
  uptimeMs(): number;
};

const DEFAULT_MAX_BODY_BYTES = 1_024 * 1_024;

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`ipc: request body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

/** Write an envelope as JSON (no-op if the response already ended). */
function respond(
  res: http.ServerResponse,
  body: ReturnType<typeof ipcSuccess> | ReturnType<typeof ipcFailure>,
  status?: number,
): void {
  if (res.writableEnded) return;
  res.writeHead(status ?? ipcStatus(body), { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Create the daemon IPC server. start() must be called before clients connect.
 */
export function createIpcServer(opts: IpcServerOptions): IpcServerHandle {
  const { runtime, notifier } = opts;
  const endpoint = opts.endpoint;
  const transport = parseIpcEndpoint(endpoint);
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  const startedAt = Date.now();
  let server: http.Server | null = null;
  let boundPath: string | undefined;
  let boundHost: string | undefined;
  let boundPort: number | undefined;
  let stopped = false;

  const serverImpl = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");

    try {
      // ── SSE events (server→client push) ──────────────────────────────
      if (method === "GET" && url.pathname === IPC_ENDPOINT_EVENTS) {
        serveEvents(url, res);
        return;
      }

      if (method === "GET" && url.pathname === IPC_ENDPOINT_HEALTH) {
        const result = {
          ok: true,
          pid: process.pid,
          dbPath: process.env.MEDIATION_DB_PATH ?? null,
          socketPath: boundPath ?? null,
          endpoint,
          uptimeMs: Date.now() - startedAt,
        };
        respond(res, ipcSuccess(result));
        return;
      }

      if (method === "GET" && url.pathname === IPC_ENDPOINT_STATUS) {
        const runId = url.searchParams.get("runId");
        if (!runId) {
          respond(res, ipcFailure("INVALID_REQUEST", "missing runId query param"), 400);
          return;
        }
        respond(res, ipcSuccess(await runtime.getStatus(runId as never)));
        return;
      }

      // ── JSON-body verbs ──────────────────────────────────────────────
      const bodyText = await readBody(req, maxBodyBytes);
      let body: unknown;
      try {
        body = bodyText === "" ? {} : JSON.parse(bodyText);
      } catch {
        respond(res, ipcFailure("INVALID_JSON", "request body is not valid JSON"), 400);
        return;
      }

      switch (`${method} ${url.pathname}`) {
        case `POST ${IPC_ENDPOINT_DISPATCH}`: {
          const input = body as Parameters<RuntimePort["dispatch"]>[0];
          if (!input || typeof input !== "object" || !("task" in input)) {
            respond(res, ipcFailure("INVALID_REQUEST", "dispatch requires DispatchInput body"), 400);
            return;
          }
          const handle = await runtime.dispatch(input);
          respond(res, ipcSuccess(handle));
          return;
        }
        case `POST ${IPC_ENDPOINT_PLAN}`: {
          const plan = body as Parameters<RuntimePort["runPlan"]>[0];
          if (!plan || typeof plan !== "object" || !("nodes" in plan)) {
            respond(res, ipcFailure("INVALID_REQUEST", "plan requires PlanSpec body"), 400);
            return;
          }
          const handle = await runtime.runPlan(plan);
          respond(res, ipcSuccess(handle));
          return;
        }
        case `POST ${IPC_ENDPOINT_WAIT}`: {
          const { runId, timeoutMs } = body as {
            runId?: string;
            timeoutMs?: number;
          };
          if (!runId) {
            respond(res, ipcFailure("INVALID_REQUEST", "wait requires runId"), 400);
            return;
          }
          const status = await runtime.wait(
            runId as never,
            timeoutMs !== undefined ? { timeoutMs } : undefined,
          );
          respond(res, ipcSuccess(status));
          return;
        }
        case `POST ${IPC_ENDPOINT_CANCEL}`: {
          const { runId } = body as { runId?: string };
          if (!runId) {
            respond(res, ipcFailure("INVALID_REQUEST", "cancel requires runId"), 400);
            return;
          }
          await runtime.cancel(runId as never);
          respond(res, ipcSuccess({}));
          return;
        }
        case `POST ${IPC_ENDPOINT_SIGNAL}`: {
          const { runId, name, data } = body as {
            runId?: string;
            name?: string;
            data?: unknown;
          };
          if (!runId || !name) {
            respond(res, ipcFailure("INVALID_REQUEST", "signal requires runId and name"), 400);
            return;
          }
          await runtime.sendSignal(runId as never, name, data);
          respond(res, ipcSuccess({}));
          return;
        }
        case `POST ${IPC_ENDPOINT_WAKE}`: {
          const { runId, data } = body as {
            runId?: string;
            data?: unknown;
          };
          if (!runId || !data || typeof data !== "object") {
            respond(res, ipcFailure("INVALID_REQUEST", "wake requires runId and data"), 400);
            return;
          }
          await runtime.sendSignal(runId as never, IPC_WAKE_SIGNAL_NAME, data);
          respond(res, ipcSuccess({}));
          return;
        }
        default:
          respond(res, ipcFailure("NOT_FOUND", `no endpoint ${method} ${url.pathname}`), 404);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof Error && "code" in err
        ? String((err as { readonly code?: unknown }).code ?? "RUNTIME_FAILED")
        : "RUNTIME_FAILED";
      respond(res, ipcFailure(code, message), 500);
    }
  }

  function serveEvents(url: URL, res: http.ServerResponse): void {
    const runId = url.searchParams.get("runId") ?? undefined;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(sseFrame("connected", { runId: runId ?? null }));

    const unsub = notifier.on((record) => {
      if (runId !== undefined && record.runId !== runId) return;
      if (res.writableEnded) return;
      res.write(sseFrame(record.event, record));
    });

    res.on("close", () => {
      unsub();
    });
    res.on("error", () => {
      unsub();
    });
  }

  return {
    endpoint,
    address(): { path?: string; host?: string; port?: number } {
      return { path: boundPath, host: boundHost, port: boundPort };
    },
    uptimeMs: () => Date.now() - startedAt,
    async start(): Promise<void> {
      if (server !== null) return;
      if (stopped) {
        throw new Error("ipc: server already stopped");
      }
      await listenWithCleanup(serverImpl, transport, endpoint);
      const addr = serverImpl.address() as AddressInfo | string | null;
      if (transport.socketPath !== undefined) {
        boundPath = transport.socketPath;
        // Local-only by construction: only the owning user touches the socket.
        try {
          fs.chmodSync(transport.socketPath, 0o600);
        } catch {
          // best-effort — directory perms still protect on shared /tmp
        }
      } else if (addr !== null && typeof addr === "object") {
        boundHost = addr.address;
        boundPort = addr.port;
      }
    },
    async stop(): Promise<void> {
      if (server === null || stopped) return;
      stopped = true;
      await new Promise<void>((resolve) => {
        serverImpl.close(() => resolve());
        // Force-close lingering sockets (keep-alive + SSE): close() alone
        // waits forever for open connections, hanging the process on teardown
        // (node >= 18.2). stop() must always mean stop.
        serverImpl.closeAllConnections?.();
      });
      // Let socket close events propagate before releasing: a fast teardown
      // can otherwise leave ref'd sockets a tick longer and hold the event
      // loop open (test-process hang). Deterministic stop for every caller.
      await new Promise<void>((r) => { setTimeout(r, 20); });
      server = null;
      if (boundPath !== undefined) {
        try {
          fs.unlinkSync(boundPath);
        } catch {
          // already gone
        }
        boundPath = undefined;
      }
    },
  };
}

/** Listen on a unix socket (removing a stale file) or tcp loopback. */
async function listenWithCleanup(
  serverImpl: http.Server,
  transport: IpcTransport,
  endpoint: IpcEndpoint,
): Promise<void> {
  if (transport.socketPath !== undefined) {
    try {
      await listenOnce(serverImpl, { path: transport.socketPath });
      return;
    } catch (err) {
      const code = (err as { readonly code?: string }).code;
      if (code === "EADDRINUSE" || code === "EACCES") {
        // Stale socket file? Probe: if nothing answers, unlink and retry once.
        if (await isSocketAlive(transport.socketPath)) {
          throw new Error(
            `ipc: another daemon is listening on ${transport.socketPath} (EADDRINUSE)`,
            { cause: err },
          );
        }
        try {
          fs.unlinkSync(transport.socketPath);
        } catch {
          // ignore
        }
        await listenOnce(serverImpl, { path: transport.socketPath });
        return;
      }
      throw err;
    }
  }
  if (transport.host !== undefined && transport.port !== undefined) {
    await listenOnce(serverImpl, { host: transport.host, port: transport.port });
    return;
  }
  throw new Error(`ipc: cannot listen on endpoint "${endpoint}"`);
}

function listenOnce(
  serverImpl: http.Server,
  opts: { path?: string; host?: string; port?: number },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      serverImpl.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      serverImpl.removeListener("error", onError);
      resolve();
    };
    serverImpl.once("error", onError);
    serverImpl.once("listening", onListening);
    serverImpl.listen(opts);
  });
}

/** Probe a unix socket path for a live HTTP server (short timeout). */
function isSocketAlive(socketPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const net = { socketPath, path: "/api/health", method: "GET" };
    const req = http.request(net, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.setTimeout(500, () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
    req.end();
  });
}

