# Evidence — Slice ABS-A1 (Domain capability types)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Branch:** `slice/ABS-A1-capability-domain`  
**Law:** D5 capability medium independence  
**Contract:** `research/.../slices/ABS-A1-contract.md`

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `src/domain/capability.ts` | `CapabilityId`, `asCapabilityId`, `CapabilityKind`, `CapabilityOrigin`, `CapabilityRef` (opaque `locator`), `CapabilityPlan` + diagnostics |
| `src/index.ts` | Append-only public exports for new types + helper |
| `test/domain/capability.test.ts` | Smoke: brand helper, opaque locator, fail-closed plan shape |
| `EVIDENCE-ABS-A1.md` | This packet |

### Not touched

- `adapters/**` — none
- PackResolver behavior — unchanged
- No `fs` / `path` I/O in domain

---

## 2. Domain shape (D5)

- **Identity:** branded `CapabilityId` via `asCapabilityId` — not a filesystem path.
- **Kind:** `extension | skill | custom-tool | definition | pack | other`.
- **Origin:** `fs | memory | registry | inline | composite | unknown` (FS is one medium).
- **Ref:** `{ id, kind?, version?, digest?, origin, locator? }` — `locator` is opaque `Record`; domain does not interpret keys (FS adapter may use `{ path: string }` later).
- **Plan:** ordered `capabilities` + `diagnostics` + `ok` (PackLoadPlan pattern; fail-closed on error diagnostics).

---

## 3. `npm run check` proof

```text
> @company/mediation@0.0.1 check
> npm run typecheck && npm run test && npm run gauges

> typecheck
> tsc --noEmit
(exit 0)

> test
ℹ tests 100
ℹ pass 100
ℹ fail 0
(exit 0)

> gauges
layer_import_violations=0
second_door_count=0
public_export_surface=117
  … includes CapabilityId, CapabilityKind, CapabilityOrigin, CapabilityRef,
    CapabilityDiagnostic, CapabilityDiagnosticSeverity, CapabilityPlan, asCapabilityId
spawn_public_export_count=0
pack_parity_delta=0
gauges: OK
```

**ABS-A1 tests:**

```text
▶ domain/capability (ABS-A1)
  ✔ asCapabilityId brands a string id
  ✔ CapabilityRef keeps locator opaque and optional
  ✔ CapabilityPlan fail-closed shape matches packs pattern
```

---

## 4. Git

```text
3b7a41a ABS-A1: land domain capability types for medium independence (D5).
```

Full SHA: `3b7a41a83d393c6a75357631db36e22153528137`

No `git checkout` / switch. No merge of `main`. Commit only on `slice/ABS-A1-capability-domain`.
