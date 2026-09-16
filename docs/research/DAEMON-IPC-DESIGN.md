# DAEMON-IPC-DESIGN — daemon control/notify surface (phase 2 building block)

**Slice:** `slice/phase2-daemon-ipc` · **Status:** ACCEPTED (this doc) + implemented
**Date:** 2026-08-16 · **Package:** @company/mediation · **Transport decision:** HTTP over a local Unix domain socket (node:http only), SSE for server→client push. **Fallback:** TCP loopback 127.0.0.1 + port file.

---

## 1. Problem

The daemon (`src/surfaces/daemon.ts`) is the production form of process isolation:
an everliving OW Worker process that claims runs and executes each engagement leaf
in a child process (Pi SDK only inside children). Today the **only** control path is
the CLI's sqlite runtime client: `createRuntimeClient({ dbPath: MEDIATION_DB_PATH })`
opens the daemon's OW BackendSqlite file from another process and reads/writes runs
directly.

The design corpus flags the daemon transport as **UNDECIDED**: how should the CLI /
the Pi extension / a future MCP adapter talk to the daemon — HTTP socket vs named
pipe vs file queue? This slice decides it and ships the first implementation.

Three gaps the IPC surface must close:

1. **Control seam** — direct sqlite file access couples every client to the OW
   backend schema and to the exact db file layout; `status`/`wait`/`cancel`/`wake`
   become DB queries instead of façade calls.
2. **Notify direction (design law D3 P4 + SURFACES issue #3)** — the design's
   notify→interrupt path needs **server→client push**: a caller Pi session must
   learn "parked / settled / failed" *without polling*. Today NotifyPort has no
   external transport, and spawn mode (child processes) does not carry notify at
   all (documented first-pour limitation in MIGRATION-SPAWN.md row 5).
3. **Lifecycle** — the daemon should be spawnable on first connect and probeable
   for health, not assumed running.

## 2. Surface law (constraints read from the knowledge model)

- **D4 A1 — layer direction:** dependencies flow Surfaces → Application →
  Domain/Ports → Adapters → Vendors. The IPC server is an **L5 surface**: it may
  depend on `ports/*` + `domain/*` + the protocol module, never on app internals
  or adapters.
- **D4 A3 — one public door:** surfaces call the façade / ports — never
  `createAgentSession`, never Presence construction. The IPC server wraps the
  **injected** `RuntimePort` + `ObservableNotifyPort`; it constructs nothing.
- **D5 — medium independence:** "CLI / MCP / Pi extension → SurfacePort";
  "OW sqlite file / worker process → RuntimePort + RuntimeHost". The IPC client is
  a **RuntimePort transport**, the same face `createRuntimeClient` already exposes —
  so CLI runtime verbs, a Pi extension, and an MCP adapter all share one client
  shape and the monocoque letter is preserved.
- **engineering-sphere D-Surfaces:** surfaces are adapters (skins), abstract =
  Mediation / RuntimePort / Presence. An IPC client behind `SurfacePort` (CLI) and
  an IPC server exposing `RuntimePort` (daemon) are exactly that: thin skins over
  the same abstract faces, not a second door.

Consequence: the server must be **dependency-free of the monocoque body** (no
`app/mediation`, no `adapters/*` imports) and must not become a public Presence
constructor. Client and server share one protocol module of DTOs.

## 3. Candidate transports vs the evaluation axes

| Axis | HTTP over Unix socket (node:http) | TCP loopback HTTP | Raw Unix named pipe (SOCK_STREAM, node:net) | File queue (sqlite status + drop-file commands) |
|---|---|---|---|---|
| **Dependency footprint** | node:http only — zero new deps | node:http only | node:net only | node:fs/sqlite only |
| **Security (local-only)** | Socket file, chmod 0600; no TCP surface at all; per-user tmp/db dir | Must bind 127.0.0.1 explicitly; LAN-safe but a real TCP port | Socket file perms; local-only by construction | File perms; local-only |
| **Lifecycle (auto-spawn)** | Socket file is a natural readiness probe (`connect` + `/api/health`); daemon unlinks stale socket on start | Port file (`mediation-ipc.port`) written by daemon; probe by connect; port races possible | Socket file probe; same pattern | Need pid/lock file discipline; readiness = "daemon has opened the inbox" (fuzzy) |
| **Cross-platform** | Unix sockets on POSIX (this fleet: macOS/Linux); TCP fallback for Windows | All platforms | POSIX only; Windows needs `\\.\pipe\` path handling (node:net supports it, but test/ops complexity) | All platforms |
| **Notify path (server→client push)** | SSE (`text/event-stream`) over the same HTTP server — standard, one long-lived connection per subscriber, trivial to test with node:http | SSE same | Duplex stream, arbitrary frames — need own framing + correlation protocol | **No push** — client polls event files; violates the notify→interrupt design requirement |
| **Monocoque letter** | Server = L5 surface wrapping injected ports; client = RuntimePort transport. Clean | Same | Same, but protocol is bespoke (framing, ordering, backpressure) | Same, but polling only |
| **Protocol ergonomics / future MCP** | HTTP verbs + JSON envelope; MCP-over-HTTP (streamable HTTP) later maps directly | Same | No HTTP semantics — MCP would need a gateway | No |
| **Latency / racy-ness** | Sub-ms local; no polling anywhere | Sub-ms | Sub-ms | Poll-interval bound; partial-write races; cancel-in-flight hard |

### Verdict

- **File queue loses on the notify axis outright** — the design's notify→interrupt
  path requires server→client push without client polling (D3 P4, SURFACES issue #3
  risk 1). It also keeps `status` on sqlite, which is the coupling we are trying to
  remove. Rejected as primary; the sqlite join/OW files remain *durability*, not a
  *transport*.
- **Raw named pipe is viable but reinvents HTTP** — duplex stream framing,
  request/response correlation, backpressure, and an events protocol all become
  ours to build and test. It is the right choice only when HTTP semantics are
  actively harmful (tiny-footprint embedded control planes). Not here.
- **HTTP wins on every axis except raw pipe "no TCP surface"**, and the Unix
  socket variant closes even that: `http.createServer().listen({ path })` +
  `http.request({ socketPath })` give us full HTTP semantics (framing, verbs,
  SSE, curl-ability, MCP-later) with **no TCP port at all** — local-only by
  construction, zero new dependencies.

### RECOMMENDATION

**HTTP over a local Unix domain socket (`node:http`), with SSE for server→client
push.** Fallback: **TCP loopback 127.0.0.1 with a port file** for platforms
without Unix sockets (Windows). Both use the identical request/response envelope
and endpoint set; the client picks the transport from the endpoint string shape
(`unix:/path/to.sock` vs `http://127.0.0.1:PORT`).

The socket file lives next to the OW sqlite DB (`<dbDir>/mediation-ipc.sock` by
default, override `MEDIATION_IPC`), which keeps "one daemon = one db =
one socket" and gives auto-spawn a stable address derived from the same env the
daemon reads.

## 4. Endpoint / protocol contract

All request/response bodies are JSON. Response envelope:

```
{ ok: true, result?: <op result> }                     // HTTP 200
{ ok: false, error: { code: string, message: string } } // HTTP 4xx/5xx
```

| Endpoint | Request body | Result | Notes |
|---|---|---|---|
| `POST /api/dispatch` | `DispatchInput` | `{ runId }` | same shape as `RuntimePort.dispatch` |
| `POST /api/plan` | `PlanSpec` | `{ runId }` | `RuntimePort.runPlan` (daemon must register plan) |
| `GET /api/status?runId=<id>` | — | `RuntimeStatus` | |
| `POST /api/wait` | `{ runId, timeoutMs? }` | `RuntimeStatus` | **daemon-side wait** — the daemon polls its own backend (50ms); the client sends one request, no client poll loop |
| `POST /api/cancel` | `{ runId }` | `{}` | |
| `POST /api/signal` | `{ runId, name, data? }` | `{}` | generic `sendSignal` |
| `POST /api/wake` | `{ runId, data }` | `{}` | convenience over `signal` name `wake`; data = `WakeSignalData`-compatible `{ payloadText, mode?, parkIntent?, parkReason? }` |
| `GET /api/events[?runId=<id>]` | — | SSE stream | pushes `NotifyRecord` frames (`event: parked|settled|failed|interrupted`, `data: <json>`); optional runId filter; server sends `event: connected` hello on open; unsubscribes on client close |
| `GET /api/health` | — | `{ ok: true, pid, dbPath, socketPath, uptimeMs }` | used by auto-spawn probe + tests |

SSE frame format (node:http raw write, no deps):

```
event: connected
data: {}

event: settled
data: {"runId":"run-1","sessionRef":"...","event":"settled"}
```

## 5. Notify source: how the daemon sees park/settle/fail (spawn-mode gap)

The daemon's worker runs the **engagement arc** in-process; only the leaf
(`materialize → engage`) runs in the child. The leaf's `safeNotify` therefore
cannot reach the daemon's notifier in spawn mode (documented gap). The fix is
**arc-level emission, gated on spawn mode**:

- In `engagement-arc.ts`, after each leaf `step.run` resolves (initial +
  park→wake continues), if `executeLeaf` is set **and** a `notify` port is wired,
  the arc emits the notify record itself (`parked` / `settled` / `failed`) from
  the daemon process. In-process mode the leaf already emits → arc stays silent
  (no double-delivery).
- Arc-level synthetic failures (`PARK_LOOP_EXCEEDED`, `PARK_WAIT_UNAVAILABLE`,
  `PARK_WAKE_TIMEOUT`) also emit `failed` when a notify port is wired — they are
  terminal run events a subscriber must learn.
- `createHostedMediation` gains an optional `notify` option threaded into
  `createSqliteRuntimeHost` (the existing, already-typed seam) so the daemon
  composition can hand the notifier to the arc.

This **closes MIGRATION-SPAWN.md row 5** ("spawn mode does not carry notify") as
a side effect — the notify transport now exists end to end.

## 6. Client / lifecycle

- `createIpcRuntimeClient({ endpoint, pollIntervalMs? })` returns the **same
  shape as `createRuntimeClient`**: `{ runtime: RuntimePort, stop() }`, plus
  `subscribe(runId?, listener)` over SSE. `RuntimePort.wait` maps to daemon-side
  `POST /api/wait`.
- **Auto-spawn on first connect:** `ensureDaemon({ endpoint, env, timeoutMs? })`
  probes the socket (connect + `/api/health`); on failure it spawns
  `node --experimental-strip-types src/surfaces/daemon.ts` with the caller's env
  and waits for the socket to answer (default 10s). The CLI opts in with
  `--spawn` (or `MEDIATION_IPC_SPAWN=1`) in `--ipc` mode, so
  `mediation status --run-id x --ipc <sock> --spawn` works even when the daemon
  is not yet running.
- Stale-socket handling: the daemon unlinks an existing socket at its path on
  startup if nothing is listening, and unlinks on graceful shutdown.

## 7. CLI integration (backward compatible)

- New flag `--ipc <endpoint>` + env `MEDIATION_IPC` for the runtime verbs
  (`dispatch/status/wait/cancel/wake`).
- Transport precedence in `composeRuntimeSurface`:
  `--ipc` flag > `MEDIATION_IPC` env > `MEDIATION_DB_PATH` (existing sqlite
  runtime client — **untouched**) > local composition (runtime verbs fail with
  the existing clear error).
- The CLI still maps everything through `SurfacePort`; only the transport under
  the surface changes. `engage` stays local-only (unchanged).

## 8. Non-goals (this slice)

- No `engageLocal` over IPC (daemon is headless; engage stays in the calling
  process) — a future MCP/afterparty adapter can compose it.
- No auth token yet (socket perms 0600 + local-only are the boundary; a token
  header is a one-line follow-on if multi-user machines need it).
- No windows named-pipe testing (fallback path implemented, not CI-tested here).
- No CLI `listen` subcommand (client `subscribe` is the API; a CLI event printer
  is a follow-on).

## 9. Open risks

1. **Arc emission merge risk with the parkwake slice** — engagement-arc.ts is
   shared terrain; the addition is gated on `executeLeaf` so in-process behavior
   is byte-identical. Watch for merge conflicts with `slice/phase2-parkwake`.
2. **SSE over unix socket has no intermediaries** — no keepalive needed; if a TCP
   gateway is added later, add comment-pings.
3. **Daemon-side `wait` holds an HTTP connection** for the wait duration — fine
   locally; MCP adapters should prefer `status` + events instead.
4. **Socket file dir must be writable** by the daemon process (db dir) — already
   true by construction (the sqlite db lives there).

## 10. Files (this slice)

| File | Role |
|---|---|
| `src/surfaces/ipc-protocol.ts` (NEW) | shared endpoint constants + request/response DTOs + SSE frame writer/parser (pure, layer-safe) |
| `src/surfaces/ipc-server.ts` (NEW) | `createIpcServer({ runtime, notifier, socketPath })` — L5 surface over injected RuntimePort + ObservableNotifyPort |
| `src/surfaces/ipc-client.ts` (NEW) | `createIpcRuntimeClient` + `ensureDaemon` (auto-spawn) |
| `src/surfaces/daemon.ts` (EDIT) | start IPC server (env `MEDIATION_IPC` / `MEDIATION_IPC_DISABLE`), unlink socket on shutdown |
| `src/surfaces/cli.ts` (EDIT) | `--ipc` flag + `MEDIATION_IPC` env transport selection |
| `src/adapters/openworkflow/workflows/engagement-arc.ts` (EDIT) | spawn-mode notify emission (gated) |
| `src/adapters/compose.ts` (EDIT) | `CreateHostedMediationOptions.notify` threaded to the host |
| `src/index.ts` (EDIT) | public exports for the client/server/protocol |
| `test/surfaces/ipc-roundtrip.test.ts` (NEW) | unit: server/client round trip with stub RuntimePort + notifier (dispatch → status → event) |
| `test/surfaces/daemon-ipc.test.ts` (NEW) | integration: real daemon child process, mock engine, settle + park→wake event delivery over IPC, SIGTERM cleanup |
| `test/surfaces/cli-ipc.test.ts` (NEW) | CLI `--ipc` mode against an in-process server + backward-compat env precedence |
| `outbox/EVIDENCE-DAEMON-IPC.md` (NEW) | evidence |

*End DAEMON-IPC-DESIGN.md*
