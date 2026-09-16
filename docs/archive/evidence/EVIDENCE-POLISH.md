# EVIDENCE-POLISH — final wave (issue #5)

**Slice:** `slice/polish-issue5`  
**Date:** 2026-08-11  
**Base tip (clean main):** `a0b3eca` (COMPOSITION, issue #4)  
**Owner:** POLISH-BUILDER (worktree `/tmp/wt-polish`)  
**Method:** TESTING-DOCTRINE (scenario-first, no green-washing, blockers filed not stalled)

---

## 1. OutcomeMapper (software-architecture §4.3)

**Decision:** new module **`src/app/outcomes.ts`** (app layer, not domain). The
doc lists OutcomeMapper among "domain services" — but like its sibling
SettledPolicy (`src/app/settled-policy.ts`, same doc row), it consumes
`IdleSnapshot` from `ports/engine.ts` and `RunOutcome` from `domain/presence.ts`,
so app layer is the home. Pure: no I/O, no engine imports; only the default
parked resumeToken uses `Date.now` (injectable for determinism).

**API**
- `outcomeFromError({ sessionRef?, error, code?, fallbackCode?, withCause? })`
  → Failed. Code precedence: explicit `code` > `error.code` (string) >
  `fallbackCode` > `ENGAGE_FAILED`. `withCause` keeps the raw error for
  in-process diagnostics; serializable callers leave it off (JSON-safe).
- `outcomeFromIdle({ sessionRef, idle, parkIntent?, parkReason?, text?,
  mode?, resumeToken? })` → Settled | Parked | Failed(POLICY_VIOLATION),
  delegating the allow/deny decision to `evaluateSettled`.

**Wiring points (behavior-preserving refactor — no outcome shape changed)**
| Call site | Before (inline) | After |
|-----------|-----------------|-------|
| `src/app/presence.ts` engage | disposed/engaging failed literals; idle+parkIntent decision block; catch with `cause` | `outcomeFromError` ×2, `outcomeFromIdle` (status transitions unchanged), `outcomeFromError({withCause:true})` |
| `src/app/mediation.ts` | reenter pack-mismatch failed literal; reenterFromJoin no-record literal | `outcomeFromError` (PACK_SNAPSHOT_MISMATCH / JOIN_NOT_FOUND) |
| `src/adapters/openworkflow/workflows/engagement.ts` (leaf) | 4 inline catch literals (DEFINITION_RESOLVE_FAILED / ENGINE_UNKNOWN / MATERIALIZE_FAILED / ENGAGE_FAILED) | `outcomeFromError` — same codes, same engine/sessionRef/packHash fields, notify payloads unchanged |

`src/app/settled-policy.ts`: one type-only loosening (`idle?: IdleSnapshot`)
so the mapper can pass an absent idle (runtime behavior unchanged).

**Unit tests:** `test/app/outcome-mapper.test.ts` — 13 scenarios (real engine
Error → Failed+sessionRef; MediationError taxonomy preserved; string error;
missing-capability fail-closed code preserved over fallback; explicit code
wins; withCause; JSON-safe without cause; idle→Settled; park intent→Parked
(reason/resumeToken/payload); default reason; injected resumeToken; missing
idle→POLICY_VIOLATION; settle-policy parity). **13/13 pass.**

## 2. Event / observe integration (recipe G)

The SURFACES wave already proved the durable happy path end-to-end:
`test/app/observe.test.ts` scenario (d) runs a real sqlite runtime host +
in-process NotifyPort and asserts **park → wake → settled emit in order**
for one run via the notify→`MediationEvent` bridge. Re-verified green in this
wave (no duplicate test added for that scenario).

**Gaps found and closed** (`test/app/observe-lifecycle.test.ts`, new, 3 tests):
1. `mediationEventFromNotify` (domain/events.ts) had **zero direct tests** —
   added pure mapping tests for parked/settled/failed/interrupted → run.* events
   with payload fields (reason / code / sessionRef).
2. The **failure half of the lifecycle** was untested: a durable run with a
   missing capability now proves `engagement.status (materializing)` →
   `run.failed` (code `CAPABILITY_RESOLVE_FAILED`) via the notify bridge,
   ordered correctly.
3. RunId-scoped interrupt: `run.interrupted` MediationEvent + interrupted
   notify record (complements interrupt.test.ts which only asserted notify).

## 3. Migration-gate audit (MIGRATION-SPAWN.md, D3 L3)

Re-audited all 7 deletion criteria against current code:

| # | Criterion | Status now |
|---|-----------|-----------|
| 1 | In-process pilot engage works | **DONE** (unchanged) |
| 2 | E pack parity for pilot | **DONE** (unchanged) |
| 3 | Join keys written for pilot | **DONE** (unchanged) |
| 4 | No product docs teaching runner-as-core | **DONE (in package)** — README/TOOLING never mention spawn as a door; `src/index.ts` no export; gauge `spawn_public_export_count=0`; research/understanding corpus documents the migration by design, not product docs |
| 5 | Notify path uses interrupt/continue-engage | **DONE (P4 first pour)** — `NotifyPort` + in-process adapter emit parked/settled/failed/interrupted (SURFACES, issue #3); wake rides `sendSignal`; interrupt via live-presence registry; tests `test/app/notify.test.ts`, `observe.test.ts`, `interrupt.test.ts` |
| 6 | Private `spawn-engage` stub deleted | **OPEN — kept** (fail-closed `SPAWN_DISABLED`; only its own tests reference it) |
| 7 | External `openworkflow/run-agent` removed | **OUT OF PACKAGE** (fleet cutover; P6 note only) |

**Deletion NOT performed** — criterion 6 requires 1–5 fully true (4 is only
in-package DONE, company-wide docs not swept) and is self-referential; 7 is
out of package. Stub stays fail-closed; gauge stays as regression lock.
P4 gate moved OPEN → DONE(first pour); P6 fleet cutover recorded as
out-of-package note only.

## 4. Doc-sync (research tree, edited in place — no commit)

| File | Change |
|------|--------|
| `slices/ABS-A6-contract.md` | Status OPEN → **MERGED** (merge `a725f90`) |
| `slices/ABS-A7-contract.md` | Status OPEN → **MERGED** (merge `09684e7`) |
| `slices/ABS-A8-contract.md` | Status OPEN → **MERGED** (merge `000a427`) |
| `slices/ABS-B3-contract.md` | Status OPEN → **MERGED** (merge `443fe41`) |
| `CONTEXT.md` | Tip + issue-wave table (#1–#5) + recommended-next pruned (NotifyPort/composite/family-load done) + live tracker link |
| `CONTINUITY.md` | Done/Not-done/Next refreshed for waves 1–4 + tracker link |
| `outbox/STATE-WAVE2.md` | **NEW** — wave 1+2 completion summary (issues #1–#4, SHAs, evidence, gate state, POLISH handoff) |
| `HEALTH-REPORT-LIVE-PI.md` (package root) | POST-FIX UPDATE — degraded verdict superseded; live re-run 13/13 + park-wake 2/2 + prime 1/1 |
| `INVESTIGATION-park-wake-continue-design-gap.md` (package root) | RESOLVED banner — fix SHA `51631d7` + live re-proof; inMemory continue gap documented |

Merge SHAs proven via `git show --format=%h` (package repo).

## 5. FINAL QA matrix

| Suite | Command | Result |
|-------|---------|--------|
| Full gate | `npm run check` | **GREEN** — typecheck + lint + **448 tests / 445 pass / 0 fail / 3 skip** + gauges all 0 (layer imports, second door, spawn exports, export integrity, pack parity) |
| Live Pi band | `MEDIATION_LIVE_PI=1 MEDIATION_LIVE_MODEL=deepseek/deepseek-v4-flash npm run test:live-pi` | **13/13 pass** (H1–H7 incl. H4b default-continue bridge, H5 fail-closed, H6 reenter, H7 runPlan) |
| Live park-wake | `MEDIATION_LIVE_PI=1 node --experimental-strip-types --test test/runtime/live-park-wake-pi.test.ts` | **2/2 pass** (L-W1 hosted park→wake default continue→Settled; L-W2 local park→reenter default continue→Settled) |
| Prime live smoke | `MEDIATION_LIVE_PRIME=1 node --experimental-strip-types --test test/prime/live-prime.test.ts` | **1/1 pass** (real prime createAgentSession) |

Live model `deepseek/deepseek-v4-flash`; auth `~/.pi/agent/auth.json`
(+ `~/.prime/agent/auth.json` for prime). Nothing trimmed or weakened; the one
pre-existing documented constraint (H6b: `inMemorySession` continue-after-park
fails closed) is asserted as expected behavior, not masked.

## 6. FINAL state matrix — all five issues

| Issue | Wave | Merge SHA | Check at merge | Live |
|-------|------|-----------|----------------|------|
| #1 LIFE-FIX park-wake bridge | 1 | `51631d7` | green | park-wake live 2/2 (this wave) |
| #2 DOMAIN-M knowledge-model | 1 | `7cc4554` | green (45 scenario its / 62 total) | — |
| #3 SURFACES NotifyPort+CLI+recipes+events | 2 | `2be2d79` | green (432 tests) | — |
| #4 COMPOSITION composite store+family layers | 2 | `a0b3eca` | green (432 tests / 429 pass / 3 skip) | — |
| #5 POLISH (this wave) | 3 | `POLISH: outcome mapper + migration-gate audit + final QA` (this commit) | **448 tests / 445 pass / 0 fail / 3 skip, gauges 0** | live-pi 13/13 · park-wake 2/2 · prime 1/1 |

## 7. Known remaining items (honest)

1. **`spawn-engage` legacy stub deletion** — blocked (MIGRATION-SPAWN.md rows 4-external/6/7; see §3). Gauge keeps it dead.
2. **NotifyPort external transport** (HTTP/IPC/MCP) — port + in-process adapter only.
3. **`inMemorySession` continue-after-park** — fails closed (H6b); file sessions required for continuum. Not a regression.
4. **Multi-process interrupt bus** — live-presence registry is in-process (LIFE-L1).
5. **Plan-executor parity** for `runPlan` (S10 scaffold only).
6. **Company-wide doc sweep** for spawn-as-core teaching (research/understanding corpus is migration history by design; fleet docs not fully swept).
7. **Fleet cutover / dual-core death outside package** (P6) — tracked out of package.
