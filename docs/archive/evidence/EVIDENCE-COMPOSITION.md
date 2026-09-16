# EVIDENCE-COMPOSITION — composite CapabilityStore + family yaml layers (issue #4)

**Slice:** COMPOSITION · **Date:** 2026-08-07 · **Issue:** github.com/rethink-paradigms/mediation#4
**Built by:** composition-builder sub-agent (lead-verified in isolation after the
sub-agent was stopped mid-flight; both wave-2 slices share one working tree, so
the lead froze, isolated, and committed each slice separately).

## 1. Composite CapabilityStore (D5 L2/L4, ABS-A2)

- `src/adapters/capability/composite-store.ts` (NEW): ordered CapabilityStore
  chain — `get` walks stores in order, first hit wins, empty chain legal and
  fail-closed (null → CapabilityResolver diagnostic → materialize never
  half-loads). `publish` routes to a single publisher (the registry head in
  default composition) so builder agents write once and read back through the
  registry without filesystem paths (D5 L5).
- `src/adapters/capability/fs-store.ts`: version/digest plumbing + composite
  hook (8-line delta; behavior preserved).
- `src/adapters/compose.ts`: `createCompositeCapabilityStore` composition root
  (registry → fs default order), wired as the default store; existing
  `createLocalMediation` / `createHostedMediation` signatures preserved.
- `src/index.ts`: appended `CompositeCapabilityStore` export.
- Tests: `test/capability/composite-store.test.ts` — chain order, first-hit
  wins, fail-closed on miss, publish→get round-trip through registry head.

## 2. Multi-file family yaml layers (D5 L3, CONTEXT next #3)

- `src/adapters/definition/yaml-definition-loader.ts`: root·family·agent layer
  loading — agent.yaml may declare `extends: <name-or-path>` (family) and
  optional root ref; loader resolves the chain root→family→agent, each layer a
  yaml with the CapabilitySpec shape; `extends` chain loop-guarded and
  fail-closed on missing/cycle. Single-file load preserved (backward compat).
- `src/domain/definition.ts`: root/family refs on AgentDefinition (4-line delta).
- `src/app/factory.ts`: resolve path now uses the MERGED spec
  (mergeCapabilitySpecs across root→family→agent) instead of agent layer only —
  engine/thinking/tools/extension capabilities flow from the merged layers.
- `src/domain/config-layer.ts` merge reused as-is.
- Tests: `test/definition/family-layers.test.ts` — chain precedence
  (agent > family > root), cycle detection, missing family fail-closed, engine
  field flows from family when agent omits, tools policy merge.

## 3. Verification (lead)

- **Isolation (worktree at 2be2d79, surfaces slice only):** 405 pass / 0 fail.
- **Combined tree (this slice + surfaces):** `npm run check` run by lead —
  see check summary at commit time (expected 40x pass / 0 fail; gauges 0).
- Sub-agent's own runs before stop: check4 EXIT:0 (409 tests / 406 pass).

## Not touched

surfaces/** , ports/{surface,notify}.ts, app/mediation.ts, recipes/{live,
interrupt,observe}.ts, domain/events.ts, knowledge/**, prime/**, pi/**,
engine-registry, domain/engine.ts, package.json (no new deps).
