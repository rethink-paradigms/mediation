# Evidence — Slice S11 (Kill spawn as identity / D3)

**Package:** `@company/mediation`  
**Branch:** `slice/S11-kill-spawn`  
**Date:** 2026-07-18  
**Law:** D3 L1–L3 dual-core death; spawn never public monocoque  

---

## 1. Artifacts

| Path | Role |
|------|------|
| `src/adapters/legacy/spawn-engage.ts` | Private fail-closed stub (`@internal`); throws `POLICY_VIOLATION` / `SPAWN_DISABLED` |
| `scripts/gauges/spawn-death.ts` | `spawn_public_export_count` scan of public `src/index.ts` |
| `scripts/gauges/run.ts` | Gates on `spawn_public_export_count !== 0` |
| `test/gauges/spawn-death.test.ts` | Gauge = 0 on real index; synthetic violation detection |
| `test/legacy/spawn-engage.test.ts` | Stub fails closed; not on public export surface |
| `MIGRATION-SPAWN.md` | D3 L3 expiry checklist (pilot done vs open) |
| `EVIDENCE-S11.md` | this packet |

**Not re-exported:** `spawnEngage` / legacy path from `src/index.ts` (public door remains Mediation / materialize).

**Not touched:** S10 plan workflows; `src/adapters/pi/**` (except read); no merge to main.

---

## 2. Proofs

| Case | Result |
|------|--------|
| `spawn_public_export_count=0` on real index | pass (gauge + unit) |
| Synthetic `export { SpawnEngageAdapter } from "./adapters/legacy/..."` detected | pass |
| Synthetic `export function spawnEngage` detected | pass |
| Legacy re-export path detected | pass |
| Mediation / PresenceFactory surface no false positive | pass |
| `spawnEngage()` throws SPAWN_DISABLED | pass |
| Public `import("@company/mediation")` has no spawnEngage | pass |
| Live Pi | not required / not run |

---

## 3. How the gauge fails the process

If public index gains a spawn door, e.g.:

```ts
export { spawnEngage } from "./adapters/legacy/spawn-engage.ts";
```

then `npm run gauges` prints:

```
spawn_public_export_count=<n>
FAIL: spawn_public_export_count=<n> (must be 0)
gauges: FAILED (architectural / measurement gate)
```

→ non-zero exit → `npm run check` fails.

Unit proof without mutating index: `detectSpawnPublicExports(synthetic)` in `test/gauges/spawn-death.test.ts`.

---

## 4. Check

```bash
npm run check
```

**Result:** exit 0  

- typecheck: clean  
- tests: 92 pass (includes S11 gauge + legacy suites)  
- gauges: OK including `spawn_public_export_count=0`

---

## 5. Git

```
d9b822e S11: kill spawn as identity — private legacy stub and public-export gauge (D3).
```

Full tip after this evidence refresh is recorded by the follow-up commit on `slice/S11-kill-spawn` only; **not** merged to main.

---

## 6. Migration expiry (summary)

See `MIGRATION-SPAWN.md`:

- Pilot monocoque (in-process engage, pack parity, join) — **DONE**  
- Notify / external runner delete / stub hard-delete — **OPEN** / out of package  
