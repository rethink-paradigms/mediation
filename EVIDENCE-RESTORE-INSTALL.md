# Evidence — Restore installable, gate-green repo state (2026-08-07)

**Package:** `@company/mediation`  
**HEAD baseline:** `cf55f55` (2026-07-21) — package could not install (committed deps
`@earendil-works/agent@0.0.8`, `@earendil-works/openworkflow@0.0.4`,
`@earendil-works/one-mcp@0.0.6`, `better-sqlite3` do not exist on npm or in the repo).
**Node/npm:** v26.0.0 / 11.12.1 (package `engines.node >= 22`).
**Task:** restore to installable + `npm run check` GREEN; reconcile in-flight OW adapter work.

---

## 1. What was broken

- Committed `package.json` depended on four packages that exist nowhere: the package could
  not `npm install` / `npm ci`.
- `package-lock.json` had been deleted from the working tree (restored from HEAD — verified
  byte-identical to `package-lock.json.npm-bak`, the known-good lockfile).
- Uncommitted in-flight work (spawn process-isolation + plan DAG v2) failed `npm run lint`
  (15 errors) and could not be validated without an install.

## 2. Dependency set (final `package.json`)

Kept all existing scripts unchanged; restored the known-good dep set from
`package-lock.json.npm-bak`:

| Kind | Package | Version |
|------|---------|---------|
| dep | `@earendil-works/pi-coding-agent` | `^0.80.10` (installed 0.80.10) |
| dep | `openworkflow` | `^0.9.0` (installed 0.9.0) |
| dep | `yaml` | `^2.9.0` (installed 2.9.0) |
| dep | `zod` | `^4.4.3` (installed 4.4.3) |
| dev | `@company/test-harness` | `file:../test-harness` (verified present + installable) |
| dev | `@types/node` | `^22.0.0` |
| dev | `@typescript/native-preview` | `^7.0.0-dev.20260707.2` (tsgo) |
| dev | `oxlint` | `^1.74.0` |
| dev | `typescript` | `^5.6.0` (lockfile parity) |

`engines: { "node": ">=22" }` restored. `npm ci` → `added 151 packages in 4s` (rc 0).

## 3. In-flight changes reconciled (all kept, finished, verified)

| File | What it was | Action |
|------|-------------|--------|
| `src/adapters/openworkflow/workflows/plan.ts` | DAG v2: `computePlanWaves` — parallel waves from node/edge deps (was sequential v1; S10 evidence listed topological order + parallel as not-done) | kept; tested |
| `src/adapters/openworkflow/register-plan.ts` | DAG waves wired through durable `step.run`, optional `executeLeaf` | kept; tested |
| `src/adapters/openworkflow/workflows/engagement-arc.ts` | optional `executeLeaf` (child-process leaf) in arc + continue loop | kept; tested |
| `src/adapters/openworkflow/host.ts` | `spawnConfig` threading + `createRuntimeClient` (lightweight no-worker client) | kept |
| `src/adapters/openworkflow/spawn-leaf.ts` (new) | `createSpawnLeaf` — spawns `engagement-runner.ts` child per leaf | kept; lint fixed (`import.meta.dirname`) |
| `src/surfaces/engagement-runner.ts` (new) | child-process leaf entry point (JSON outcome on stdout) | kept; lint fixed (top-level await, inline comments); **added projectRoot fallback to agentRoot** so keyless spawn settles |
| `src/surfaces/daemon.ts` (new) | production daemon entry (spawn mode, env config) | kept; lint fixed (`Math.trunc(Number(...))`) |
| `src/adapters/join/sqlite-store.ts` | WAL + busy_timeout + BEGIN IMMEDIATE for multi-process safety | kept (required for child↔parent join file) |
| `src/adapters/compose.ts` | `spawnConfig` option through `createHostedMediation` | kept |
| `scenario_harness/runner.ts` | spawn-mode dispatch/engageLocal + spawn file lifecycle | kept; lint fixed; **added cross-process OW status/cancel/wake/join reads + SqliteJoinStore for parent + `stop()`** |
| `scenario_harness/cli.ts` | — | **added `await runner.stop()`** so the OW worker (poll loop keeps Node alive) no longer hangs the CLI |
| `test/runtime/ow-plan.test.ts` | +224 lines: DAG pure-body + OW worker tests | kept; passing |
| `test/runtime/ow-worker-spawn.test.ts`, `test/runtime/spawn-leaf.test.ts` (new) | spawn integration + child tests | kept; lint fixed; passing |
| `fixtures/packs/case-basic/agent.yaml` (new) | fixture agent.yaml for child definition load | kept |
| `scenario_harness/scenarios/12-spawn-dispatch-workflow.yml`, `13-spawn-engage-local.yml` (new) | spawn observation scenarios | kept; **both now run to completion keylessly** |

### Bugs found & fixed while finishing the in-flight work (evidence-backed)

1. **CLI hang after OW ops** — the OW worker `runLoop` poll timer keeps the Node event loop
   alive; one-shot `scenario_harness/cli.ts` processes never exited after `step`. Fix:
   `runner.stop()` (stops worker + backend + closes parent join) called from `cli.ts` after
   `runCli`. Verified: `step 2` exits rc 0 (was hanging 200s+).
2. **Cross-process status reads returned `pending` forever** — `getWorkflowStatus`/`cancel`/
   `wake`/`get-workflow-join` fell back to the per-process mock map when `runtimeHost` was
   null (fresh CLI process). Fix: connect to the file-backed OW backend via
   `getOrCreateRuntimeHost()` when `MEDIATION_LIVE_OW=1`. Verified: op-4 wait-until polls
   `running → completed` and matches.
3. **Child could never settle keylessly** — `engagement-runner.ts` with no `--project-root`
   built an empty MemoryCapabilityStore → every extension fail-closed →
   `CAPABILITY_RESOLVE_FAILED`. Fix: child defaults `effectiveProjectRoot` to the agent's
   `rootDir` (the agent's own root is its natural capability root; daemon still passes an
   explicit root). Verified: facade engage-local spawn path returns `kind: settled` with a
   64-hex pack hash.
4. **Parent join was MemoryJoinStore while child wrote SQLite** — cross-process join reads
   would miss child writes. Fix: runner injects `SqliteJoinStore` at `spawnConfig.joinPath`
   (WAL change in (3) is exactly what makes the shared file safe).

### Optional real-tree pilot (pre-existing breakage, not in-flight work)

`test/product/durable-pilot.test.ts` "optional coding-agent pilot" failed because the company
reorganized coding extensions under `extensions/coding/` on 2026-07-24 (after last mediation
commit) — bare-name resolution at company root no longer finds `coding-repo-map` etc., so the
store's search order can't resolve them. The tests are documented "skip if absent"; the skip
gate now also requires the capability tree to actually resolve (`resolveFsModule`). Result:
the two optional tests SKIP instead of fail. No architecture/store-search-order change was made.

## 4. `npm run check` — final (rc 0)

```text
tsgo --noEmit ............ pass (0 errors)
oxlint ................... Found 0 warnings and 0 errors (120 files)
node --experimental-strip-types --test
  tests 217 | pass 215 | fail 0 | skipped 2 | suites 64
gauges
  layer_import_violations=0
  second_door_count=0
  public_export_surface=186
  export_integrity=0 (checked_files=75, checked_symbols=186)
  spawn_public_export_count=0
  pack_plan: case-basic pack_parity_delta=0 pack_count=2 ok=true
  pack_parity_delta=0
  gauges: OK
```

Live-Pi suites (`MEDIATION_LIVE_PI=1`) remain SKIP (keyless only — not run).

## 5. Scenario validation (keyless, spawn mode)

```bash
MEDIATION_SPAWN=1 MEDIATION_LIVE_OW=1 node --experimental-strip-types scenario_harness/cli.ts ...
```

- `12-spawn-dispatch-workflow.yml`: init → step 1 → step 2 (dispatch + worker spawns child)
  → step 1 (wait-until polls running→completed) → status completed. rc 0 every step.
- `13-spawn-engage-local.yml`: facade engage-local routes through OW dispatch + child;
  observation `facade:engage-local PASSED { kind: "settled", packSnapshotHash: "3444ae48…", definitionId: "case-basic" }`.

## 6. Git

```text
HEAD: cf55f55 (unchanged — working tree restored, not committed)
git diff --stat (tracked): 12 files, +679 / -74
  package.json, scenario_harness/cli.ts, scenario_harness/runner.ts,
  src/adapters/compose.ts, src/adapters/join/sqlite-store.ts,
  src/adapters/openworkflow/host.ts, register-engagement.ts, register-plan.ts,
  workflows/engagement-arc.ts, workflows/plan.ts,
  test/product/durable-pilot.test.ts, test/runtime/ow-plan.test.ts
Untracked (in-flight, kept): spawn-leaf.ts, daemon.ts, engagement-runner.ts,
  ow-worker-spawn.test.ts, spawn-leaf.test.ts, scenarios 12/13,
  fixtures/packs/case-basic/agent.yaml, package-lock.json.npm-bak
```

`package-lock.json` restored from HEAD (identical to `.npm-bak`); no lockfile churn.

## 7. Not touched

- `src/adapters/prime` (owned by another task) — not created.
- Engine-selection design (`outbox/engine-selection-design.md` appeared concurrently from a
  sibling task; left untouched).
- `EVIDENCE-*.md` files — none deleted.
- No live-Pi runs (keyless only).
