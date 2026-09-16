# Evidence — Slice ABS-C2 (RuntimeHost + Mediation smoke)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Branch:** `slice/ABS-C2-host-mediation`  
**Law:** D4 façade → ports; C1 host is the RuntimePort wire  
**Depends on:** C1 (`createSqliteRuntimeHost`)  
**Unlocks:** surface/dispatch consumers of hosted mediation

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `src/adapters/compose.ts` | `createHostedMediation` — mind + `createSqliteRuntimeHost` + `Mediation` with shared factory/join/runtime |
| `test/runtime/host-mediation.test.ts` | hosted mock dispatch → wait completed; engageLocal; composition shape |
| `src/index.ts` | append-only export of hosted factory + types |
| `EVIDENCE-ABS-C2.md` | this packet |

---

## 2. Composition

```
createHostedMediation({ dbPath, mockEngine?, projectRoot?, resolveDefinition?, ... })
  → wireMind (yaml loader + mock|Pi factory + join)
  → createSqliteRuntimeHost({ dbPath, factory, join, resolveDefinition })
  → Mediation({ loader, factory, join: host.join, runtime: host.runtime })
  → { mediation, host, runtime, worker, join, stop }
```

- **Default resolveDefinition** — yaml loader via `agentName` / `agentRoot`.
- **Shared join** — product JoinStore passed into host and façade (same instance).
- **Dispatch path** — `mediation.dispatch` / `mediation.wait` require no extra runtime inject.
- **engageLocal** — still works (no OW) on the same composition.
- **No postgres** — sqlite host only (`:memory:` or file path).

---

## 3. Proofs (default check)

| Case | Result |
|------|--------|
| composition exposes mediation / host / runtime / worker / join / stop | pass |
| mediation.dispatch → worker → wait completed, Settled-shaped + join row | pass |
| engageLocal still Settled on hosted composition | pass |
| default yaml loader `load()` on hosted composition | pass |

```
▶ createHostedMediation (ABS-C2, mock mind)
  ✔ exposes mediation, host, runtime, worker, join, stop
  ✔ mediation.dispatch → worker → wait completed with Settled-shaped output
  ✔ engageLocal still works on hosted composition
  ✔ createHostedMediation default resolve uses yaml loader for load()
```

---

## 4. Not in ABS-C2

| Item | Owner |
|------|--------|
| Postgres backend host | forbidden |
| Pi rewrite | forbidden |
| Capability store | A2+ |
| SurfacePort CLI dispatch host wire | B2 / later |

---

## 5. Check

`npm run check` green.

- `layer_import_violations=0`
- `second_door_count=0`
- `spawn_public_export_count=0`
- tests: 111 pass (including ABS-C2 suite)

## 6. Git

**Slice commit:** `62b31fd` — ABS-C2 host + mediation compose + test + exports.

```
62b31fd ABS-C2: compose Mediation with createSqliteRuntimeHost for dispatch.
22bb56d Merge branch 'slice/ABS-C1-runtime-host'.
79f4a20 Merge branch 'slice/ABS-B1-surface-port'.
```

`npm run check` → typecheck + 111 tests pass + gauges OK  
(`layer_import_violations=0` · `second_door_count=0` · `spawn_public_export_count=0`)

No merge from main. Branch only.
