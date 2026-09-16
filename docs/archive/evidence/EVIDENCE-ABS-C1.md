# Evidence — Slice ABS-C1 (RuntimeHost sqlite OW compose)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Branch:** `slice/ABS-C1-runtime-host`  
**Law:** D0 Gamma leaf; productize local OW composition from tests  
**Depends on:** D5, OpenWorkflowRuntime, registerEngagementWorkflow / registerPlanWorkflow, JoinStore  
**Unlocks:** C2

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `src/adapters/openworkflow/host.ts` | `createSqliteRuntimeHost` — BackendSqlite + OW + register* + worker + RuntimePort + JoinStore |
| `test/runtime/runtime-host.test.ts` | construct host + mock dispatch→wait completed; optional plan path |
| `src/index.ts` | append-only export of host factory + types |
| `EVIDENCE-ABS-C1.md` | this packet |

---

## 2. Composition productized

```
createSqliteRuntimeHost({ dbPath, factory, resolveDefinition, join?, registerPlan? })
  → BackendSqlite.connect(dbPath)
  → OpenWorkflow({ backend })
  → registerEngagementWorkflow(ow, { factory, join, resolveDefinition })
  → [optional] registerPlanWorkflow(...)
  → OpenWorkflowRuntime({ ow, backend.getWorkflowRun, specs })
  → ow.newWorker({ concurrency })
  → { runtime, ow, worker, join, stop }
```

- **No postgres** — sqlite only (`BackendSqlite`, file path or `:memory:`).
- **Factory injected** — mock or Pi; host does not open sessions.
- **Join default** — `MemoryJoinStore` (product join ≠ OW tables); inject `SqliteJoinStore` when durable join needed.
- **stop()** — worker stop (if started) + `backend.stop()`.

---

## 3. Proofs (default check)

| Case | Result |
|------|--------|
| host exposes runtime / worker / join / ow / stop | pass |
| dispatch → worker → wait completed, Settled-shaped output + join row | pass |
| registerPlan: true → runPlan → completed with node results | pass |

```
▶ createSqliteRuntimeHost (ABS-C1, mock mind)
  ✔ constructs host with runtime, worker, join, ow
  ✔ dispatch → worker → wait completed with Settled-shaped output
  ✔ optional registerPlan wires runPlan path
```

---

## 4. Not in ABS-C1

| Item | Owner |
|------|--------|
| Postgres backend host | forbidden / out of scope |
| SurfacePort / C2 consumers of host | C2 |
| Domain / adapters/pi edits | forbidden this slice |

---

## 5. Check

`npm run check` green.

- `layer_import_violations=0`
- `second_door_count=0`
- `spawn_public_export_count=0`
- tests: 100 pass (including ABS-C1 suite)

## 6. Git

**Slice commit:** `feae93f` — ABS-C1 host + test + exports.

```
feae93f ABS-C1: productize createSqliteRuntimeHost (sqlite OW compose).
ed531c5 Merge branch 'slice/S11-kill-spawn'.
675ef17 Merge branch 'slice/S10-plan-leaf'.
```

`npm run check` → typecheck + 100 tests pass + gauges OK  
(`layer_import_violations=0` · `second_door_count=0` · `spawn_public_export_count=0`)

No merge from main. Branch only. Worktree unclean only for local `WORKTREE.md` / `node_modules` (untracked, not committed).
