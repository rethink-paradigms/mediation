# Evidence — Slice ABS-A2 (CapabilityStore port)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Branch:** `slice/ABS-A2-capability-store-port`  
**Law:** D5 L2 — resolve/fetch via CapabilityStore; identity ≠ filesystem path  
**Contract:** `research/.../slices/ABS-A2-contract.md`  
**Depends on:** A1 (domain capability types)

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `src/ports/capability-store.ts` | `CapabilityStore`, `CapabilityArtifact`, `CapabilityEntry`, optional `CapabilityPublisher` stub |
| `src/index.ts` | Append-only public exports for new port types |
| `test/ports/capability-store.test.ts` | Mock store + publisher smoke |
| `EVIDENCE-ABS-A2.md` | This packet |

### Not touched

- FS / memory / registry adapters (A3 / A4 / R1)
- `adapters/**` behavior
- No `app/` imports from ports
- No merge of `main`; no `git checkout` / switch

---

## 2. Port shape (D5 L2 / L5)

```ts
type CapabilityEntry =
  | { kind: "module-path"; modulePath: string }
  | { kind: "bytes"; bytes: Uint8Array; contentType?: string }
  | { kind: "inline"; value: unknown };

type CapabilityArtifact = { ref: CapabilityRef; entry: CapabilityEntry };

interface CapabilityStore {
  get(id: CapabilityId, opts?: { version?: string }): Promise<CapabilityArtifact | null>;
}

interface CapabilityPublisher {
  publish(input: { ref: CapabilityRef; entry: CapabilityEntry }): Promise<CapabilityRef>;
}
```

- Uses A1 domain types (`CapabilityId`, `CapabilityRef`).
- Ports import only domain — no app/adapters.
- Entry kinds are opaque media carriers; identity remains `id` (+ optional version).

---

## 3. `npm run check` proof

```text
> @company/mediation@0.0.1 check
> npm run typecheck && npm run test && npm run gauges

> typecheck
> tsc --noEmit
(exit 0)

> test
ℹ tests 111
ℹ pass 111
ℹ fail 0
(exit 0)

> gauges
layer_import_violations=0
second_door_count=0
public_export_surface=134
  … includes CapabilityStore, CapabilityPublisher, CapabilityArtifact,
    CapabilityEntry, CapabilityGetOptions, PublishCapabilityInput
spawn_public_export_count=0
pack_parity_delta=0
gauges: OK
```

**ABS-A2 tests:**

```text
▶ CapabilityStore (ABS-A2)
  ✔ get returns artifact by CapabilityId
  ✔ get returns null for unknown id
  ✔ get honors optional version selector
  ✔ CapabilityPublisher stub accepts publish and echoes ref
```

---

## 4. Git

```text
(pending commit — filled after commit)
```

No `git checkout` / switch. No merge of `main`. Commit only on `slice/ABS-A2-capability-store-port`.
