/**
 * Daemon IPC protocol — shared DTOs + framing for the daemon control/notify
 * surface (phase-2 daemon IPC slice).
 *
 * Layer: L5 surfaces. Pure DTOs only — imports domain/ports types, no app
 * internals, no adapters, no vendors. Both `ipc-server.ts` and `ipc-client.ts`
 * consume this module so the wire contract stays single-sourced.
 *
 * Transport: HTTP over a local Unix domain socket (node:http), SSE for
 * server→client push. See outbox/DAEMON-IPC-DESIGN.md for the decision.
 */

import type { PlanSpec } from "../ports/runtime.ts";
import type { DispatchInput } from "../ports/runtime.ts";
import type { NotifyRecord } from "../ports/notify.ts";

// ── Endpoint names ───────────────────────────────────────────────────────────

export const IPC_ENDPOINT_DISPATCH = "/api/dispatch" as const;
export const IPC_ENDPOINT_PLAN = "/api/plan" as const;
export const IPC_ENDPOINT_STATUS = "/api/status" as const;
export const IPC_ENDPOINT_WAIT = "/api/wait" as const;
export const IPC_ENDPOINT_CANCEL = "/api/cancel" as const;
export const IPC_ENDPOINT_SIGNAL = "/api/signal" as const;
export const IPC_ENDPOINT_WAKE = "/api/wake" as const;
export const IPC_ENDPOINT_EVENTS = "/api/events" as const;
export const IPC_ENDPOINT_HEALTH = "/api/health" as const;

/** Default socket file name next to the OW sqlite DB. */
export const DEFAULT_IPC_SOCKET_NAME = "mediation-ipc.sock" as const;

/**
 * Endpoint string forms:
 *   unix:/absolute/path/to.sock   — HTTP over Unix domain socket (POSIX)
 *   http://127.0.0.1:PORT         — TCP loopback fallback (Windows)
 */
export type IpcEndpoint = string;

export type IpcTransport = {
  /** host header / authority used in requests (unix: "localhost"). */
  readonly authority: string;
  /** node:http request option — socketPath (unix) or host/port (tcp). */
  readonly socketPath?: string;
  readonly host?: string;
  readonly port?: number;
};

/**
 * Parse an endpoint string into node:http connect options.
 * unix:/x.sock → { authority: "localhost", socketPath: "/x.sock" }
 * http://127.0.0.1:8123 → { authority: "127.0.0.1:8123", host, port }
 * Throws on malformed endpoints (fail-closed).
 */
export function parseIpcEndpoint(endpoint: IpcEndpoint): IpcTransport {
  if (endpoint.startsWith("unix:")) {
    const socketPath = endpoint.slice("unix:".length);
    if (socketPath === "") {
      throw new Error(`ipc: empty unix socket path in endpoint "${endpoint}"`);
    }
    return { authority: "localhost", socketPath };
  }
  if (endpoint.startsWith("http://")) {
    const rest = endpoint.slice("http://".length);
    const slash = rest.indexOf("/");
    const authority = slash >= 0 ? rest.slice(0, slash) : rest;
    const [host, portRaw] = authority.split(":");
    if (!host || !portRaw) {
      throw new Error(`ipc: malformed tcp endpoint "${endpoint}" (need http://host:port)`);
    }
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
      throw new Error(`ipc: invalid port in endpoint "${endpoint}"`);
    }
    return { authority, host, port };
  }
  throw new Error(
    `ipc: unsupported endpoint "${endpoint}" (use unix:/path.sock or http://127.0.0.1:port)`,
  );
}

// ── Request DTOs ─────────────────────────────────────────────────────────────

/** POST /api/dispatch body — mirrors RuntimePort.dispatch. */
export type IpcDispatchRequest = DispatchInput;

/** POST /api/plan body — mirrors RuntimePort.runPlan. */
export type IpcPlanRequest = PlanSpec;

/** POST /api/wait body. */
export type IpcWaitRequest = {
  readonly runId: string;
  readonly timeoutMs?: number;
};

/** POST /api/cancel body. */
export type IpcCancelRequest = {
  readonly runId: string;
};

/** POST /api/signal body — mirrors RuntimePort.sendSignal. */
export type IpcSignalRequest = {
  readonly runId: string;
  readonly name: string;
  readonly data?: unknown;
};

/** Wake payload (RuntimePort.sendSignal "wake" data). */
export type IpcWakeData = {
  readonly payloadText: string;
  readonly mode?: "prompt" | "continue";
  readonly parkIntent?: boolean;
  readonly parkReason?: string;
};

/** POST /api/wake body. */
export type IpcWakeRequest = {
  readonly runId: string;
  readonly data: IpcWakeData;
};

// ── Response envelope ────────────────────────────────────────────────────────

export type IpcSuccess<T = unknown> = {
  readonly ok: true;
  readonly result: T;
};

export type IpcFailure = {
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
};

export type IpcResponse<T = unknown> = IpcSuccess<T> | IpcFailure;

export function ipcSuccess<T>(result: T): IpcSuccess<T> {
  return { ok: true, result };
}

export function ipcFailure(code: string, message: string): IpcFailure {
  return { ok: false, error: { code, message } };
}

/** HTTP status for an envelope (success → 200, failure → 500 default). */
export function ipcStatus(response: IpcResponse<unknown>): number {
  return response.ok ? 200 : 500;
}

// ── SSE framing (server write / client parse) ────────────────────────────────

/** SSE event name for a notify record — mirrors NotifyRecord.event. */
export function sseEventName(event: NotifyRecord["event"]): string {
  return event;
}

/** Serialize one notify record into an SSE frame (no trailing blank line). */
export function sseFrame(
  event: NotifyRecord["event"] | "connected",
  data: unknown,
): string {
  const json = typeof data === "string" ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${json}\n\n`;
}

export type SseFrameMessage = {
  readonly event: string;
  readonly data: string;
};

/**
 * Parse an SSE frame buffer into frames. Handles CRLF/LF and multiple frames
 * per chunk; ignores comment lines (`: ping`). NotifyRecord events carry a
 * JSON data payload.
 */
export function parseSseFrames(chunk: string): SseFrameMessage[] {
  const frames: SseFrameMessage[] = [];
  for (const block of chunk.split(/\r?\n\r?\n/u)) {
    const lines = block.split(/\r?\n/u);
    let event: string | undefined;
    const data: string[] = [];
    for (const line of lines) {
      if (line.startsWith(":")) {
        // comment / keepalive
        continue;
      }
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        data.push(line.slice("data:".length).trimStart());
      }
    }
    if (event !== undefined && data.length > 0) {
      frames.push({ event, data: data.join("\n") });
    }
  }
  return frames;
}
