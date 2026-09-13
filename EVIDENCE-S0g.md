# EVIDENCE — S0g (git baseline + agent fail-fast toolchain)

**Package:** `@company/mediation`  
**Code home:** `company/product/mediation-engine/mediation/` (package-local git only)  
**Date:** 2026-07-18  
**Primary baseline:** `3503096` (toolchain + S0–S2 tree). Further commits on `main` are evidence/docs only. Live SHAs: `git log --oneline`.

---

## A. Git

### `git log --oneline` (representative S0g history)

```
<tip> S0g: evidence packet / log refresh commits
3503096 S0g: git baseline and fail-fast toolchain over accepted S0–S2.
```

Exact tip SHA is whatever `git rev-parse --short HEAD` reports after the last S0g commit on a clean tree.

### `git status` (after S0g commits)

```
On branch main
nothing to commit, working tree clean
```

### Scope

- `git init` **only** under `product/mediation-engine/mediation/`.
- Parent trees (`company/platform/`, `company/`) were **not** initialized as git repos by this slice.
- Local identity not forced: existing global `user.name` / `user.email` already set (`Lego-Researcher` / `research@lego.com`).
- No remote, no force-push, no global config rewrites.

### Agent git notes (also in `AGENTS.md`)

- Branch naming: `slice/S2b-...` (slice id + short description).
- Run `npm run check` before every commit.
- No force on `main`.
- Evidence packets: `EVIDENCE-S*.md` in package root.
- Worktrees **not required yet** — ordinary branches suffice for sequential slices; parallel worktrees may come later.

---

## B. TypeScript fail-fast flags

`tsconfig.json` compilerOptions relevant to agents:

| Flag | Enabled |
|------|---------|
| `strict` | yes |
| `noUnusedLocals` | yes |
| `noUnusedParameters` | yes |
| `noFallthroughCasesInSwitch` | yes |
| `noImplicitOverride` | yes |
| `noUncheckedIndexedAccess` | **yes** (export-surface gauge tightened for indexed access) |
| `allowImportingTsExtensions` | yes (kept for Node strip-types tests) |

No flags deferred for “won't typecheck” reasons.

---

## C. `npm run check` (pass)

Script: `typecheck && test && gauges`

```
> @company/mediation@0.0.1 check
> npm run typecheck && npm run test && npm run gauges

> @company/mediation@0.0.1 typecheck
> tsc --noEmit

> @company/mediation@0.0.1 test
> node --experimental-strip-types --test test/**/*.test.ts

▶ PackResolverImpl — case-basic
  … 9 tests pass …
▶ settled-policy
  … 2 tests pass …
▶ materialize + engage → Settled (mock engine)
  … 3 tests pass …
ℹ tests 14
ℹ pass 14
ℹ fail 0

> @company/mediation@0.0.1 gauges
> node --experimental-strip-types scripts/gauges/run.ts

=== @company/mediation gauges ===

layer_import_violations=0
second_door_count=0
public_export_surface=64
  export AgentDefinition
  …
--- pack_plan (S1) ---
  case-basic: pack_plan_hash=3444ae487b30b4cdfca3ad6f1abd9dca516ee4ffc85c479599f40ff64441f7f4 pack_parity_delta=0 pack_count=2 ok=true
pack_parity_delta=0

gauges: OK
```

**Exit code: 0**

---

## D. Deliberate violation path (must fail)

Injected into `src/domain/errors.ts` (then restored; never committed):

```ts
const _x = "createAgentSession";
```

`npm run gauges` output excerpt:

```
layer_import_violations=0
second_door_count=1
  src/domain/errors.ts:34: const _x = "createAgentSession";
FAIL: second_door_count=1 (must be 0)
…
gauges: FAILED (architectural / measurement gate)
```

**Exit code: non-zero** (`process.exitCode = 1` in gauge runner).

Gates:

- `layer_import_violations !== 0` → fail
- `second_door_count !== 0` → fail
- measurement errors → fail
- pack_parity_delta !== 0 → fail

---

## E. Docs landed

| File | Role |
|------|------|
| `.gitignore` | node_modules, dist, coverage, .env, logs, OS, `*.db`, caches, etc. |
| `AGENTS.md` | branch naming, `check` before commit, no force main, evidence path |
| `TOOLING.md` | agent feedback surface — `check` ≈ compiler |
| `README.md` | points at check / TOOLING / AGENTS; S0g row |

---

## F. Done criteria

| Criterion | Status |
|-----------|--------|
| Package-local git, clean after commits | yes |
| `npm run check` passes on current tree | yes (exit 0) |
| Gauges hard-fail on architectural violation | yes (exit non-zero) |
| Evidence packet | this file |
