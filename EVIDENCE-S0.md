# Evidence packet — Slice S0

**Package:** `@company/mediation`  
**Code home:** `company/product/mediation-engine/mediation/`  
**Date:** 2026-07-18  
**Slice:** S0 — package + domain + ports + boundary gauges  
**Law:** D0, D1, D4 · software-architecture L2–L3  

---

## 1. File tree

```
product/mediation-engine/mediation/
  package.json
  package-lock.json
  tsconfig.json
  README.md
  EVIDENCE-S0.md
  scripts/gauges/
    run.ts
    layer-imports.ts
    second-door.ts
    export-surface.ts
    pack-plan.ts                 # S1 (present; not S0 ownership)
  src/
    index.ts
    domain/
      definition.ts
      packs.ts
      presence.ts
      engagement.ts
      events.ts
      errors.ts
    ports/
      engine.ts
      runtime.ts
      join.ts
      definition-loader.ts
      pack-resolver.ts
    adapters/packs/              # S1 ownership (present; not edited by S0)
      resolve-packs.ts
      pack-snapshot.ts
  fixtures/packs/…               # S1
  test/packs/…                   # S1
```

---

## 2. Gauge runner output (raw)

```
mediation gauges (observational)
gauge                    value
-----------------------  -----
layer_import_violations      0
second_door_count            0
public_export_surface       48
pack_fixture_count           1
pack_parity_delta            0

public_export_surface list:
  AgentDefinition
  AgentPresence
  AgentRef
  AttachSurface
  DefinitionLoader
  DispatchHandle
  DispatchInput
  EngageInput
  EngagementRecord
  EngagementStatus
  EngineEvent
  EnginePort
  EngineSessionHandle
  EngineSettingsPolicy
  IdleSnapshot
  InterruptKind
  JoinKeys
  JoinStore
  MaterializeOptions
  MediationError
  MediationErrorCode
  MediationEvent
  ModelSpec
  OpenSessionRequest
  PackDiagnostic
  PackDiagnosticSeverity
  PackLoadPlan
  PackRef
  PackResolveOptions
  PackResolveRequest
  PackResolver
  PackSnapshot
  PackSource
  PlanEdgeSpec
  PlanNodeSpec
  PlanSpec
  PresenceEvent
  PresenceFactory
  PresenceStatus
  RunId
  RunOutcome
  RuntimePort
  RuntimeStatus
  SessionRef
  ToolPolicy
  asRunId
  asSessionRef
  packRequestFromDefinition

pack_plan fixtures:
  case-basic: pack_plan_hash=a7701fc5ce04f8661bea166ffe698d4679591efc5b6471af3d1dbca079afd17b pack_parity_delta=0 pack_count=2 ok=true
```

| Gauge | Value | Expected direction |
|-------|------:|--------------------|
| `layer_import_violations` | 0 | 0 (domain/ports/app must not import pi / @earendil-works / openworkflow) |
| `second_door_count` | 0 | 0 outside `adapters/pi/**` |
| `public_export_surface` | 48 | listed above |
| `tsc_ok` | pass | `npm run typecheck` |

---

## 3. Public export surface

Types and values re-exported from `src/index.ts` only (no Pi/OW adapters, no second factory):

- **Definition:** `AgentRef`, `AgentDefinition`, `ModelSpec`, `ToolPolicy`, `EngineSettingsPolicy`
- **Packs:** `PackRef`, `PackSource`, `PackLoadPlan`, `PackSnapshot`, `PackDiagnostic`, `PackDiagnosticSeverity`
- **Presence:** `SessionRef`, `asSessionRef`, `PresenceStatus`, `EngageInput`, `AttachSurface`, `RunOutcome`, `AgentPresence`, `PresenceFactory`, `MaterializeOptions`, `PresenceEvent`, `InterruptKind`
- **Engagement:** `RunId`, `asRunId`, `JoinKeys`, `EngagementRecord`, `EngagementStatus`
- **Events / errors:** `MediationEvent`, `MediationError`, `MediationErrorCode`
- **Ports:** `EnginePort`, `EngineSessionHandle`, `OpenSessionRequest`, `EngineEvent`, `IdleSnapshot`, `RuntimePort`, `DispatchInput`, `DispatchHandle`, `PlanSpec`, `PlanNodeSpec`, `PlanEdgeSpec`, `RuntimeStatus`, `JoinStore`, `DefinitionLoader`, `PackResolver`, `PackResolveRequest`, `PackResolveOptions`, `packRequestFromDefinition`

---

## 4. Done criteria checklist

| Criterion | Result |
|-----------|--------|
| `npm install` in mediation package | ok (4 packages: typescript, @types/node, …) |
| `npm run typecheck` | succeeds |
| `npm run gauges` | prints numbers (table) |
| Domain + ports only (no engage impl, no Pi/OW in domain/ports) | held |
| No second session factory | held (`second_door_count=0`) |

---

## 5. Notes (midstream alignment)

1. **S1 already present** under `src/adapters/packs/**`, fixtures, and `scripts/gauges/pack-plan.ts`. S0 did **not** edit S1 adapter paths. Domain/port shapes were aligned so S1 typechecks against S0:
   - `PackDiagnostic.level` (not `severity`) per S1-contract / D2 wording  
   - `PackLoadPlan.ok: boolean` for fail-closed  
   - `PackSource` union matching resolve search tags  
   - `PackResolver.resolve(PackResolveRequest, PackResolveOptions)` — two-arg form S1 implements; architecture’s one-arg `AgentDefinition` form is bridged via `packRequestFromDefinition` for later factory use  

2. **Architecture one-arg `PackResolver.resolve(def)`** is not the live signature; S1 contract + impl chose request/options. Factory can compose `packRequestFromDefinition(def)` + `projectRoot`.

3. **`allowImportingTsExtensions: true`** added to `tsconfig.json` so scripts/tests using `.ts` import paths (Node `--experimental-strip-types`) typecheck under `module: NodeNext` + `noEmit`.

4. **Gauge runner** (`scripts/gauges/run.ts`) prints S0 boundary gauges and optionally S1 pack fixtures when present (observational; not sole pass/fail story).

5. **No** `createMediation` / `PresenceFactory` engage implementation / Pi / OW adapters in this slice — intentional.

6. **Forbidden public exports** (Pi adapter, spawn engage) not present.
