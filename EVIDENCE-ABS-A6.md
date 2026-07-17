# Evidence — Slice ABS-A6 (CapabilityResolver)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Branch:** `slice/ABS-A6-capability-resolver`  
**Depends on:** A3 (FsCapabilityStore), A4 (MemoryCapabilityStore), A5 (config layers)  
**Unlocks:** A7 (factory materialize via resolver)  
**Contract:** `research/.../slices/ABS-A6-contract.md`

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `src/ports/capability-resolver.ts` | `CapabilityResolver` port, `CapabilityResolveInput`, `CapabilityResolveResult` |
| `src/adapters/capability/resolve.ts` | `DefaultCapabilityResolver`, `createCapabilityResolver` — merge + store.get fail-closed |
| `test/adapters/capability/resolve.test.ts` | Memory happy path + missing id; optional Fs fixture smoke |
| `src/index.ts` | Append-only public exports for port + default impl |
| `EVIDENCE-ABS-A6.md` | This packet |

### Not touched

- `src/app/factory.ts` — deferred to A7
- `src/adapters/pi/**` — out of scope
- No `git checkout` / switch; no merge of `main`

---

## 2. Resolve shape

```ts
interface CapabilityResolver {
  resolve(input: {
    layers?: readonly ConfigLayer[];
    effective?: EffectiveCapabilitySpec;
  }): Promise<{
    effective: EffectiveCapabilitySpec;
    plan: CapabilityPlan;
    diagnostics: readonly CapabilityDiagnostic[];
  }>;
}
```

| Step | Behavior |
|------|----------|
| Merge | When `layers` present → `mergeCapabilitySpecs(layers)` (A5); else use `effective`; else empty merge |
| Lookup | For each `effective.extensions` id → `store.get(id)` |
| Hit | Push `artifact.ref` onto `plan.capabilities` |
| Miss | Diagnostic `level: "error"`, `code: "capability_not_found"`, `capabilityId` set |
| Fail-closed | Any error diagnostic ⇒ `plan.ok === false` |
| Convenience | `diagnostics` is the same list as `plan.diagnostics` |

Factory wiring intentionally omitted (A7).

---

## 3. `npm run check` proof

```text
> @company/mediation@0.0.1 check
> npm run typecheck && npm run test && npm run gauges

> typecheck
> tsc --noEmit
(exit 0)

> test
ℹ tests 158
ℹ pass 158
ℹ fail 0
(exit 0)

> gauges
layer_import_violations=0
second_door_count=0
public_export_surface=160
  … includes CapabilityResolver, CapabilityResolveInput,
    CapabilityResolveResult, DefaultCapabilityResolver,
    DefaultCapabilityResolverOptions, createCapabilityResolver
spawn_public_export_count=0
pack_parity_delta=0
gauges: OK
```

**ABS-A6 tests:**

```text
▶ DefaultCapabilityResolver (ABS-A6)
  ✔ happy path: merges layers and resolves each extension id from store
  ✔ missing extension id → fail-closed diagnostic + plan.ok false
  ✔ all missing → empty capabilities, multiple errors
  ✔ empty layers → empty effective + ok plan
  ✔ pre-merged effective skips layer merge
  ✔ layers win over effective when both provided
  ✔ optional FsCapabilityStore fixture smoke (bar + missing)
```

---

## 4. Git

**Slice commit:** (filled after commit)

```text
git log --oneline -3
```

`npm run check` → typecheck + **158** tests pass + gauges OK  
(`layer_import_violations=0` · `second_door_count=0` · `spawn_public_export_count=0` · `public_export_surface=160`)

No `git checkout` / switch. No merge of `main`. Commit only on `slice/ABS-A6-capability-resolver`.  
Worktree may retain untracked `WORKTREE.md` / `node_modules` (not committed).
