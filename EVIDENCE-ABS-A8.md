# Evidence — Slice ABS-A8 (Pi adapter binds from capability artifacts)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Branch:** `slice/ABS-A8-pi-capability-bind`  
**Depends on:** A7 (factory PackLoadPlan from capability module paths)  
**Contract:** `research/.../slices/ABS-A8-contract.md`

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `src/adapters/pi/create-session.ts` | Document D5 L4 path boundary; `extensionPathsFromPackPlan` reads only `PackRef.path` from `packPlan` |
| `src/adapters/pi/index.ts` | Re-export path helper for adapter/tests (not public product index) |
| `test/pi/create-session-paths.test.ts` | Pure path mapping + A7 `packLoadPlanFromCapabilityArtifacts` → Pi paths |
| `EVIDENCE-ABS-A8.md` | This packet |

### Not touched

- Domain path identity (no new domain “must be path” fields)
- Live Pi (`MEDIATION_LIVE_PI` still optional / skipped)
- Public `src/index.ts` export surface (stays 164; helper is adapter-local)
- No `git checkout` / switch off branch; no merge of `main`

---

## 2. Boundary (D5 L4)

Absolute paths for Pi extension bind live **only** at the Pi adapter:

1. **Factory (A7)** — `packLoadPlanFromCapabilityArtifacts` maps capability
   `entry.modulePath` (prefer) else `locator.path` → `PackRef.path` on a
   `PackLoadPlan`.
2. **openSession** — `extensionPathsFromPackPlan(req.packPlan)` maps
   `plan.packs[].path` → `DefaultResourceLoader.additionalExtensionPaths`.
3. **No second resolve** — create-session does not scan `definition.extensions`,
   re-query CapabilityStore, or invent paths from ids.

```ts
// create-session.ts (ABS-A8)
export function extensionPathsFromPackPlan(plan: PackLoadPlan): string[] {
  return plan.packs
    .map((pack) => pack.path)
    .filter((p) => typeof p === "string" && p.length > 0);
}
// … openPiSession:
// additionalExtensionPaths: extensionPathsFromPackPlan(req.packPlan)
```

Capability-style module paths are therefore “preferred” **upstream** (A7
mapping into the plan). Pi binds whatever non-empty `PackRef.path` the factory
already placed on the plan — A7-mapped or legacy PackResolver.

---

## 3. `npm run check` proof

```text
> @company/mediation@0.0.1 check
> npm run typecheck && npm run test && npm run gauges

> typecheck
> tsc --noEmit
(exit 0)

> test
ℹ tests 166
ℹ pass 166
ℹ fail 0
(exit 0)

> gauges
layer_import_violations=0
second_door_count=0
public_export_surface=164
spawn_public_export_count=0
pack_parity_delta=0
gauges: OK
```

**ABS-A8 tests:**

```text
▶ extensionPathsFromPackPlan (ABS-A8)
  ✔ reads only PackRef.path in plan order; skips empty
  ✔ accepts PackLoadPlan adapted from capability artifacts (A7 mapping)
  ✔ empty plan → no extension paths
```

**Fake Pi (unchanged green):**

```text
▶ PiEngineAdapter (fake Pi session)
  ✔ openSession → sessionRef from sessionFile or sessionId
  ✔ prompt → agent_settled idle via subscribe + waitUntilIdle
  ✔ continue uses agent.continue when present
  ✔ interrupt steer / followUp / abort map to Pi surface
  ✔ factory materialize + engage Settled with PiEngineAdapter (fake)
  ✔ waitUntilIdle respects AbortSignal
```

---

## 4. Git

**Slice commit:** (see `git log -1` after commit)

```text
# expected tip subject:
ABS-A8: bind Pi extension paths only from packPlan PackRef.path (D5 L4).
```

`npm run check` → typecheck + **166** tests pass + gauges OK  
(`layer_import_violations=0` · `second_door_count=0` · `spawn_public_export_count=0` · `public_export_surface=164`)

No `git checkout` / switch. No merge of `main`. Commit only on `slice/ABS-A8-pi-capability-bind`.
