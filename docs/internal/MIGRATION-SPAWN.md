# Migration — spawn dual-core death (D3)

**Law:** `decisions/D3-migration-dual-core-death.md`  
**Slice:** S11 — kill spawn as identity (mediation package side)  
**Public door only:** `Mediation` / `PresenceFactory.materialize` — never spawn/runner-as-core.

This file is the **L3 adapter expiry checklist** for `@company/mediation`. Full delete of external company `openworkflow/run-agent` is **out of package**.

---

## One public door (L1)

| Path | Role |
|------|------|
| `Mediation` / `createLocalMediation` | Product façade |
| `PresenceFactory.materialize` → `AgentPresence.engage` | In-process pilot path |
| `src/adapters/legacy/spawn-engage.ts` | **Private** fail-closed stub only — **not** re-exported from `src/index.ts` |

Gauge gate: `spawn_public_export_count === 0` (see `scripts/gauges/spawn-death.ts`).

---

## D3 L3 — when may the private spawn stub be deleted?

All must be true (last audited: 2026-08-11, POLISH wave — issue #5):

| # | Criterion (D3 L3 / migration-world) | Status in this package | Notes |
|---|-------------------------------------|------------------------|--------|
| 1 | In-process pilot engage works (materialize → Settled) | **DONE** | S2 mock + S2b/S2c/S5 Pi pilot path; presence tests (`test/presence/engage-settled.test.ts`) |
| 2 | E pack parity for pilot (reenter pack hash / snapshot fidelity) | **DONE** | S3 resume fidelity (`test/integration/resume-fidelity.test.ts`); S8 reenter recipe |
| 3 | Join keys written for pilot runs | **DONE** | S5a MemoryJoinStore; S6 SqliteJoinStore (`test/runtime/sqlite-join-store.test.ts`) |
| 4 | No product docs / tools teaching runner-as-core as the API | **DONE (in package)** | Package docs (README/TOOLING) never mention spawn as a door; `src/index.ts` does not re-export `spawnEngage`; `spawn_public_export_count` gauge = 0. Research/understanding corpus (`migration-world.md` etc.) documents the migration itself by design — not product docs. Full company-wide doc sweep remains open (see row 6). |
| 5 | Notify path uses interrupt / continue-engage (pipes optional behind) | **DONE (P4 first pour)** | `NotifyPort` (`src/ports/notify.ts`) + in-process adapter emit parked / settled / failed / interrupted records from leaf + façade (SURFACES wave, issue #3); wake rides `RuntimePort.sendSignal("wake")`, never a second notify protocol; interrupt via live-presence registry (`Mediation.interrupt`). Tests: `test/app/notify.test.ts`, `test/app/observe.test.ts`, `test/app/interrupt.test.ts`. External transport (HTTP/IPC/MCP) still to come — port is ready. |
| 6 | Private `spawn-engage` stub deleted from adapters/legacy | **OPEN — keep** | Stub remains fail-closed (`SPAWN_DISABLED`, `src/adapters/legacy/spawn-engage.ts`) and is only referenced by its own tests. Deletion is still blocked: criterion 4 is only in-package DONE (company-wide docs not fully swept), criterion 6 is self-referential, and criterion 7 is out of package. Delete only after 1–5 fully true AND no remaining caller needs the stub. |
| 7 | External `openworkflow/run-agent` (or equivalent) removed | **OUT OF PACKAGE** | S11 / POLISH does not delete company spawn runners. Fleet cutover is tracked out of package (P6 note below). |

---

## Pilot order (D3 L4) — mediation mapping

| Gate | Meaning | Mediation status |
|------|---------|------------------|
| **P0** | One factory module path | **DONE** — `DefaultPresenceFactory` / Pi wiring |
| **P1** | Pilot A: materialize + engage → Settled + sessionRef | **DONE** |
| **P2** | E: reenter same sessionRef → same packSnapshot | **DONE** (S3/S8) |
| **P3** | B: RuntimePort dispatch + join | **DONE** (S5a–S5d, S6) |
| **P4** | Notify via interrupt/continue interface | **DONE (first pour)** — NotifyPort + in-process adapter (issue #3); external transport pending |
| **P5** | Adapter expiry → delete spawn path | **OPEN** (this checklist 1–6; stub kept fail-closed) |
| **P6** | Plan migration (C) only after P3 | **OUT OF S11** (S10 owns plan leaf); **fleet cutover = out-of-package note only** — the fleet's dual-core death runs through the company OW worker, not this package |

---

## Refusal (D3 L6) — not first work

- Full plan-executor feature parity  
- Tool authoring product  
- Multi-engine  
- Dashboard rewrite  
- Step-per-tool  

---

## How the gauge fails the process

If someone adds a public spawn export, e.g. in `src/index.ts`:

```ts
export { spawnEngage } from "./adapters/legacy/spawn-engage.ts";
// or: export { SpawnEngageAdapter } from "...";
```

then:

```bash
npm run gauges
# spawn_public_export_count=<n>  with n !== 0
# FAIL: spawn_public_export_count=… (must be 0)
# gauges: FAILED → non-zero exit → npm run check fails
```

Unit proof: `test/gauges/spawn-death.test.ts` feeds synthetic violation strings to `detectSpawnPublicExports`.

---

## Expiry action (future)

When rows 1–5 are done **and** no remaining product caller needs the stub:

1. Delete `src/adapters/legacy/**`  
2. Keep `spawn_public_export_count` gauge forever (regression lock)  
3. Refresh this checklist to all **DONE** / N/A  
