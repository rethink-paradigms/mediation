# EVIDENCE-PARKFIX — park-through-hosted-runtime status + sqlite null-guard (phase 2)

**Slice:** slice/phase2-parkfix · **Worktree:** /tmp/wt-parkfix · **Date:** 2026-08-08
**Parent-pinned bug:** in the extension's LOCAL composition (createHostedMediation +
worker.start + createMediationSurface, mock engine), a dispatch with parkIntent:true
"stays running forever — never parks, never settles"; downstream wake "can't complete
it" and cancel hits sqlite "Provided value cannot be bound to SQLite parameter 4".

## Root cause (mechanism, verified)

The park mechanism itself works end-to-end through the hosted OW worker: the mock
leaf parks (join.status → "parked"), the arc blocks in waitForSignal, wake completes
the run, cancel lands in "canceled". What is broken is the *status* signal:

- **OW sqlite keeps a parked run in status `"running"`.** `sleepWorkflowRun`
  (`openworkflow/dist/sqlite/backend.js`) sets `status='running'` with a future
  `available_at`; the literal `"sleeping"` status never appears on sqlite. The
  mediation runtime's `mapOwStatus` only mapped `"sleeping"` → `parked:true`
  (`src/adapters/openworkflow/runtime.ts`), so `getStatus` on a parked run returned
  plain `{state:"running"}` forever. A status-only consumer (the parent's repro
  polling `surface.getStatus`) therefore concluded "never parks" — while the join
  record (the parked truth) was already `parked`.
- **The "sqlite parameter 4" cancel error is not pack_snapshot_json.** It is the OW
  `cancelWorkflowRun` statement binding `workflow_run_id` as parameter 4
  (`UPDATE workflow_runs SET ... WHERE ... AND id = ?`); the extension harness was
  passing `runId === undefined` (see extension evidence), which node:sqlite rejects
  with exactly that message. Verified: cancel with a real runId works.
- **Latent sqlite-store defect (parent-requested defensive fix):**
  `SqliteJoinStore.put` bound `JSON.stringify(record.packSnapshot)` as parameter 4 of
  the join INSERT. `JSON.stringify(undefined)` returns `undefined` (non-string), which
  node:sqlite refuses to bind. A synthesized record for a never-materialized /
  un-parked run would throw "Provided value cannot be bound to SQLite parameter 4".
  Now null-guarded: `JSON.stringify(record.packSnapshot ?? null)` binds the string
  `"null"`.

## Fixes (worktree, slice/phase2-parkfix)

1. **`src/adapters/openworkflow/runtime.ts`** — parked detection for sqlite:
   - `RuntimeBackend` face gains optional `isRunParked(workflowRunId) → Promise<boolean>`
     (plus passthrough `availableAt` on getWorkflowRun for future use).
   - `getStatus` probes `isRunParked` when the OW status is `"running"`; probe failure
     degrades to plain running (never fails the call).
   - `mapOwStatus(run, parked)` maps `running + parked` → `{state:"running", parked:true}`.
     The legacy `"sleeping"` case is unchanged.
2. **`src/adapters/openworkflow/host.ts`** — wire `isRunParked` into BOTH
   `createSqliteRuntimeHost` and `createRuntimeClient` via a shared
   `hasActiveSignalWait(backend, runId)` helper: true when any step attempt is
   `kind === "signal-wait" && status === "running"` (the OW record of a parked arc
   waiting for wake). Best-effort try/catch → false.
3. **`src/adapters/join/sqlite-store.ts`** — `put` binds
   `JSON.stringify(record.packSnapshot ?? null)` (param 4 null-guard).
4. **`test/runtime/park-status-regression.test.ts`** (NEW) — full hosted path
   (real OW worker + mock engine, `createHostedMediation({dbPath: ":memory:"})`):
   - parked run reports `state:"running"` + `parked:true` (not plain running);
   - wake → completed on the same sessionRef;
   - cancel on a parked run → canceled;
   - SqliteJoinStore.put with no packSnapshot binds cleanly (param-4 regression).

## Verification

- New regression suite: 4/4 pass (bounded `--test-timeout=120000 --test-force-exit`).
- Full gate: `timeout 400 npm run check` → **exit 0**: tsgo --noEmit clean,
  oxlint clean, **502 tests / 499 pass / 0 fail / 3 skipped** (skips are gated
  live-Pi suites), gauges OK: `layer_import_violations=0`, `second_door_count=0`,
  `export_integrity=0`, `pack_parity_delta=0`.
- Extension harness (against MAIN mediation, which lacks the runtime fix):
  **41/41** — park asserted via `join.status === "parked"` (the join is the parked
  truth on main; `status.parked:true` is the worktree-only runtime upgrade).

## Not touched

adapters/pi, adapters/prime/**, surfaces/cli.ts, surfaces/daemon.ts, domain/engine.ts,
engine-registry, capability/**, app/mediation.ts, ports/*, package.json.

## Commit

<filled at commit> — `git log -1 --format='%h %s'` (worktree slice/phase2-parkfix).
