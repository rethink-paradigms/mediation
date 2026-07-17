# Evidence — Slice ABS-A4 (MemoryCapabilityStore)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Branch:** `slice/ABS-A4-memory-capability-store`  
**Law:** D5 L2 — in-memory CapabilityStore for tests/fixtures; identity ≠ FS path  
**Contract:** `research/.../slices/ABS-A4-contract.md`  
**Depends on:** A2 (CapabilityStore port)

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `src/adapters/capability/memory-store.ts` | `MemoryCapabilityStore` — map CapabilityId → CapabilityArtifact; get/put; implements `CapabilityPublisher.publish` |
| `test/adapters/capability/memory-store.test.ts` | Round-trip, version selector, publish, seed, size/clear |
| `src/index.ts` | Append-only export of `MemoryCapabilityStore` |
| `package.json` | Quote test globs so Node expands nested `test/adapters/**` (shell `**` does not) |
| `EVIDENCE-ABS-A4.md` | This packet |

### Not touched

- FS store (A3) / registry (R1)
- No filesystem I/O in MemoryCapabilityStore
- No merge of `main`; no `git checkout` / switch off branch

---

## 2. Adapter shape

```ts
class MemoryCapabilityStore implements CapabilityStore, CapabilityPublisher {
  constructor(seed?: readonly CapabilityArtifact[]);
  put(artifact: CapabilityArtifact): Promise<void>;
  get(id: CapabilityId, opts?: { version?: string }): Promise<CapabilityArtifact | null>;
  publish(input: PublishCapabilityInput): Promise<CapabilityRef>;
  size(): number;
  clear(): void;
}
```

- Unversioned `get` returns latest `put` for that id.
- Versioned `get` uses a secondary id→version index when `ref.version` was present on put.
- `publish` is put + echo ref (D5 L5 optional publisher face).

---

## 3. `npm run check` proof

```text
> @company/mediation@0.0.1 check
> npm run typecheck && npm run test && npm run gauges

> typecheck
> tsc --noEmit
(exit 0)

> test
ℹ tests 136
ℹ pass 136
ℹ fail 0
(exit 0)

> gauges
layer_import_violations=0
second_door_count=0
public_export_surface=145
  … includes MemoryCapabilityStore
spawn_public_export_count=0
pack_parity_delta=0
gauges: OK
```

**ABS-A4 tests:**

```text
▶ MemoryCapabilityStore (ABS-A4)
  ✔ put then get returns the same artifact by CapabilityId
  ✔ get returns null for unknown id
  ✔ seed constructor loads initial artifacts
  ✔ get honors optional version selector
  ✔ publish stores artifact and returns ref (CapabilityPublisher)
  ✔ put overwrites same id for unversioned get
  ✔ size and clear work for tests
```

---

## 4. Git

```text
970f9fc ABS-A4: land MemoryCapabilityStore with get/put and optional Publisher.
0e113f4 Merge branch 'slice/ABS-C2-host-mediation'.
bdcb820 Merge branch 'slice/ABS-B2-cli-surface'.
```

Full SHA: `970f9fcd4b1a746bce11f4509f79925746ef826d`

No `git checkout` / switch. No merge of `main`. Commit only on `slice/ABS-A4-memory-capability-store`.
