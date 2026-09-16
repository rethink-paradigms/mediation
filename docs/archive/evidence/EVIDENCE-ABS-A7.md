# Evidence — Slice ABS-A7 (Factory materialize via CapabilityResolver)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Branch:** `slice/ABS-A7-factory-capability`  
**Depends on:** A6 (CapabilityResolver)  
**Unlocks:** A8 (Pi bind from capability artifacts)  
**Contract:** `research/.../slices/ABS-A7-contract.md`

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `src/app/factory.ts` | Optional `capabilityResolver`; agent-layer spec from definition; fail-closed; PackLoadPlan from module-path/locator |
| `src/ports/capability-resolver.ts` | `CapabilityResolveResult.artifacts` (same order as plan.capabilities) |
| `src/adapters/capability/resolve.ts` | Collect full store artifacts on resolve |
| `src/adapters/compose.ts` | Optional `capabilityResolver` / `capabilityStore` + `resolveOptionalCapabilityResolver` |
| `src/adapters/wiring.ts` | Pass optional resolver into `createPiPresenceFactory` |
| `src/domain/errors.ts` | `CAPABILITY_RESOLVE_FAILED` |
| `src/index.ts` | Export factory helpers + compose resolver helper |
| `test/presence/factory-capability.test.ts` | Memory + resolver → Settled; missing → fail-closed; legacy packs path |
| `EVIDENCE-ABS-A7.md` | This packet |

### Not touched

- Deep Pi rewrite (`src/adapters/pi/**` logic unchanged; wiring only accepts optional resolver)
- No `git checkout` / switch off branch; no merge of `main`

---

## 2. Materialize paths

### With `capabilityResolver`

1. `capabilitySpecFromDefinition(definition)` — agent-layer extensions (+ tools/skills when present)
2. `await capabilityResolver.resolve({ layers: [{ kind: "agent", spec }] })`
3. `packLoadPlanFromCapabilityArtifacts(artifacts, plan)` — path from `entry.modulePath` else `locator.path`
4. `plan.ok === false` (missing id, path missing, …) → `MediationError` code `CAPABILITY_RESOLVE_FAILED`
5. `toPackSnapshot` + `engine.openSession({ packPlan })` (compat with existing EnginePort)

### Without resolver (backward compat)

- Existing `PackResolver.resolve` → `PACK_RESOLVE_FAILED` when not ok

### Compose helper

```ts
resolveOptionalCapabilityResolver({
  capabilityResolver?, // preferred when set
  capabilityStore?,    // else createCapabilityResolver(store)
})
// → undefined keeps PackResolver path
```

`createLocalMediation` / `createHostedMediation` pass the optional resolver into mock and Pi factory wiring.

---

## 3. `npm run check` proof

```text
> @company/mediation@0.0.1 check
> npm run typecheck && npm run test && npm run gauges

> typecheck
> tsc --noEmit
(exit 0)

> test
ℹ tests 163
ℹ pass 163
ℹ fail 0
(exit 0)

> gauges
layer_import_violations=0
second_door_count=0
public_export_surface=164
  … includes capabilitySpecFromDefinition, modulePathFromArtifact,
    packLoadPlanFromCapabilityArtifacts, resolveOptionalCapabilityResolver
spawn_public_export_count=0
pack_parity_delta=0
gauges: OK
```

**ABS-A7 tests:**

```text
▶ DefaultPresenceFactory + CapabilityResolver (ABS-A7)
  ✔ materialize with MemoryCapabilityStore + createCapabilityResolver → Settled
  ✔ missing capability fails materialize (no openSession)
  ✔ without capabilityResolver keeps PackResolver path (backward compat)
  ✔ capabilitySpecFromDefinition maps extensions, tools, skills
  ✔ packLoadPlanFromCapabilityArtifacts maps module-path + locator fallback
```

---

## 4. Git

**Slice commit:** `98e5f9b` — ABS-A7 factory + compose CapabilityResolver wiring.

```text
98e5f9b ABS-A7: wire optional CapabilityResolver into DefaultPresenceFactory.
a725f90 Merge branch 'slice/ABS-A6-capability-resolver'.
```

Full SHA: `98e5f9b816334f295831ef44328303c5c33307dc`

`npm run check` → typecheck + **163** tests pass + gauges OK  
(`layer_import_violations=0` · `second_door_count=0` · `spawn_public_export_count=0` · `public_export_surface=164`)

No `git checkout` / switch. No merge of `main`. Commit only on `slice/ABS-A7-factory-capability`.
