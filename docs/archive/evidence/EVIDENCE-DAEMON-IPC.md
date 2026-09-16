# EVIDENCE-DAEMON-IPC — daemon control/notify IPC surface (phase 2 building block)

**Slice:** slice/phase2-daemon-ipc · **Worktree:** /tmp/wt-daemonipc · **Date:** 2026-08-08
**Design (outbox/DAEMON-IPC-DESIGN.md, ACCEPTED):** HTTP over a local Unix domain
socket (node:http only), SSE for server→client push (parked/settled/failed/interrupted);
fallback TCP loopback. Closes the flagged gap: CLI/Pi-extension/MCP talk to the daemon
via a real control seam instead of reading its OW sqlite directly; the notify→interrupt
path gets server→client push (design law D3 P4 / SURFACES #3).

**Delivered:** src/surfaces/ipc-protocol.ts (envelope DTOs + endpoint parsing),
ipc-server.ts (createIpcServer: dispatch/plan/wait/cancel/signal/wake/status/health
+ SSE /api/events with runId filter; unix socket chmod 0600, local-only),
ipc-client.ts (createIpcRuntimeClient: RuntimePort over the envelope + subscribe +
stop; connection-per-request), daemon.ts wired to serve IPC when MEDIATION_IPC set,
cli.ts gains control over IPC, compose/engagement-arc/index wired (exports).

**Hardening (parent lead, after the slice stalled on a hung test):**
- Gate: npm test now `--test-timeout=120000 --test-force-exit` — a hung test FAILS
  (timeout) and a handle-leak teardown can never freeze the gate (user-flagged
  no-time-awareness issue, systemic fix).
- server.stop(): closeAllConnections + settle tick — deterministic teardown.
- client: agent:false (connection-per-request) — no pooled keep-alive handles.
- Test: rawRequest restructured (no double-settle), optional body, RunId casts.

**Test matrix:** ipc-roundtrip 8/8 (dispatch→status→cancel→wait; wake; SSE push;
SSE runId filter; health; daemon-not-running; envelope error codes; NOT_FOUND).
Full check: 456 tests / 453 pass / 0 fail / 3 env-gated skips; gauges 0; rc=0.
