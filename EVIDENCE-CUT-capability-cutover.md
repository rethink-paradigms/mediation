# Evidence — CUT capability cutover (single monocoque resolve)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Branch:** `slice/CUT-capability-cutover`  
**Law:** D5 — capability is the only materialize resolve path; FS is adapter only  
**Contract:** `research/.../slices/CUT-capability-cutover-contract.md`  
**Depends on:** ABS-A3 (Fs store), A4 (Memory), A6 (resolver), A7 (optional factory wire)

---

## 1. Before / after

### Before (ABS-A7 dual path)

```
DefaultPresenceFactory.resolvePackPlan:
  if (capabilityResolver) → CapabilityResolver → packLoadPlanFromCapabilityArtifacts
  else                     → packResolver.resolve(...)   // DEFAULT via compose
```

`createLocalMediation` / `createPiPresenceFactory` left `capabilityResolver` undefined, so production and CLI stayed on **PackResolver**.

### After (CUT — single path)

```
definition
  → capabilitySpecFromDefinition
  → CapabilityResolver.resolve({ layers: [{ kind: "agent", spec }] })
  → packLoadPlanFromCapabilityArtifacts  // edge adapt for openSession only
  → engine.openSession({ packPlan })
```

- `capabilityResolver` is **required** on `DefaultPresenceFactoryDeps`.
- No `if/else` PackResolver fork in the factory.
- `packResolver` removed from factory deps.
- PackResolverImpl remains for **unit tests / FS search parity only** (not factory dual path).

---

## 2. Artifacts landed

| Path | Role |
|------|------|
| `src/app/factory.ts` | Required `capabilityResolver`; sole resolve path; always `CAPABILITY_RESOLVE_FAILED` on fail |
| `src/adapters/wiring.ts` | `resolveCapabilityResolver` + Pi factory without PackResolver |
| `src/adapters/compose.ts` | Default FsCapabilityStore(projectRoot) + resolver; no packResolver wire |
| `src/surfaces/cli.ts` | `fsStoreOptions.homeDir` instead of `packResolverOptions` |
| `src/index.ts` | Export `resolveCapabilityResolver` (replaces optional helper) |
| `test/presence/**`, `test/integration/**`, `test/runtime/**`, … | Materialize via capability store/resolver |
| `EVIDENCE-CUT-capability-cutover.md` | This packet |

### Default compose wiring

```ts
resolveCapabilityResolver({
  capabilityResolver?, // preferred
  capabilityStore?,    // else createCapabilityResolver(store)
  projectRoot?,        // else FsCapabilityStore({ projectRoot, ...fsStoreOptions })
  fsStoreOptions?,     // homeDir override for tests
})
// no projectRoot + no store → empty MemoryCapabilityStore (fail-closed on extensions)
```

`createLocalMediation` / `createHostedMediation` / `createPiPresenceFactory` / CLI all use this policy. Mock mind and Pi mind share the same resolve door.

---

## 3. `npm run check` proof

```text
> @company/mediation@0.0.1 check
> npm run typecheck && npm run test && npm run gauges

> typecheck
> tsc --noEmit
(exit 0)

> test
ℹ tests 174
ℹ pass 174
ℹ fail 0
(exit 0)

> gauges
layer_import_violations=0
second_door_count=0
public_export_surface=178
  … includes resolveCapabilityResolver (not resolveOptionalCapabilityResolver)
spawn_public_export_count=0
pack_parity_delta=0
gauges: OK
```

**CUT factory tests:**

```text
▶ DefaultPresenceFactory + CapabilityResolver (CUT)
  ✔ materialize with MemoryCapabilityStore + createCapabilityResolver → Settled
  ✔ materialize with default FsCapabilityStore path → Settled
  ✔ missing capability fails materialize (no openSession)
  ✔ capabilitySpecFromDefinition maps extensions, tools, skills
  ✔ packLoadPlanFromCapabilityArtifacts maps module-path + locator fallback
```

Missing capability → `CAPABILITY_RESOLVE_FAILED`, `engine.opened.length === 0`.

---

## 4. Git

**Branch tip:** recorded after commit via `git log --oneline -3` on `slice/CUT-capability-cutover`.

```text
# tip SHA filled by follow-up evidence commit
CUT: make CapabilityResolver the sole materialize resolve path (D5).
aeb96e6 Wave ABS G0: rollup evidence for completed abstraction DAG.
```

`npm run check` → typecheck + **174** tests pass + gauges OK  
(`layer_import_violations=0` · `second_door_count=0` · `spawn_public_export_count=0` · `public_export_surface=178`)

No `git checkout` / switch. No merge of `main`. Commits only on cutover branch.

---

## 5. Explicit non-goals (held)

- Did not reintroduce factory fork for backward compat
- PackResolverImpl unit goldens kept (`test/packs/resolve-packs.test.ts`)
- No second `createAgentSession` door (`second_door_count=0`)
- No merge to `main` (lead merges)
