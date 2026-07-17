# Evidence — Slice ABS-A3 (FsCapabilityStore)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Branch:** `slice/ABS-A3-fs-capability-store`  
**Law:** D5 L2/L4 — FS is adapter only; identity ≠ filesystem path  
**Contract:** `research/.../slices/ABS-A3-contract.md`  
**Depends on:** A2 (CapabilityStore port)

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `src/adapters/capability/fs-store.ts` | `FsCapabilityStore`, `resolveFsModule`, `createFsCapabilityStore` — harness search order |
| `src/adapters/packs/resolve-packs.ts` | Thin-wrap: `resolveExtensionPath` delegates to `resolveFsModule` (PackResolver kept) |
| `src/index.ts` | Append-only exports for FS adapter surface |
| `test/capability/fs-store.test.ts` | Fixture-backed store tests (`fixtures/packs/case-basic`) |
| `EVIDENCE-ABS-A3.md` | This packet |

### Not touched

- PackResolver public face (still present for A6/A7)
- Domain path identity — no domain changes
- No merge of `main`; no `git checkout` / switch

---

## 2. Adapter shape (D5)

```ts
class FsCapabilityStore implements CapabilityStore {
  constructor(opts: { projectRoot: string; homeDir?: string });
  get(id: CapabilityId, opts?: CapabilityGetOptions): Promise<CapabilityArtifact | null>;
}

// get hit shape:
// ref:  { id, origin: "fs", kind?, locator: { path, source } }
// entry: { kind: "module-path", modulePath: string }
```

Search order (moved from former `resolveExtensionPath` body):

1. name contains `/` → projectRoot-relative  
2. `tools/internal/<name>`  
3. `extensions/<name>`  
4. `.pi/extensions/<name>`  
5. `tools/families/<name>`  
6. `~/.pi/agent/extensions/<name>`  
7. absolute path if exists  

---

## 3. `npm run check` proof

```text
> @company/mediation@0.0.1 check
> npm run typecheck && npm run test && npm run gauges

> typecheck
> tsc --noEmit
(exit 0)

> test
ℹ tests 138
ℹ pass 138
ℹ fail 0
(exit 0)

> gauges
layer_import_violations=0
second_door_count=0
public_export_surface=150
  … includes FsCapabilityStore, createFsCapabilityStore, resolveFsModule,
    FsCapabilityStoreOptions, FsCapabilitySource, FsResolvedModule
spawn_public_export_count=0
pack_parity_delta=0
  case-basic: pack_count=2 ok=true pack_parity_delta=0
gauges: OK
```

**ABS-A3 tests:**

```text
▶ FsCapabilityStore (ABS-A3)
  ✔ get(foo) → internal tools path, origin fs, module-path entry
  ✔ get(bar) → project-extensions
  ✔ get(baz) → .pi/extensions (agent)
  ✔ get(qux) → tools/families
  ✔ get(vendor/extra) slash name → explicit under projectRoot
  ✔ get unknown → null
  ✔ createFsCapabilityStore factory implements CapabilityStore
  ✔ resolveFsModule matches fixture search order (internal wins for foo)
  ✔ path is never CapabilityId identity — id stays bare name
```

Existing pack goldens still green via thin-wrap:

```text
▶ PackResolverImpl — case-basic
  ✔ resolves foo (internal) and bar (project-extensions) via port resolve
  …
```

---

## 4. Git

```text
(git log --oneline -5 recorded after commit)
```

No `git checkout` / switch. No merge of `main`. Commit only on `slice/ABS-A3-fs-capability-store`.
