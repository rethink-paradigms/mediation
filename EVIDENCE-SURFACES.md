# Evidence — SURFACES wave (issue #3): NotifyPort + runtime CLI + live/interrupt/observe recipes

**Date:** 2026-08-07  
**Branch:** `main` (working tree; explicit-path commit)  
**Issue:** https://github.com/rethink-paradigms/mediation/issues/3  
**Contracts:** `WAVE-LIFE-OW-PI-lifecycle.md` §3 (LIFE-J1 / L1 / S1 / G0), `understanding/agent-presence-core.md` §3 (experiences D live / F interrupt / G observe), `understanding/software-architecture.md` §2.4 / §3 (NotifyPort intent: notification delivery to external surfaces via interrupt/continue-engage — D3 P4), `TESTING-DOCTRINE.md` (binding).

---

## Scenario suite (written FIRST from intent — TESTING-DOCTRINE)

| ID | Scenario | Test file | Result |
|----|----------|-----------|--------|
| (a) | dispatched run parks → notify delivered → wake → settled notify on same run | `test/app/notify.test.ts` | ✔ |
| (a′) | failed leaf notifies `failed` (fail-closed packs path) | `test/app/notify.test.ts` | ✔ |
| — | listener errors isolated: throwing listener never breaks delivery | `test/app/notify.test.ts` | ✔ |
| (b) | interrupt live run by runId steers it; non-live → `PRESENCE_NOT_LIVE` | `test/app/interrupt.test.ts` | ✔ |
| (c) | live recipe: two sequential engages, same sessionRef, materialized once | `test/app/recipes-live.test.ts` | ✔ |
| (d) | observe: event ordering park → wake → settled (one run) | `test/app/observe.test.ts` | ✔ |
| (e) | CLI status/wait reflect parked then settled; arg parsing; unknown cmd exit 2 | `test/surfaces/cli-runtime.test.ts` | ✔ |

23 new scenario `it`s, all passing. Full suite + gates green (see check summary below).

---

## Deliverable 1 — NotifyPort first pour (D3 P4)

| Artifact | Path |
|----------|------|
| Port | `src/ports/notify.ts` (NEW) — `NotifyPort.notify(record)`; `ObservableNotifyPort` (+`on`) for the in-process bridge; `isObservableNotifyPort` guard |
| Default in-process adapter | `src/adapters/notify/in-process.ts` (NEW) — `InProcessNotifier`: listeners map, no external transport, listener errors isolated, `notify()` never throws |
| Record shape | `src/domain/events.ts` — `NotifyRecordShape { runId, sessionRef?, event: "parked"\|"settled"\|"failed"\|"interrupted", payload? }` |

**Wiring points (notify fires on park / settle / fail):**

1. **Engagement leaf** (`src/adapters/openworkflow/workflows/engagement.ts`) — every terminal outcome of a durable run: `parked` (with reason/resumeToken), `settled` (with result), `failed` (all failure paths incl. definition resolve / engine unknown / materialize / engage). Threaded through `engagement-arc.ts` → `register-engagement.ts` → `register-plan.ts` → `createSqliteRuntimeHost` (all optional, default off). In-process worker mode shares the notifier instance with the control plane; **spawn mode (child processes) does not carry notify** — documented first-pour limitation (no external transport yet).
2. **Mediation façade** (`src/app/mediation.ts`) — `engageLocal` / `reenter` notify local outcomes (synthesized runId `local:<presenceId>` — no durable run exists); `interrupt` notifies `interrupted`.

**Wake stays on `RuntimePort.sendSignal("wake")` as-is** — notify delivers *outcomes*; wake is a control verb (LIFE-P2 contract unchanged).

---

## Deliverable 2 — Runtime control CLI (LIFE-S1)

`src/surfaces/cli.ts` extended. Existing `engage` + `help` + `--engine` behavior intact (all pre-existing CLI tests pass).

| Subcommand | Flags | Surface op |
|------------|-------|------------|
| `dispatch` | `--agent --task [--name --project-root --engine --wait --client-request-id]` | `dispatch` (+`wait` when `--wait`) |
| `status` | `--run-id` | `getStatus` |
| `wait` | `--run-id [--timeout-ms]` | `wait` |
| `cancel` | `--run-id` | `cancel` |
| `wake` | `--run-id --text [--mode --park-intent --park-reason]` | `wake` |

- Unknown subcommand → help + **exit 2**; missing required args → exit 2.
- `MEDIATION_DB_PATH` env → runtime verbs ride a worker-less `createRuntimeClient` (control client for a running daemon's sqlite DB); absent → local composition (runtime verbs fail with a clear error).
- **worker/daemon pass-through NOT included**: `src/surfaces/daemon.ts` is an everliving process with env-driven config, not a trivial CLI pass-through; deferred (documented non-goal below).

---

## Deliverable 3 — Recipes D/F/G + interrupt registry + event emission

| Recipe | File | Semantics |
|--------|------|-----------|
| **live** (D) | `src/app/recipes/live.ts` (NEW) | materialize once → engage N turns on the same presence → dispose. `runId` registers in the live registry (interruptible by runId); `keepAlive` returns the live presence + `close()` that unregisters + disposes. One monocoque: load → materialize → engage (agent-presence-core §7.5). |
| **interrupt** (F) | `src/app/recipes/interrupt.ts` (NEW) | thin wrapper over `Mediation.interrupt(runId, kind, payload)`; non-live run rejects `PRESENCE_NOT_LIVE`. |
| **observe** (G) | `src/app/recipes/observe.ts` (NEW) | subscribes to the MediationEvent stream with optional runId filter. |

**Mediation façade additions** (`src/app/mediation.ts`):

- **Live-Presence registry**: `registerLivePresence(runId, presence)` / `unregisterLivePresence(runId)` / `interrupt(runId, kind, payload)` — in-process map; miss → `MediationError("PRESENCE_NOT_LIVE")` (code added to `src/domain/errors.ts`). Multi-process interrupt bus deferred (LIFE-L1 non-goal).
- **MediationEvent emission** (`src/domain/events.ts` union extended): `dispatch` → `engagement.status` (materializing), `wake` → `run.wake`, `engageLocal`/`reenter` → `presence.outcome`, `interrupt` → `run.interrupted`. New run-scoped variants: `run.parked` / `run.wake` / `run.settled` / `run.failed` / `run.interrupted`.
- **Observe bridge**: `Mediation.observe(listener)` subscribes to façade emissions AND, when the wired NotifyPort is the in-process adapter (`isObservableNotifyPort`), bridges notify records → MediationEvent (`mediationEventFromNotify` in domain/events.ts). One subscription sees the full run story: **park → wake → settled** (scenario d).

---

## MCP surface adapter (stretch — documented, not built)

Per design, MCP is an **L5 medium outside the monocoque** (software-architecture §1: `L5 SURFACES CLI · after-party UI · ow_dispatch tools · MCP · future HTTP`). A future MCP server would implement `SurfacePort` (`src/ports/surface.ts`) — the same face the CLI uses — mapping MCP tools → `engageLocal` / `dispatch` / `status` / `wait` / `cancel` / `wake`, and `NotifyPort` for server-initiated delivery. `createMediationSurface` already provides the Mediation-backed `SurfacePort` implementation an MCP adapter would wrap. **No MCP server is built in-package** (issue #3 scope: first pour; media after verbs true — WAVE-LIFE §6).

---

## Files

**New:** `src/ports/notify.ts`, `src/adapters/notify/in-process.ts`, `src/app/recipes/{live,interrupt,observe}.ts`, `test/app/{notify,observe,interrupt,recipes-live}.test.ts`, `test/surfaces/cli-runtime.test.ts`, `EVIDENCE-SURFACES.md`

**Extended (mine):** `src/domain/events.ts` (union + mapper), `src/domain/errors.ts` (`PRESENCE_NOT_LIVE`), `src/app/mediation.ts` (registry + observe + notify), `src/app/recipes/index.ts` (barrel), `src/surfaces/cli.ts` (runtime subcommands), `src/adapters/openworkflow/{workflows/engagement.ts, workflows/engagement-arc.ts, register-engagement.ts, register-plan.ts, host.ts}` (notify threading), `src/index.ts` (public exports)

**Untouched (sibling-owned):** `src/adapters/capability/**`, `src/adapters/definition/**`, `src/domain/{config-layer,definition,capability}.ts`, `src/app/factory.ts`, `src/adapters/compose.ts`, `src/ports/capability-store.ts`, `src/domain/knowledge/**`, `src/adapters/knowledge/**`, `src/ports/knowledge.ts`, `src/adapters/prime/**`, `src/adapters/pi/**`, `src/adapters/engine-registry.ts`, `src/domain/engine.ts`, `test/runtime/live-life-health.test.ts`, `test/runtime/park-*.test.ts`.

---

## Check summary

```bash
npm run check   # tsgo --noEmit && oxlint && node --test && gauges
```

Baseline at slice start: **385 tests / 383 pass / 2 skipped / 0 fail** (gauges OK).
After slice: **408 tests / 406 pass / 2 skipped / 0 fail**, gauges OK, `layer_import_violations=0`, `second_door_count=0`, `export_integrity=0`, `spawn_public_export_count=0`.

> Note: a sibling slice (capability composite store) is mid-edit in the same working tree on files I do not own (`compose.ts`, `factory.ts`, `definition.ts`, `capability/**`). My validation runs were executed against the HEAD baseline of those files (sibling WIP snapshotted aside and restored); my commit contains only my paths and does not depend on the sibling's in-flight changes.

---

## Commit

`SURFACES: NotifyPort + runtime CLI + live/interrupt/observe recipes (issue #3)`

---

## Open risks / non-goals

1. **Spawn-mode notify gap**: child-process leaves cannot reach the in-process notifier (first pour: in-process only). A transport (HTTP/IPC) on NotifyPort is the follow-on.
2. **Local engage synthesized runId** (`local:<presenceId>`): notify records for engageLocal/reenter have no durable run; consumers must treat `runId` as best-effort correlation for local-only paths.
3. **`Mediation.observe` bridge requires the in-process notifier** to be the wired NotifyPort; a future external NotifyPort implementation needs its own event feed for recipe G.
4. **Multi-process interrupt bus** deferred (LIFE-L1): registry is in-process only.
5. **worker/daemon CLI pass-through** deferred: daemon is an everliving process; `MEDIATION_DB_PATH` control client covers runtime verbs against a running daemon.
