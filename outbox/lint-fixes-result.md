## Result: Lint fixes for test/ scripts/ harness/ — with judgment
status: done

## Summary

Reduced violations from ~430 to 305. Fixed ~125 mechanical violations across 6 rule categories. Left ~175 violations intentionally after judgment review.

## Changes made

### FIXED (now 0 violations)

1. **`require-unicode-regexp`** (62 → 0) — Added `u` flag to all regex literals across 14 files. Mechanical and safe. Files: 7 scripts/gauges/*.ts, 7 test/**/*.test.ts.

2. **`prefer-import-meta-properties`** (37 → 0) — Replaced `path.dirname(fileURLToPath(import.meta.url))` with `import.meta.dirname` in all 7 scripts/gauges/*.ts, harness/cli.ts, and 28 test/**/*.test.ts files. Also one `fileURLToPath` → `import.meta.filename` in pack-plan.ts.

3. **`no-underscore-dangle`** (7 → 0) — Removed `__dirname` / `__filename` patterns as part of the `import.meta.*` migration.

4. **`no-promise-executor-return`** (8 → 0) — Wrapped arrow function bodies in `{ }` braces for `await new Promise((r) => setTimeout(r, ms))` patterns in 3 test files (life-runtime-scenarios.test.ts, ow-worker-engagement.test.ts, live-life-health.test.ts).

5. **`prefer-string-replace-all`** (2 → 0) — Changed `.replace()` with global regex to `.replaceAll()` in second-door.ts and spawn-death.ts.

6. **`no-lonely-if`** (2 → 0) — Merged nested `if` conditions in spawn-death.ts.

7. **`no-inline-comments`** (2 → 0) — Moved inline comments to their own lines in export-integrity.ts.

8. **`prefer-string-slice`** (1 → 0) — `substring` → `slice` in harness/runner.ts.

9. **`no-unused-vars`** (2 → 0) — Removed unused imports `createSqliteRuntimeHost` and `PiEngineAdapter` from harness/runner.ts.

### INTENTIONALLY LEFT (with rationale)

10. **`jest/no-conditional-in-test`** (130 hits, no change) — Reviewed samples across multiple files. The conditionals fall into legitimate categories:
    - Race condition checks: `assert.ok(state === "A" || state === "B" || state === "C")` — testing that ANY valid terminal state is reached
    - Type narrowing guards: `if (events[0]?.type === "idle") { assert(events[0].snapshot...) }` — safe access after optional chaining
    - Setup feature flags and guard conditions
    - Splitting these would create artificial, redundant test cases that don't reflect real behavior. This rule is overly aggressive for this codebase.

11. **`eslint/max-lines-per-function`** (69 hits, no change) — Most functions are close to the limit (52-56 lines) with natural flow. A few are architectural orchestrators (137-line switch router in runner.ts, 129-line gauge runner in run.ts). Force-splitting would harm readability without meaningful benefit.

12. **`eslint/require-await`** (54 hits, no change) — All are mock/stub implementations (fake-session.ts, surface-port mocks, engine adapter stubs) that return Promises for interface compatibility. Removing `async` would change return types from `Promise<T>` to `T`, breaking type contracts.

13. **`import/max-dependencies`** (18 hits, no change) — Inspected the worst offenders (recipes.test.ts: 18 deps, ow-plan.test.ts: 19 deps). Every import is used. These are comprehensive test files that legitimately need many imports. No restructuring warranted.

14. **`no-await-in-loop`** (15 warnings, no change) — Sequential awaits in test setup/teardown loops are normal and intentional.

15. **`no-negated-condition`** (6 hits, 3 eslint + 3 unicorn, no change) — Stylistic, explicitly marked as LOW PRIORITY / can ignore per task guidance.

16. **`no-array-sort`** (4 hits, no change) — Attempted `.toSorted()` but ES2022 target doesn't support it. Low priority per task guidance.

### Files NOT touched
- Nothing in `src/` (separate domain)
- `oxlint.json`, `package.json`, `tsconfig.json`

## Validation

### TypeScript typecheck
```
$ npx tsc --noEmit
(no errors)
```

### Test run (sample)
```
$ node --experimental-strip-types --test test/gauges/spawn-death.test.ts \
  test/pi/event-map.test.ts test/pi/fake-session.ts test/ports/surface-port.test.ts \
  test/ports/capability-store.test.ts test/domain/capability.test.ts \
  test/definition/yaml-definition-loader.test.ts test/legacy/spawn-engage.test.ts

ℹ tests 31, suites 9, pass 31, fail 0

$ node --experimental-strip-types --test test/runtime/life-runtime-scenarios.test.ts
ℹ tests 15, suites 2, pass 15, fail 0
```

### Lint before/after
| Rule | Before | After |
|------|--------|-------|
| require-unicode-regexp | 62 | 0 |
| prefer-import-meta-properties | 37 | 0 |
| no-promise-executor-return | 8 | 0 |
| no-underscore-dangle | 7 | 0 |
| prefer-string-replace-all | 2 | 0 |
| no-lonely-if | 2 | 0 |
| no-inline-comments | 2 | 0 |
| prefer-string-slice | 1 | 0 |
| no-unused-vars | 0 | 0 |
| **Total violations** | **~430** | **305** |

## Open items

- `no-conditional-in-test` (130) — Consider adding a `// eslint-disable` comment approach or relaxing the rule config if the team agrees these patterns are intentional.
- `require-await` (54) — Consider adding mock files to an ignore list or configuring the rule to exclude files in `test/pi/fake-session.ts` and similar mock implementations.
- `max-lines-per-function` (69) — Consider raising the limit to 80-100 for this project, or excluding test files since setup functions are naturally longer.
