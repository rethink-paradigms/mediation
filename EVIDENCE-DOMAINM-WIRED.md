# EVIDENCE-DOMAINM-WIRED — Domain M (capability graph) wired into the product (phase 2)

**Slice:** slice/phase2-domainm · **Worktree:** /tmp/wt-domainm · **Date:** 2026-08-08
**Intent (verbatim user decision):** Domain M MUST be exposed so it can be consumed —
the terminal agent is the PRIMARY CITIZEN of the mediation system and needs equal
access through the Pi extension; the human gets a different surface later. So: wire
the capability-graph ops into the Mediation façade.

## 1. What shipped (files)

| File | Change |
| --- | --- |
| `src/domain/knowledge/graph.ts` | A3 bug fix — error messages interpolate the loop variable `identity`, not the module-level `id()` function (2 lines). |
| `src/domain/knowledge/types.ts` | Seam only: optional `agentRef?: AgentRef` on `CapabilityNode` (pure-domain type; D5-safe ref, not a path). No data migration. |
| `src/ports/knowledge.ts` | Optional `agentFor?(identity): Promise<AgentRef \| undefined>` on `KnowledgePort` — the catalog→agent bridge seam. The six spec ops are unchanged. |
| `src/adapters/knowledge/service.ts` | `KnowledgeService` implements `agentFor` (node-declared `agentRef` wins, then constructor-injected `agentRefs` mapping); `createKnowledgeService(graph?, agentRefs?)` — backward-compatible signatures. |
| `src/app/mediation.ts` | NEW `knowledge` face on the façade: `Mediation.knowledge` (type `MediationKnowledgeFace`) with `listCapabilities / describeCapability / resolveIntent / validate / compose / explain` + optional `agentFor`. `MediationDeps.knowledge?` — purely additive (no existing method touched). |
| `src/adapters/compose.ts` | `createLocalMediation` / `createHostedMediation` inject `KnowledgeService` (DEFAULT_CATALOG) by default; `CreateLocalMediationOptions.knowledge?` overrides. |
| `src/index.ts` | Exported `MediationKnowledgeFace` type (public surface: 280 exports, export_integrity=0). |
| `test/knowledge/graph.test.ts` | NEW — A3 regression: bad node messages name the identity and never contain `function` source. |
| `test/knowledge/facade-knowledge.test.ts` | NEW — façade-level tests through `createLocalMediation`/`createHostedMediation` (list/describe/resolve/validate/compose/explain), explicit-port injection, agent bridge (runtime mapping + node seam), default-catalog limitation, no-fake-op behavior. |

## 2. Façade face shape (the public API the Pi extension consumes)

```ts
// @company/mediation — stable public shape
const { mediation } = createLocalMediation({ projectRoot });   // or createHostedMediation
const k = mediation.knowledge;                                  // always wired by composition

await k.listCapabilities({ category: "m.tools" });              // NodeSummary[]
await k.describeCapability("m.thinking");                        // node + incidentEdges
await k.resolveIntent("make it more careful");                   // ranked IntentMatch[]
await k.validate({ "m.thinking": "high" });                      // ValidationResult
await k.compose(["m.tools.read", "m.tools.grep"]);               // emergent behavior + requires
await k.explain({ "m.thinking": "medium" });                     // why-choices statements
await k.agentFor?.(match.identity);                              // AgentRef | undefined (bridge)
```

- Face is `MediationKnowledgeFace` (exported from `src/index.ts`).
- `agentFor` appears on the face ONLY when the wired port implements it (no fake
  "no mapping" op on the public surface). `KnowledgeService` always implements it.
- Direct `new Mediation(...)` without a `knowledge` dep has `knowledge === undefined`
  (composition is the product path and always wires it).
- Naming follows the task contract: `listCapabilities / describeCapability /
  resolveIntent / validate / compose / explain` (port keeps its short
  list/describe/resolve names; the face renames for surfaces).

## 3. Graph bug fix (CODEBASE-REVIEW.md A3)

`src/domain/knowledge/graph.ts:53,57` — the message templates interpolated the
module-level `id()` FUNCTION instead of the loop variable `identity`:

```diff
- errors.push(`node "${id}" has no intent signatures`);
+ errors.push(`node "${identity}" has no intent signatures`);
- errors.push(`node "${id}" has an empty enum domain`);
+ errors.push(`node "${identity}" has an empty enum domain`);
```

Verified by `test/knowledge/graph.test.ts`: the thrown message contains the node
identity (`m.bad-signatures`) and must NOT contain the string `function` (the bug
printed the `id()` function source). 3 tests green.

## 4. Catalog → agent bridge status

**Seam shipped (two layers, both optional, no data migration):**
1. `CapabilityNode.agentRef?: AgentRef` — catalog authors can declare the mapping
   declaratively on a node (pure domain type).
2. `KnowledgeService(graph, agentRefs)` / `createKnowledgeService(graph, agentRefs)`
   — runtime mapping `Record<capabilityIdentity, AgentRef>` injected at the adapter.
   `agentFor(identity)` checks node-declared `agentRef` first, then the mapping.

**Full flow proven in tests:** `resolveIntent("let it read files")` →
`m.tools.read` → `agentFor` → `{ name: "web-researcher", rootDir: ... }` (an
AgentRef the DefinitionLoader resolves → `mediation.load(ref)` → engage).

**Known limitation (documented, by design):** the DEFAULT_CATALOG is PURE
capability data — its 25 nodes are engine dimensions (m.thinking, m.tools.*), not
agents. No node carries an `agentRef` and no default mapping is registered, so
`agentFor` returns `undefined` for every default identity today. Intent strings
about *agents* ("dispatch our web researcher") therefore resolve to capability
matches but not to AgentRefs until a catalog-accuracy pass (later, separate) adds
agent nodes / agentRefs or a runtime mapping is injected. The seam is in place so
that pass needs no port or façade changes.

## 5. Test matrix

| Scope | Result |
| --- | --- |
| NEW `test/knowledge/graph.test.ts` (A3 regression) | 3/3 pass |
| NEW `test/knowledge/facade-knowledge.test.ts` (face + bridge) | 11/11 pass |
| Existing DOMAIN-M scenario suite `test/knowledge/scenarios.test.ts` | unchanged, green |
| Existing KnowledgePort suite `test/knowledge/port.test.ts` | unchanged, green |
| Full package suite (`npm run test`) | 462 tests · 459 pass · 0 fail · 3 skipped (pre-existing env-gated live suites) |
| `npm run typecheck` (tsgo) | GREEN |
| `npm run lint` (oxlint) | GREEN (0 warnings / 0 errors) |
| `npm run gauges` | layer_import_violations=0 · second_door_count=0 · export_integrity=0 · spawn_public_export_count=0 · pack_parity_delta=0 |
| **`npm run check`** | **GREEN** (exit 0) |

## 6. Coordination notes

- Changes are ADDITIVE and localized in `src/app/mediation.ts` (new `knowledge`
  field/face + one optional dep; no existing method restructured) — compatible
  with the parallel slice/phase2-parkwake worktree that also touches
  `app/mediation.ts`.
- Untouched as instructed: `src/surfaces/*`, `src/adapters/pi|prime`,
  `src/adapters/openworkflow/host.ts`, `domain/park-bridge.ts`, reenter/wake
  internals.
- NOT committed (task instruction). Branch `slice/phase2-domainm` in
  /tmp/wt-domainm.
