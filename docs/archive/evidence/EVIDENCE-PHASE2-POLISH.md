# EVIDENCE — PHASE 2 POLISH (slice/phase2-polish)

Worktree: `/tmp/wt-polish2` (branch `slice/phase2-polish`, node_modules symlinked).
Scope: three user-approved items — D2 reenter snapshot-parity default, export pruning (A7),
surface move (D4-A1 letter bend). NOT committed (per instruction). Main tree untouched.

---

## 1. D2 REENTER — SNAPSHOT-PARITY DEFAULT (behavior change, user-approved)

**Before:** reenter defaulted to silent latest-yaml; snapshot parity was opt-in
(`ReenterInput.expectedPackSnapshotHash`, `reenterFromJoin.enforcePackSnapshot`).
**After:** default enforces snapshot parity; the escape hatch is EXPLICIT and LOUD.

### Escape-hatch shape

- New `PackPolicy = "snapshot" | "latest"` (exported from `src/app/mediation.ts`).
- `ReenterInput.packPolicy?: PackPolicy` — **defaults to `"snapshot"`**.
  - `"snapshot"` (default): rematerialized `planHash` must equal the ORIGINAL
    packSnapshot. Baseline = explicit `expectedPackSnapshotHash` **or** the join
    record's `packSnapshot.planHash` (the original snapshot that created the session).
    Mismatch → loud `failed` outcome `PACK_SNAPSHOT_MISMATCH`, **no engage**.
    No knowable baseline (no join record, no explicit hash) → loud `failed`
    `PACK_SNAPSHOT_BASELINE_UNAVAILABLE` with an actionable message — silent
    latest-yaml reenter is exactly what D2 forbids.
  - `"latest"`: the explicit, loud escape hatch for **deliberate agent.yaml
    updates** — reenter proceeds on the current yaml, no parity gate. Caller must
    write `packPolicy: "latest"` (opt-in, never silent).
- `reenterFromJoin` now takes `Omit<ReenterInput, "sessionRef">` — the old
  `enforcePackSnapshot?: boolean` override is **removed** (its only in-tree caller
  was a test, updated); the record's ORIGINAL `packSnapshot.planHash` is the
  default baseline (`expectedPackSnapshotHash` explicit value wins).
- `SurfaceReenterRequest` gained `packPolicy?: "snapshot" | "latest"` (additive) and
  `createMediationSurface.reenter` forwards it, so the escape hatch is reachable
  from the product door (CLI/MCP via SurfacePort).

### Files

| File | Change |
|---|---|
| `src/app/mediation.ts` | `PackPolicy` type; `ReenterInput.packPolicy`; reenter gate logic (baseline from join record / explicit hash; two loud failure codes); `reenterFromJoin` input type + baseline forwarding; private `failReenterGate` helper (emit+notify+return, no engage). Reenter/join path only — wake path untouched. |
| `src/ports/surface.ts` | `SurfaceReenterRequest.packPolicy` (additive); doc updates on `packSnapshotMatch`. |
| `src/surfaces/mediation-surface.ts` | forwards `req.packPolicy` → `mediation.reenter`. |

### Test matrix (new/updated)

`test/integration/reenter.test.ts` (7 tests, all pass):
- cold engageLocal → reenter with pack gate → Settled (unchanged, passes)
- packSnapshot mismatch fails reenter without engage (unchanged, passes)
- park → reenter continue → Settled (updated: dropped redundant `enforcePackSnapshot: true`, relies on new default)
- **NEW** D2 default: mismatch fails reenterFromJoin without any flag (`PACK_SNAPSHOT_MISMATCH`)
- **NEW** D2 escape hatch: `packPolicy: "latest"` reenters on updated yaml (settled, `packSnapshotMatch: true`)
- **NEW** D2 default: direct reenter with no baseline fails loudly (`PACK_SNAPSHOT_BASELINE_UNAVAILABLE`)
- **NEW** D2 default: direct reenter uses join-record baseline (mismatch fails)

`test/engine-selection/reenter-engine-pin.test.ts` (3 call sites): added
`packPolicy: "latest"` — these tests probe engine pinning, not pack parity; the
fixture join records carry stand-in hashes.

`test/runtime/live-life-health.test.ts` (H6b): added `packPolicy: "latest"` — the
test probes the inMemory continuation gap (no join record), not pack parity; it
must reach the engine's documented fail-closed, not the new baseline gate.

Untouched-but-still-green: live-park-wake-pi / life-runtime-scenarios /
park-wake-regression reenter calls already pass an explicit `expectedPackSnapshotHash`
or a matching join-record baseline (449/452 suite pass confirms).

---

## 2. EXPORT PRUNING (A7 — ~19 never-imported symbols)

### Verification method

`grep -rn "<symbol>" src/ test/ scripts/ fixtures/ --include="*.ts|*.mts|*.cts|*.js"` for
every listed symbol BEFORE dropping — all were file-private (only self-file references,
plus doc-comment mentions). Also checked `src/index.ts` and `adapters/{pi,prime}/index.ts`
re-export surfaces: none re-exported these symbols (export_integrity=0 pre/post confirms).

### Per-symbol outcome (18 symbols; 14 export-dropped, 4 deleted as dead code)

Export dropped (now file-private, still exist):
| Symbol | File |
|---|---|
| `resolveCompositionDefaultEngine` | `src/adapters/compose.ts` |
| `resolveCapabilityResolverWithStores` | `src/adapters/compose.ts` |
| `mergeDefinitionLayers` | `src/adapters/definition/yaml-definition-loader.ts` |
| `LoadDefinitionOptions` | `src/adapters/definition/yaml-definition-loader.ts` |
| `PiPresenceComposition` | `src/adapters/wiring.ts` |
| `capabilityLayersFromDefinition` | `src/app/factory.ts` |
| `canonicalPackEntries` | `src/adapters/packs/pack-snapshot.ts` |
| `PackHashEntry` | `src/adapters/packs/pack-snapshot.ts` |
| `MockEngineAdapterOptions` | `src/adapters/mock/engine-adapter.ts` |
| `PiEngineSessionHandleOptions` | `src/adapters/pi/session-handle.ts` |
| `PrimeEngineSessionHandleOptions` | `src/adapters/prime/session-handle.ts` |
| `SqliteRuntimeClient` | `src/adapters/openworkflow/host.ts` (logic untouched) |
| `ParkBridgeInput` | `src/domain/park-bridge.ts` (logic untouched) |
| `ParkBridgeMessage` | `src/domain/park-bridge.ts` (logic untouched) |

Deleted entirely (dead even in-file — export-drop would fail `noUnusedLocals`):
| Symbol | File | Why |
|---|---|---|
| `createPrimePresenceFactory` | `src/adapters/wiring.ts` | referenced NOWHERE (not even in wiring.ts); noUnusedLocals TS6133 after export drop |
| `CreatePrimePresenceFactoryOptions` | `src/adapters/wiring.ts` | exists only to serve the dead function |
| `PrimePresenceComposition` | `src/adapters/wiring.ts` | exists only to serve the dead function |
| `GraphBuildError` | `src/domain/knowledge/graph.ts` | referenced NOWHERE (dead type); noUnusedLocals TS6196 after export drop |

Deleting was the only clean way to satisfy both "drop export" AND `npm run check`
GREEN (`noUnusedLocals: true` in tsconfig). Post-drop re-grep confirms zero
`export` on all 18 symbols and zero importers anywhere in src/ or test/.

Gauges: `export_integrity=0` (checked_files=103, checked_symbols=279 — unchanged),
`public_export_surface=279` (unchanged), `layer_import_violations=0`.

---

## 3. SURFACE MOVE — adapters/surface → surfaces (D4-A1 letter bend)

`src/adapters/surface/mediation-surface.ts` → `src/surfaces/mediation-surface.ts`
(`git mv`; layer law: surfaces import app legitimately, adapters must not).

- Internal imports re-based: `../app/mediation.ts`, `../domain/engagement.ts`,
  `../ports/surface.ts`, `../ports/runtime.ts`.
- Header doc updated to record the layer-law rationale.
- Importers updated (import path only, no behavior change):
  - `src/surfaces/cli.ts` → `./mediation-surface.ts`
  - `src/index.ts` → `./surfaces/mediation-surface.ts`
  - `test/runtime/life-runtime-scenarios.test.ts` → `../../src/surfaces/mediation-surface.ts`
  - `test/surfaces/mediation-facade.test.ts` → `../../src/surfaces/mediation-surface.ts`
- Old file deleted; `src/adapters/surface/` now empty (no other files lived there).
- `src/index.ts` public surface unchanged (still exports `createMediationSurface`,
  `MediationSurface` — export_integrity=0 confirms they resolve from the new path).
- No code outside src/ references the old path (only historical outbox/*.md and
  prior EVIDENCE docs mention it, which are records, not importers).

Gauges: `layer_import_violations=0`, `second_door_count=0` (both unaffected).

---

## 4. `npm run check` — GREEN (exit 0)

```
> tsgo --noEmit && npm run lint && npm run test && npm run gauges

tsgo --noEmit            ✓ (0 errors)
oxlint -c oxlint.json    Found 0 warnings and 0 errors (173 files)
node --test 'test/**/*.test.ts'   tests 452 · pass 449 · fail 0 · skipped 3
gauges (run.ts):
  layer_import_violations=0
  second_door_count=0
  public_export_surface=279 (unchanged)
  export_integrity=0 (checked_files=103, checked_symbols=279)
  spawn_public_export_count=0
  pack_parity_delta=0 (case-basic: ok=true)
  gauges: OK
```

Full log: `/tmp/polish2-check.log`.

---

## 5. Coordination & scope hygiene

- `src/app/mediation.ts`: edits confined to the reenter/join path (+ private
  `failReenterGate` helper). Wake path untouched (slice/phase2-parkwake clear);
  no knowledge-face changes (slice/phase2-domainm clear).
- `src/surfaces/cli.ts`: import path change only (slice/phase2-daemon-ipc clear).
- `src/adapters/openworkflow/host.ts`: export drop only, no logic (SqliteRuntimeClient).
- `src/domain/park-bridge.ts`: export drop only, no logic (ParkBridgeInput/Message).
- `src/domain/knowledge/graph.ts`: dead type `GraphBuildError` deleted, no logic change.
- `src/adapters/{pi,prime}` internals: export drop on session-handle option types only.
- `daemon.ts`, `adapters/knowledge/*` untouched.

## 6. Open risks / notes

1. **4 symbols deleted, not just un-exported** (`createPrimePresenceFactory` +
   its two option/composition types, `GraphBuildError`). They were referenced
   nowhere (verified full-tree); export-drop alone fails `noUnusedLocals`. If a
   future slice expected to import them, they are gone (rebuild from wiring.ts /
   graph.ts history if ever needed).
2. **`enforcePackSnapshot` removed from `reenterFromJoin`** — replaced by
   `packPolicy` (default "snapshot"). In-tree callers were one test (updated).
   Private package, but this is an API break for any external consumer.
3. **Direct `reenter()` with no join record and no explicit hash now fails
   loudly** (`PACK_SNAPSHOT_BASELINE_UNAVAILABLE`) instead of silently reentering
   on latest yaml — the intended D2 default; callers must supply a baseline or
   explicitly choose `packPolicy: "latest"`.
4. No commit made (per instruction). Working tree contains all changes above.
