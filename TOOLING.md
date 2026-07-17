# Tooling — agent feedback surface

TypeScript is human-loose by default. This package tightens the loop so agents get **Rust-like immediate failure**: wrong types, unused junk, layer violations, and second doors fail the process.

## `npm run check` ≈ compiler

```bash
npm run check
```

Runs, in order:

| Step | Script | Fails when |
|------|--------|------------|
| Typecheck | `npm run typecheck` | `tsc --noEmit` reports errors |
| Tests | `npm run test` | any test fails |
| Gauges | `npm run gauges` | architectural violations or measurement errors |

**Agents must treat a non-zero `check` as a hard stop** — same as a compile error. Do not “note and continue.”

## TypeScript flags (fail-fast)

Enabled in `tsconfig.json`:

- `strict`
- `noUnusedLocals` / `noUnusedParameters`
- `noFallthroughCasesInSwitch`
- `noImplicitOverride`
- `noUncheckedIndexedAccess`
- `allowImportingTsExtensions` (kept for Node strip-types tests)

## Gauges as gates

Printing a number is not enough. The runner sets `process.exitCode = 1` when:

- `layer_import_violations !== 0` (domain/ports/app must not import pi / @earendil-works / openworkflow)
- `second_door_count !== 0` (`createAgentSession*` only allowed under `src/adapters/pi/`)
- pack plan parity / measurement errors also fail the run

Standalone:

```bash
npm run gauge:imports   # exits 1 if violations
npm run gauge:doors     # exits 1 if second doors
npm run gauges          # full suite with gates
```

## Human vs agent

Humans can skim logs. Agents need **exit codes**. Prefer `npm run check` over ad-hoc `tsc` + “looks fine.”
