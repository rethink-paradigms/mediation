# Evidence — Slice S2 (PresenceFactory + engage Settled, mock-first)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Law:** D0 P1, D1 RunOutcome Settled, D2 fail-closed packs + settled gate, D4 EnginePort / factory  
**Depends on:** S0 (types/ports), S1 (PackResolver + toPackSnapshot)

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `src/adapters/mock/engine-adapter.ts` | `MockEnginePort` / `MockEngineSessionHandle` — no Pi |
| `src/app/settled-policy.ts` | idle + no park intent → allow Settled |
| `src/app/presence.ts` | `DefaultAgentPresence` status machine → EnginePort |
| `src/app/factory.ts` | `DefaultPresenceFactory` — sole materialize door |
| `test/presence/engage-settled.test.ts` | materialize + engage → Settled + fail-closed |
| `src/index.ts` | experimental app + mock exports |
| `EVIDENCE-S2.md` | this packet |

**Not landed (deferred):** `src/adapters/pi/engine-adapter.ts` / real Pi `createAgentSession` — mock-first path only for S2.

Domain/ports from S0–S1 consumed as-is (no redesign):

- `EnginePort` / `EngineSessionHandle` / `IdleSnapshot`
- `AgentPresence` / `PresenceFactory` / `RunOutcome` / `PresenceStatus`
- `PackResolver` / `toPackSnapshot` (injected into factory)

---

## 2. Sequence (one door)

```
Definition
  → DefaultPresenceFactory.materialize
       1. PackResolver.resolve (inject)
       2. fail if !plan.ok  → MediationError PACK_RESOLVE_FAILED
       3. toPackSnapshot(plan)  (inject; S1 helper)
       4. EnginePort.openSession({ definition, packPlan, resume?, … })
       5. DefaultAgentPresence { status: idle, sessionRef, packSnapshot }
  → presence.engage({ text })
       1. status: idle → engaging
       2. handle.prompt | handle.continue
       3. handle.waitUntilIdle → IdleSnapshot
       4. evaluateSettled({ idle, parkIntent: false })
       5. status: engaging → idle
       6. return { kind: "settled", sessionRef }
```

### Status transitions (observed)

| Phase | Status |
|-------|--------|
| after materialize | `idle` |
| engage start | `engaging` |
| after waitUntilIdle + settle | `idle` |
| dispose | `disposed` |

Parked path is stubbed in policy (`parkIntent`) but not wired to a wait tool in S2.

---

## 3. Mock EnginePort behavior

| Method | Behavior |
|--------|----------|
| `openSession` | new `sessionRef` or `req.resume`; handle starts idle (`session_open`) |
| `prompt` | emit user message; after **microtask** emit `idle` (`prompt_complete`) |
| `continue` | after microtask emit `idle` (`continue_complete`) |
| `waitUntilIdle` | resolves last idle if not busy; else waits for next idle event |
| `subscribe` | fans out engine events |
| `interrupt` | emits raw; `abort` forces idle if busy |
| `dispose` | rejects pending waiters; clears listeners |

---

## 4. Settled policy

```ts
evaluateSettled({ idle, parkIntent })
// parkIntent === true  → { allow: false, reason: "park_intent" }
// missing idle.at      → { allow: false, reason: "no_idle_snapshot" }
// else                 → { allow: true }  // Settled permitted
```

S2 engage always passes `parkIntent: false` (no park-tool adapter yet).

---

## 5. Layer / door gauges

| Gauge | Expected | Observed |
|-------|----------|----------|
| `layer_import_violations` | 0 | **0** |
| `second_door_count` | 0 | **0** |
| `engage_settled_mock` | ≥1 test pass | **1** (plus resume + fail-closed + policy unit) |
| `pack_parity_delta` | 0 | **0** |

**Layer notes:**

- `src/app/*` imports **only** domain + ports (+ sibling app modules).  
- `toPackSnapshot` is **injected** into `DefaultPresenceFactory` so app does not import `adapters/packs`.  
- Mock lives under `adapters/mock` (OK).  
- No `pi-coding-agent` / openworkflow imports.

**Import extension note (runtime):** S2 modules use `.ts` relative import extensions so `node --experimental-strip-types` resolves value imports under `noEmit`. S0/S1 modules retain `.js` type-only imports (erased at runtime). Documented for continuity; not a type redesign.

---

## 6. Test / typecheck commands

```bash
cd company/product/mediation-engine/mediation
npm run typecheck
npm test
npm run gauges
```

Observed:

```
tsc --noEmit: exit 0

tests 14, pass 14, fail 0
  S1 packs: 9
  S2 settled-policy: 2
  S2 materialize+engage: 3
    - factory materialize then engage returns settled with sessionRef
    - materialize resume reuses sessionRef
    - fail-closed: missing pack prevents materialize

=== gauges ===
layer_import_violations=0
second_door_count=0
public_export_surface=64
pack_parity_delta=0
```

---

## 7. Real-Pi deferred

| Item | Status |
|------|--------|
| `src/adapters/pi/engine-adapter.ts` | **not in S2** |
| Real session open / agent_settled wiring | deferred to later slice |
| OW / RuntimePort / join store | out of S2 |
| Spawn / inbox | not used |
| Parked continue path | policy stub only |

Mock path proves one door and Settled outcome shape (D1 G1 skeleton) without vendor deps.

---

## 8. Done criteria checklist

| Criterion | Status |
|-----------|--------|
| DefaultPresenceFactory materialize | yes |
| DefaultAgentPresence engage → Settled + sessionRef | yes |
| settled-policy idle + no park | yes |
| MockEnginePort prompt → idle | yes |
| Packs snapshotted at materialize | yes (`packSnapshot.planHash`) |
| Fail-closed missing packs | yes (no openSession) |
| layer_import_violations = 0 | yes |
| second_door_count = 0 | yes |
| typecheck + test + gauges pass | yes |
| Real Pi | deferred (documented) |
