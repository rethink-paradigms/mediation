# Evidence — Slice ABS-R1 (Registry store stub + publisher skeleton)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Branch:** `slice/ABS-R1-registry-stub`  
**Law:** D5 L5 — publisher port; registry is one medium (stub, no HTTP)  
**Contract:** `research/.../slices/ABS-R1-contract.md`  
**Depends on:** A2 (CapabilityStore + CapabilityPublisher ports)

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `src/adapters/capability/registry-store.ts` | `RegistryCapabilityStore` implements `CapabilityStore` + `CapabilityPublisher` (in-memory map; documents HTTP later) |
| `test/adapters/capability/registry-store.test.ts` | publish→get round-trip, version select, seed, upsert |
| `src/index.ts` | Append-only public exports for store + factory |
| `package.json` | Quote `test/**/*.test.ts` so Node expands nested `test/adapters/**` (shell `**` only matched one level) |
| `EVIDENCE-ABS-R1.md` | This packet |

### Not touched

- Real cloud / HTTP registry client
- FS capability store (A3), memory store (A4)
- No merge of `main`; no `git checkout` / switch to main

---

## 2. Adapter shape (D5 L5 stub)

```ts
class RegistryCapabilityStore implements CapabilityStore, CapabilityPublisher {
  get(id, opts?): Promise<CapabilityArtifact | null>; // null when unknown
  publish(input): Promise<CapabilityRef>;             // origin forced to "registry"
}

// Optional seed for pre-existing registry rows; no network.
new RegistryCapabilityStore({ seed?: CapabilityArtifact[] });
createRegistryCapabilityStore(opts?);
```

- Identity remains `CapabilityId` (+ optional version); locator may hold future registry keys.
- In-process map simulates remote registry so PyTool-style publish→fetch works without HTTP.

---

## 3. `npm run check` proof

```text
> @company/mediation@0.0.1 check
> npm run typecheck && npm run test && npm run gauges

> typecheck
> tsc --noEmit
(exit 0)

> test
ℹ tests 135
ℹ pass 135
ℹ fail 0
(exit 0)

> gauges
layer_import_violations=0
second_door_count=0
public_export_surface=147
  … includes RegistryCapabilityStore, RegistryCapabilityStoreOptions,
    createRegistryCapabilityStore
spawn_public_export_count=0
pack_parity_delta=0
gauges: OK
```

**ABS-R1 tests:**

```text
▶ RegistryCapabilityStore (ABS-R1)
  ✔ get returns null for unknown id
  ✔ publish → get round-trip (in-process registry, no network)
  ✔ get honors optional version selector
  ✔ seed artifacts are readable without publish
  ✔ implements CapabilityStore and CapabilityPublisher faces
  ✔ publish replaces same id+version (upsert)
```

---

## 4. Git

```text
(tip recorded after commit)
```

No `git checkout` / switch to main. No merge of `main`. Commit only on `slice/ABS-R1-registry-stub`.
