# EVIDENCE — S0g (git baseline + agent fail-fast toolchain)

**Package:** `@company/mediation`  
**Code home:** `company/platform/mediation/` (package-local git only)  
**Date:** 2026-07-18  
**Commits:** `3503096` (toolchain baseline), `922550c` (evidence + log refresh)

---

## A. Git

### `git log --oneline`

```
922550c S0g: refresh evidence git log SHAs after evidence commit.
994e22e S0g: evidence packet for git baseline and fail-fast check surface.
3503096 S0g: git baseline and fail-fast toolchain over accepted S0–S2.
```

### `git status` (after S0g commits)

```
On branch main
nothing to commit, working tree clean
```

### Scope

- `git init` **only** under `platform/mediation/`.
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
