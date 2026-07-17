# Evidence — Slice S1 (PackResolver + goldens)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Law:** D0 P1, D2 fail-closed, D4 PackResolver  
**v1 search order source:** `company/agents/_harness/resolve.ts`

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `src/adapters/packs/resolve-packs.ts` | `PackResolverImpl`, `resolveExtensionPath`, `resolvePackNames`, `planHasErrors` |
| `src/adapters/packs/pack-snapshot.ts` | Canonical `planHash` / `packPlanHash` / `toPackSnapshot` |
| `test/packs/resolve-packs.test.ts` | Goldens: order, fail-closed, parity, hash sort-stability |
| `fixtures/packs/case-basic/**` | Synthetic project tree + `expected.json` / `agent.json` |
| `scripts/gauges/pack-plan.ts` | Observational `pack_plan_hash` / `pack_parity_delta` |
| `scripts/gauges/run.ts` | Wires pack gauges alongside S0 gauges |

Domain/port types consumed from S0 (not rewritten by S1 beyond coordination):

- `src/domain/packs.ts` — `PackRef`, `PackSource`, `PackLoadPlan` (`ok`), `PackDiagnostic` (`level`), `PackSnapshot`
- `src/ports/pack-resolver.ts` — `PackResolver.resolve(req, opts)`, `PackResolveRequest`, `PackResolveOptions`

---

## 2. Resolve order (parity with harness)

Matches `company/agents/_harness/resolve.ts` `resolveExtension`:

1. name contains `/` → `path.resolve(projectRoot, name)` if exists → source `explicit`
2. `tools/internal/<name>` → `internal`
3. `extensions/<name>` → `project-extensions`
4. `.pi/extensions/<name>` → `agent`
5. `tools/families/<name>` → `families`
6. `~/.pi/agent/extensions/<name>` → `global-pi` (overridable via `homeDir` ctor for tests)
7. absolute path if exists → `explicit`

### Intentional diffs vs harness

| Aspect | Harness | S1 PackResolver |
|--------|---------|-----------------|
| Missing pack | WARN log, skip (omit from list) | **error** diagnostic, pack omitted, **`ok: false`** (D2 fail-closed) |
| API | `resolveExtension(name, projectRoot)` returns path string | `PackRef` + full `PackLoadPlan` |
| Home | `os.homedir()` fixed | injectable `homeDir` for fixtures |

No second resolve path; no Pi/OW imports.

---

## 3. Fixture list + hashes

### Fixture tree: `fixtures/packs/case-basic/`

```
agent.json                  extensions: ["foo", "bar"]
expected.json               oracle metadata
tools/internal/foo/         → internal
extensions/bar/             → project-extensions
.pi/extensions/baz/         → agent (order tests)
tools/families/qux/         → families (order tests)
vendor/extra/               → explicit slash path
```

### Gauge output (machine)

```
=== pack gauges (S1) ===
fixture=case-basic pack_count=2 ok=true pack_plan_hash=a7701fc5ce04f8661bea166ffe698d4679591efc5b6471af3d1dbca079afd17b pack_parity_delta=0 error_diagnostics=0
summary pack_parity_delta_total=0 fixtures=1
```

| Gauge | Value |
|-------|--------|
| `pack_plan_hash` (case-basic, `["foo","bar"]`) | `a7701fc5ce04f8661bea166ffe698d4679591efc5b6471af3d1dbca079afd17b` |
| `pack_parity_delta` | **0** |
| Two independent process runs | identical hash (STABLE_OK) |

**Note:** Hash includes absolute paths, so the hex is host-absolute-path-sensitive. Stability is **same machine, same tree, two runs / two resolves → identical**. Cross-host golden freezing of the hex is not required; tests assert parity + structure, not a checked-in hex.

### Canonical hash algorithm

```
JSON.stringify(packs sorted by id, then path, then source → {id,path,source}[])
→ sha256 hex
```

Diagnostics are **excluded** from the hash.

---

## 4. Fail-closed (D2)

Input `extensions: ["foo","bar","nope"]` on case-basic:

- `packs.length === 2` (resolved only)
- one diagnostic `{ level: "error", code: "pack_not_found", packName: "nope", ... }`
- `ok === false`
- materialize must not proceed when `!plan.ok` (enforcement deferred to factory S2; signal is present)

---

## 5. Test / typecheck commands

```bash
cd company/platform/mediation
npm test                 # 9 pass
npm run typecheck        # clean
npm run gauge:pack-plan  # pack hashes
npm run gauges           # S0 + S1 table
```

Observed:

```
tests 9, pass 9, fail 0
tsc --noEmit: exit 0
pack_parity_delta=0
layer_import_violations=0
second_door_count=0
```

---

## 6. Port surface used by S1

```ts
interface PackResolver {
  resolve(def: PackResolveRequest, opts: PackResolveOptions): PackLoadPlan;
}
// PackResolveRequest = { extensionSpecs: readonly string[] }
// PackResolveOptions = { projectRoot: string }
// PackLoadPlan = { packs, diagnostics, ok }
```

`PackResolverImpl` also exposes:

- `resolveDefinition(def: AgentDefinition)` — uses `def.extensions` + `def.rootDir`
- `resolveSpecs(names, { projectRoot })` — fixtures/gauges

---

## 7. Done criteria checklist

| Criterion | Status |
|-----------|--------|
| Tests via package test script | pass (9) |
| `pack_plan_hash` stable across two runs | yes |
| Fail-closed missing packs | error + `ok: false` |
| No Pi / OW / harness production edits | yes |
| Evidence packet | this file |
