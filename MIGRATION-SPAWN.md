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

All must be true:

| # | Criterion (D3 L3 / migration-world) | Status in this package | Notes |
|---|-------------------------------------|------------------------|--------|
| 1 | In-process pilot engage works (materialize → Settled) | **DONE** | S2 mock + S2b/S2c/S5 Pi pilot path; presence tests |
| 2 | E pack parity for pilot (reenter pack hash / snapshot fidelity) | **DONE** | S3 resume fidelity; S8 reenter recipe |
| 3 | Join keys written for pilot runs | **DONE** | S5a MemoryJoinStore; S6 SqliteJoinStore |
| 4 | No product docs / tools teaching runner-as-core as the API | **OPEN** | External docs / harness still may teach spawn; mediation public surface does **not** |
| 5 | Notify path uses interrupt / continue-engage (pipes optional behind) | **OPEN** | D3 L5 / P4 — not owned by S11 |
| 6 | Private `spawn-engage` stub deleted from adapters/legacy | **OPEN** | Keep fail-closed stub until external callers + docs cleared; delete only after 1–5 |
| 7 | External `openworkflow/run-agent` (or equivalent) removed | **OUT OF PACKAGE** | S11 does not delete company spawn runners |

---

## Pilot order (D3 L4) — mediation mapping

| Gate | Meaning | Mediation status |
|------|---------|------------------|
| **P0** | One factory module path | **DONE** — `DefaultPresenceFactory` / Pi wiring |
| **P1** | Pilot A: materialize + engage → Settled + sessionRef | **DONE** |
| **P2** | E: reenter same sessionRef → same packSnapshot | **DONE** (S3/S8) |
| **P3** | B: RuntimePort dispatch + join | **DONE** (S5a–S5d, S6) |
| **P4** | Notify via interrupt/continue interface | **OPEN** |
| **P5** | Adapter expiry → delete spawn path | **OPEN** (this checklist 1–6) |
| **P6** | Plan migration (C) only after P3 | **OUT OF S11** (S10 owns plan leaf) |

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
