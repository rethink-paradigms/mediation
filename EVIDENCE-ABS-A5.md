# Evidence — Slice ABS-A5 (Config layers root · family · agent)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Branch:** `slice/ABS-A5-config-layers`  
**Depends on:** A1 (CapabilityId branding)  
**Unlocks:** A6  
**Contract:** `research/.../slices/ABS-A5-contract.md`

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `src/domain/config-layer.ts` | `ConfigLayerKind`, `CapabilitySpec`, `ConfigLayer`, `EffectiveCapabilitySpec`, `mergeCapabilitySpecs` (pure, no I/O) |
| `test/domain/config-layer.test.ts` | In-memory fixtures: unions, overrides, kind ordering, full root/family/agent merge |
| `src/index.ts` | Append-only public exports for types + `mergeCapabilitySpecs` |
| `EVIDENCE-ABS-A5.md` | This packet |

### Not touched

- `YamlDefinitionLoader` multi-file rewrite — out of scope
- Capability store / resolver — A2–A6
- No FS family file load (pure merge only)
- No `git checkout` / switch; no merge of `main`

---

## 2. Merge rules (v1)

Layers are ordered **root → family → agent** by `kind` (stable within the same kind via input index). Callers may pass layers in any array order.

| Field | Rule |
|-------|------|
| `extensions` | Ordered unique union (first occurrence keeps position); values branded as `CapabilityId` |
| `skills` | Ordered unique union |
| `tools.builtin` | Ordered unique union |
| `tools.custom` | Ordered unique union (same shape as builtin) |
| `tools.exclude` | Ordered unique union |
| `tools.agentMode` | Later layer **overrides** earlier |
| `tools.activeTools` | Later layer **replaces** earlier (not unioned) |

Empty input → `{ extensions: [], tools: {}, skills: [] }`.

---

## 3. `npm run check` proof

```text
> @company/mediation@0.0.1 check
> npm run typecheck && npm run test && npm run gauges

> typecheck
> tsc --noEmit
(exit 0)

> test
ℹ tests 119
ℹ pass 119
ℹ fail 0
(exit 0)

> gauges
layer_import_violations=0
second_door_count=0
public_export_surface=133
  … includes ConfigLayerKind, CapabilitySpec, ConfigLayer,
    EffectiveCapabilitySpec, mergeCapabilitySpecs
spawn_public_export_count=0
pack_parity_delta=0
gauges: OK
```

**ABS-A5 tests:**

```text
▶ domain/config-layer (ABS-A5)
  ✔ empty layers yield empty effective spec
  ✔ single agent layer passes through (branding extensions)
  ✔ extensions: ordered unique union root → family → agent
  ✔ skills: ordered unique union across layers
  ✔ tools.builtin and tools.exclude are ordered unique unions
  ✔ tools.custom unions like builtin
  ✔ tools.agentMode: later layer overrides earlier
  ✔ tools.activeTools: later layer replaces (not union)
  ✔ agentMode override without activeTools leaves prior activeTools
  ✔ sorts by kind even when input order is scrambled
  ✔ preserves relative order among same-kind layers
  ✔ full root/family/agent fixture merges policy + ids
```

---

## 4. Git

**Slice commit:** `946b93c` — ABS-A5 pure config-layer merge + tests + exports.

```text
946b93c ABS-A5: pure root/family/agent CapabilitySpec merge (config layers).
```

Full SHA: `946b93c325b101ee5316412491ebfab4e204fad8`

`npm run check` → typecheck + **119** tests pass + gauges OK  
(`layer_import_violations=0` · `second_door_count=0` · `spawn_public_export_count=0` · `public_export_surface=133`)

No `git checkout` / switch. No merge of `main`. Commit only on `slice/ABS-A5-config-layers`.  
Worktree may retain untracked `WORKTREE.md` / `node_modules` (not committed).
