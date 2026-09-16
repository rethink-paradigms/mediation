# Evidence — Remove dead PackResolver production surface

**Date:** 2026-07-18  
**After:** CUT sole CapabilityResolver path  

## Problem

`resolve-packs.ts` + `ports/pack-resolver.ts` were dead in production after CUT; kept alive only by tests, gauge, and public exports.

## Done

| Change |
|--------|
| Deleted `src/ports/pack-resolver.ts` |
| Deleted `src/adapters/packs/resolve-packs.ts` |
| Removed PackResolver* public exports from `src/index.ts` |
| `agentDefForPacks` → `test/helpers/agent-def.ts` |
| FS plan helper for goldens/gauge → `test/helpers/fs-pack-plan.ts` (uses `resolveFsModule`) |
| Goldens retargeted → `test/capability/fs-search-goldens.test.ts` |
| Gauge pack-plan uses FS helper, not PackResolverImpl |
| Kept `pack-snapshot.ts` + domain pack types (engine bridge) |

## Production resolve (unchanged from CUT)

```
CapabilityResolver → CapabilityStore (Fs default) → packLoadPlanFromCapabilityArtifacts
```

## Check

`npm run check` green · 174 tests · gauges OK · no PackResolver on public export surface
