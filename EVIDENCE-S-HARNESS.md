# Evidence — Mediation Substrate Integration (Agent Harness Surface)

**Package:** `@company/mediation`  
**Date:** 2026-07-20  
**Status:** IMPLEMENTED AND VERIFIED  

---

## 1. Integrated Components

| Component | Path | Role |
|-----------|------|------|
| Runner Port | `harness/runner.ts` | In-process execution mapping lifecycles to mediation domain classes |
| CLI Surface | `harness/cli.ts` | CLI wrapper using `runCli` from `@company/test-harness` |
| Loader | `harness/entity-loader.ts` | Loading YAML spec definitions from file system |
| Entities | `harness/entities/*.lifecycle.yml` | Declarative specifications of SUT capabilities |
| Scenarios | `harness/scenarios/*.yml` | Declarative E2E stepping test runs |

---

## 2. Done Criteria Proved

- [x] Programmatic CLI bootstrap matches abstract runner protocol
- [x] In-process runner wires capability resolver, definitions, presence factory, and OpenWorkflow statuses
- [x] Multi-step scenarios compile, interpolate, execute, poll, and clean up correctly
- [x] Node --experimental-strip-types runner parses ESM modules directly from TS source
- [x] Oxlint static analysis passes with 0 warnings/errors on harness files
- [x] Typechecking compilation succeeds under `tsc --noEmit`

---

## 3. Command Checklist

To verify all scenarios E2E, execute the following commands in the package directory:

```bash
# 1. Capability resolve scenario
node --experimental-strip-types harness/cli.ts init harness/scenarios/01-capability-resolve.yml && node --experimental-strip-types harness/cli.ts step 2 && node --experimental-strip-types harness/cli.ts status

# 2. Materialization and engage scenario (fs store)
node --experimental-strip-types harness/cli.ts init harness/scenarios/02-materialize-engage-settled.yml && node --experimental-strip-types harness/cli.ts step 4 && node --experimental-strip-types harness/cli.ts status

# 3. Suspension/Park and Resume scenario
node --experimental-strip-types harness/cli.ts init harness/scenarios/03-park-resume.yml && node --experimental-strip-types harness/cli.ts step 5 && node --experimental-strip-types harness/cli.ts status

# 4. OpenWorkflow dispatch scenario
node --experimental-strip-types harness/cli.ts init harness/scenarios/04-dispatch-workflow.yml && node --experimental-strip-types harness/cli.ts step 2 && node --experimental-strip-types harness/cli.ts status
```

## Commit Evidence
```text
8712be0 Enhance scenario harness with explicit assertion boundaries.

```

## Verification
```text

> check
> tsgo --noEmit && npm run lint && npm run test && npm run gauges


> lint
> oxlint -c oxlint.json

Found 0 warnings and 0 errors.
Finished in 105ms on 115 files with 230 rules using 8 threads.

> test
> node --experimental-strip-types --test 'test/**/*.test.ts'

▶ MemoryCapabilityStore (ABS-A4)
  ✔ put then get returns the same artifact by CapabilityId (5.014334ms)
  ✔ get returns null for unknown id (0.205959ms)
  ✔ seed constructor loads initial artifacts (0.083333ms)
  ✔ get honors optional version selector (0.100208ms)
  ✔ publish stores artifact and returns ref (CapabilityPublisher) (0.11375ms)
  ✔ put overwrites same id for unversioned get (0.107958ms)
  ✔ size and clear work for tests (0.117916ms)
✔ MemoryCapabilityStore (ABS-A4) (6.377666ms)
▶ RegistryCapabilityStore (ABS-R1)
  ✔ get returns null for unknown id (0.441666ms)
  ✔ publish → get round-trip (in-process registry, no network) (0.578583ms)
  ✔ get honors optional version selector (0.130125ms)
  ✔ seed artifacts are readable without publish (0.078666ms)
  ✔ implements CapabilityStore and CapabilityPublisher faces (0.066125ms)
  ✔ publish replaces same id+version (upsert) (0.082833ms)
✔ RegistryCapabilityStore (ABS-R1) (2.017292ms)
▶ DefaultCapabilityResolver (ABS-A6)
  ✔ happy path: merges layers and resolves each extension id from store (3.420833ms)
  ✔ missing extension id → fail-closed diagnostic + plan.ok false (0.4475ms)
  ✔ all missing → empty capabilities, multiple errors (0.257458ms)
  ✔ empty layers → empty effective + ok plan (0.211959ms)
  ✔ pre-merged effective skips layer merge (0.211417ms)
  ✔ layers win over effective when both provided (0.213833ms)
  ✔ optional FsCapabilityStore fixture smoke (bar + missing) (0.762291ms)
✔ DefaultCapabilityResolver (ABS-A6) (6.6935ms)
▶ FS capability search goldens — case-basic
  ✔ resolves foo (internal) and bar (project-extensions) (1.330541ms)
  ✔ agentDef extensions list maps to same plan via FS helper (0.145ms)
  ✔ planHash is stable across two resolves (pack_parity) (10.576458ms)
  ✔ missing pack nope → error diagnostic, ok false (D2 fail-closed) (0.204333ms)
  ✔ search order: tools/internal before extensions (0.074125ms)
  ✔ slash name resolves relative to projectRoot as explicit (0.063125ms)
  ✔ internal wins for bare name foo (0.061167ms)
  ✔ toPackSnapshot carries planHash (0.79275ms)
  ✔ hash is order-independent of input list (canonical sort by id) (0.166709ms)
✔ FS capability search goldens — case-basic (14.394583ms)
▶ FsCapabilityStore (ABS-A3)
  ✔ get(foo) → internal tools path, origin fs, module-path entry (1.821334ms)
  ✔ get(bar) → project-extensions (0.343125ms)
  ✔ get(baz) → .pi/extensions (agent) (3.477042ms)
  ✔ get(qux) → tools/families (0.842ms)
  ✔ get(vendor/extra) slash name → explicit under projectRoot (0.104125ms)
  ✔ get unknown → null (0.096375ms)
  ✔ createFsCapabilityStore factory implements CapabilityStore (0.085833ms)
  ✔ resolveFsModule matches fixture search order (internal wins for foo) (0.080875ms)
  ✔ path is never CapabilityId identity — id stays bare name (0.109ms)
✔ FsCapabilityStore (ABS-A3) (7.973208ms)
▶ YamlDefinitionLoader — case-basic fixture
  ✔ loads fixture agent.yaml into AgentDefinition (golden field map) (11.016167ms)
  ✔ implements DefinitionLoader.load as Promise (2.18725ms)
✔ YamlDefinitionLoader — case-basic fixture (13.718917ms)
▶ YamlDefinitionLoader — fail-closed
  ✔ missing agent.yaml → DEFINITION_NOT_FOUND (0.553792ms)
  ✔ invalid YAML → DEFINITION_INVALID (1.517042ms)
  ✔ missing name/model → DEFINITION_INVALID (1.550875ms)
  ✔ prompt.md missing → DEFINITION_INVALID (0.562583ms)
  ✔ invalid thinking → DEFINITION_INVALID (0.1885ms)
✔ YamlDefinitionLoader — fail-closed (4.602417ms)
▶ YamlDefinitionLoader — model forms + inline prompt
  ✔ accepts structured model {provider,id} (0.33175ms)
  ✔ loads relative prompt path content from rootDir (0.604ms)
✔ YamlDefinitionLoader — model forms + inline prompt (1.033834ms)
▶ YamlDefinitionLoader — optional real company agent
  ✔ loads company/agents/coding-agent when present (2.472166ms)
✔ YamlDefinitionLoader — optional real company agent (2.523917ms)
▶ domain/capability (ABS-A1)
  ✔ asCapabilityId brands a string id (0.677583ms)
  ✔ CapabilityRef keeps locator opaque and optional (0.452791ms)
  ✔ CapabilityPlan fail-closed shape matches packs pattern (0.080917ms)
✔ domain/capability (ABS-A1) (1.749791ms)
▶ domain/config-layer (ABS-A5)
  ✔ empty layers yield empty effective spec (0.80675ms)
  ✔ single agent layer passes through (branding extensions) (0.134417ms)
  ✔ extensions: ordered unique union root → family → agent (1.994083ms)
  ✔ skills: ordered unique union across layers (0.103833ms)
  ✔ tools.builtin and tools.exclude are ordered unique unions (0.09225ms)
  ✔ tools.custom unions like builtin (0.705791ms)
  ✔ tools.agentMode: later layer overrides earlier (0.085542ms)
  ✔ tools.activeTools: later layer replaces (not union) (0.07275ms)
  ✔ agentMode override without activeTools leaves prior activeTools (0.077209ms)
  ✔ sorts by kind even when input order is scrambled (0.110375ms)
  ✔ preserves relative order among same-kind layers (0.06275ms)
  ✔ full root/family/agent fixture merges policy + ids (0.159542ms)
✔ domain/config-layer (ABS-A5) (5.100041ms)
▶ spawn_public_export_count (S11)
  ✔ real src/index.ts has spawn_public_export_count=0 (2.773583ms)
  ✔ detects synthetic export { SpawnEngageAdapter } violation (0.984333ms)
  ✔ detects synthetic spawnEngage function export (0.247917ms)
  ✔ detects re-export from adapters/legacy path (0.070791ms)
  ✔ allows Mediation / materialize surface without false positive (0.063209ms)
✔ spawn_public_export_count (S11) (4.7225ms)
﹣ live Pi factory (MEDIATION_LIVE_PI=1) (0.249542ms) # SKIP
▶ createPiPresenceFactory (integration, fake Pi)
  ✔ materialize + engage → Settled with sessionRef (3.730167ms)
  ✔ materialize resume reuses sessionRef via composition helper (0.273834ms)
  ✔ fail-closed: missing pack prevents materialize (no openSession) (0.361209ms)
✔ createPiPresenceFactory (integration, fake Pi) (4.875833ms)
▶ Mediation.reenter (S8)
  ✔ cold engageLocal → reenter with pack gate → Settled (33.877666ms)
  ✔ packSnapshot mismatch fails reenter without engage (0.348416ms)
  ✔ park via engageLocal → reenter continue → Settled (0.457875ms)
✔ Mediation.reenter (S8) (35.672291ms)
▶ resume fidelity (S3, mock engine)
  ✔ rematerialize resume → same sessionRef + equal packSnapshot.planHash (7.407958ms)
  ✔ join can supply sessionRef for rematerialize (0.293584ms)
✔ resume fidelity (S3, mock engine) (8.184958ms)
▶ resume fidelity (S3, Pi factory fake session)
  ✔ createPiPresenceFactory resume keeps sessionRef + planHash (0.7925ms)
✔ resume fidelity (S3, Pi factory fake session) (0.870875ms)
▶ legacy spawnEngage (private, fail-closed)
  ✔ throws MediationError with SPAWN_DISABLED reason (2.012541ms)
  ✔ is importable only via adapters path (not public product door) (1021.998917ms)
✔ legacy spawnEngage (private, fail-closed) (1024.905375ms)
▶ extensionPathsFromPackPlan (ABS-A8)
  ✔ reads only PackRef.path in plan order; skips empty (0.667667ms)
  ✔ accepts PackLoadPlan adapted from capability artifacts (A7 mapping) (0.172416ms)
  ✔ empty plan → no extension paths (0.062417ms)
✔ extensionPathsFromPackPlan (ABS-A8) (1.385583ms)
▶ PiEngineAdapter (fake Pi session)
  ✔ openSession → sessionRef from sessionFile or sessionId (55.936ms)
  ✔ prompt → agent_settled idle via subscribe + waitUntilIdle (0.801917ms)
  ✔ continue uses agent.continue when present (0.1795ms)
  ✔ interrupt steer / followUp / abort map to Pi surface (11.936292ms)
  ✔ factory materialize + engage Settled with PiEngineAdapter (fake) (1.590333ms)
  ✔ waitUntilIdle respects AbortSignal (0.466417ms)
✔ PiEngineAdapter (fake Pi session) (71.719958ms)
▶ mapPiEvent
  ✔ agent_settled → idle (2.210375ms)
  ✔ agent_end willRetry=true → raw, not idle (0.096125ms)
  ✔ agent_end willRetry=false default → raw (prefer agent_settled) (0.061167ms)
  ✔ agent_end willRetry=false + mapAgentEndAsIdle → idle (0.071ms)
  ✔ tool_execution_start/end → tool phases (0.402125ms)
  ✔ message_update text_delta → assistant message (0.069667ms)
  ✔ message_end extracts text content blocks (0.083542ms)
✔ mapPiEvent (4.712417ms)
﹣ live Pi (MEDIATION_LIVE_PI=1) (0.266083ms) # SKIP
▶ CapabilityStore (ABS-A2)
  ✔ get returns artifact by CapabilityId (0.68825ms)
  ✔ get returns null for unknown id (0.074625ms)
  ✔ get honors optional version selector (0.083875ms)
  ✔ CapabilityPublisher stub accepts publish and echoes ref (0.080583ms)
✔ CapabilityStore (ABS-A2) (1.454583ms)
▶ SurfacePort (ABS-B1)
  ✔ mock engageLocal returns Settled with correlation fields (2.396917ms)
  ✔ optional dispatch + getStatus shape (0.317334ms)
  ✔ optional reenter with packSnapshot gate (0.342917ms)
  ✔ resume on SurfaceRequest is accepted by engageLocal (0.168875ms)
✔ SurfacePort (ABS-B1) (4.308916ms)
▶ engage → Parked (S9)
  ✔ parkIntent → parked status + resumeToken (2.094791ms)
  ✔ park → dispose → rematerialize resume → continue Settled (7.824667ms)
  ✔ leaf writes join parked record (0.676958ms)
✔ engage → Parked (S9) (11.243ms)
▶ settled-policy
  ✔ idle + no park → allow Settled (0.953917ms)
  ✔ park intent → deny Settled (0.093833ms)
✔ settled-policy (2.039209ms)
▶ materialize + engage → Settled (mock engine)
  ✔ factory materialize then engage returns settled with sessionRef (33.935584ms)
  ✔ materialize resume reuses sessionRef (0.258042ms)
  ✔ fail-closed: missing pack prevents materialize (0.400792ms)
✔ materialize + engage → Settled (mock engine) (34.727625ms)
▶ DefaultPresenceFactory + CapabilityResolver (CUT)
  ✔ materialize with MemoryCapabilityStore + createCapabilityResolver → Settled (37.732625ms)
  ✔ materialize with default FsCapabilityStore path → Settled (0.390333ms)
  ✔ missing capability fails materialize (no openSession) (0.387459ms)
  ✔ capabilitySpecFromDefinition maps extensions, tools, skills (0.405916ms)
  ✔ packLoadPlanFromCapabilityArtifacts maps module-path + locator fallback (0.109959ms)
✔ DefaultPresenceFactory + CapabilityResolver (CUT) (39.6275ms)
▶ PRODUCT-1 resolveHostedJoin policy
  ✔ memory dbPath → MemoryJoinStore when join omitted (0.966ms)
  ✔ file dbPath → owned SqliteJoinStore at default sibling path (11.765542ms)
  ✔ explicit joinPath overrides default sibling (2.154833ms)
  ✔ injected join is never owned (0.099541ms)
✔ PRODUCT-1 resolveHostedJoin policy (16.21075ms)
▶ PRODUCT-1 durable hosted dispatch (mock mind, file sqlite)
  ✔ dispatch → wait → stop → reopen join row survives (159.24325ms)
  ✔ :memory: hosted still uses MemoryJoinStore (0.725666ms)
✔ PRODUCT-1 durable hosted dispatch (mock mind, file sqlite) (160.108792ms)
▶ PRODUCT-1 optional coding-agent pilot (skip if absent)
  ✔ loads coding-agent and CapabilityResolver ok against company root (18.288125ms)
  ✔ engageLocal mock mind Settled for coding-agent (capability path) (1.464417ms)
✔ PRODUCT-1 optional coding-agent pilot (skip if absent) (19.878875ms)
▶ ABS-B3 Recipe interface
  ✔ Recipe shape: name + run(ctx, input) (0.420042ms)
✔ ABS-B3 Recipe interface (0.8905ms)
▶ ABS-B3 solo recipe
  ✔ solo → engageLocal Settled (10.421792ms)
✔ ABS-B3 solo recipe (10.495125ms)
▶ ABS-B3 reenter recipe
  ✔ reenter → same sessionRef + pack gate match (0.462542ms)
✔ ABS-B3 reenter recipe (0.541459ms)
▶ ABS-B3 dispatch recipe
  ✔ dispatch without wait returns handle only (0.230542ms)
  ✔ dispatch + wait returns terminal status (0.113792ms)
  ✔ dispatch without runtime throws (0.298041ms)
✔ ABS-B3 dispatch recipe (0.779792ms)
▶ ABS-B3 plan recipe
  ✔ plan → runPlan when runtime present (0.126708ms)
  ✔ plan without runtime throws (0.09625ms)
✔ ABS-B3 plan recipe (0.301584ms)
▶ runEngagementArc (LIFE-P1/P2)
  ✔ settled path: one leaf step, no waitForSignal (26.25875ms)
  ✔ LIFE-P2: park → wake → continue leaf Settled (same sessionRef) (1.07325ms)
  ✔ LIFE-P2: re-park once then settle (0.598084ms)
  ✔ parked without waitForSignal → fail-closed PARK_WAIT_UNAVAILABLE (0.242291ms)
  ✔ exports max park loop constant (0.062875ms)
✔ runEngagementArc (LIFE-P1/P2) (42.346833ms)
▶ engagement leaf + Pi factory (S5b, fake session)
  ✔ materialize → join → engage → settled via createPiPresenceFactory (5.30275ms)
  ✔ resume sessionRef flows through leaf + Pi factory (0.68075ms)
  ✔ fail-closed pack resolve → failed; no engine open (0.32675ms)
✔ engagement leaf + Pi factory (S5b, fake session) (7.185667ms)
▶ engagement leaf (Gamma structure, mock engine)
  ✔ materialize → join → engage → settled + packSnapshotHash (27.692625ms)
  ✔ resume sessionRef flows through materialize (0.294542ms)
  ✔ fail-closed pack resolve → failed output, no join row (0.264125ms)
✔ engagement leaf (Gamma structure, mock engine) (28.795125ms)
▶ MemoryJoinStore
  ✔ put / get / updateStatus (0.108083ms)
✔ MemoryJoinStore (0.171667ms)
▶ createHostedMediation (ABS-C2, mock mind)
  ✔ exposes mediation, host, runtime, worker, join, stop (0.768791ms)
  ✔ mediation.dispatch → worker → wait completed with Settled-shaped output (119.232125ms)
  ✔ engageLocal still works on hosted composition (5.205333ms)
  ✔ createHostedMediation default resolve uses yaml loader for load() (3.417833ms)
✔ createHostedMediation (ABS-C2, mock mind) (184.896416ms)
▶ LIFE runtime scenarios (hosted Mediation, mock mind)
  ✔ R1: hosted settle via Mediation.dispatch + wait + join (74.591542ms)
  ✔ R2+R3: park wait then Mediation.wake → Settled same session (135.965583ms)
  ✔ R4: wake recipe with wait (129.785208ms)
  ✔ R5: SurfacePort dispatch park → wake → wait (165.249583ms)
  ✔ R6: cancel pending run (0.898292ms)
  ✔ R6b: cancel while parked-wait (88.238125ms)
  ✔ R7: fail-closed packs → completed failed leaf (82.244583ms)
  ✔ R8: resume sessionRef through dispatch (80.989708ms)
  ✔ R9: local engageLocal without runtime (4.895667ms)
  ✔ R10: local park + reenter continue (1.293167ms)
  ✔ R11: runPlan two settled nodes (48.3825ms)
  ✔ R14: re-park via wake parkIntent then settle (409.236833ms)
  ✔ R15: local mediation control verbs throw without runtime (0.486167ms)
  ✔ R-recipe dispatch with wait (64.9155ms)
✔ LIFE runtime scenarios (hosted Mediation, mock mind) (1339.546ms)
▶ LIFE runtime scenarios (file-backed hosted)
  ✔ R12+R13: file db settle + park/wake join durable after stop (353.9255ms)
✔ LIFE runtime scenarios (file-backed hosted) (354.190958ms)
﹣ live engagement leaf + Pi (MEDIATION_LIVE_PI=1) (0.250667ms) # SKIP
﹣ live life health (MEDIATION_LIVE_PI=1) (0.565708ms) # SKIP
﹣ live OW worker + Pi factory (MEDIATION_LIVE_PI=1) (0.260167ms) # SKIP
▶ runPlanWorkflow pure body (S10, no OW)
  ✔ 2-node sequential plan both Settled (11.447458ms)
  ✔ fail-closed missing pack on one node → plan kind failed, node failed (0.42425ms)
✔ runPlanWorkflow pure body (S10, no OW) (12.368458ms)
▶ OW worker + plan leaf (S10, mock mind)
  ✔ runPlan → worker → wait completed with 2 Settled nodes (81.334166ms)
  ✔ fail-closed pack on plan node → OW completed with plan kind failed (64.014959ms)
  ✔ runPlan without planSpec still throws (0.747375ms)
✔ OW worker + plan leaf (S10, mock mind) (219.054583ms)
▶ OpenWorkflowRuntime (live OW client, no worker)
  ✔ dispatch returns runId and getStatus is pending without worker (10.836667ms)
  ✔ idempotencyKey reuses clientRequestId (0.825708ms)
  ✔ cancel moves pending run to canceled (0.899667ms)
  ✔ sendSignal does not throw (no waiter → empty delivery) (0.832417ms)
  ✔ wait times out while pending without worker (86.276333ms)
  ✔ wait returns canceled when run canceled mid-wait (42.13125ms)
  ✔ runPlan enqueues plan workflow when planSpec configured (0.606958ms)
  ✔ runPlan without planSpec throws (0.454167ms)
  ✔ getStatus unknown runId → failed RUN_NOT_FOUND (0.165875ms)
  ✔ dispatch maps resume SessionRef into engagement input (0.344375ms)
✔ OpenWorkflowRuntime (live OW client, no worker) (144.906208ms)
▶ OpenWorkflowRuntime with mock client (unit)
  ✔ maps OW statuses through getStatus (0.535708ms)
✔ OpenWorkflowRuntime with mock client (unit) (0.593917ms)
▶ OW worker + engagement leaf (S5c, mock mind)
  ✔ dispatch → worker → wait completed with Settled-shaped output (113.047833ms)
  ✔ resume sessionRef through worker path (101.870708ms)
  ✔ fail-closed pack → completed run with failed leaf output (63.610083ms)
  ✔ LIFE-P1/P2: parkIntent → wait → wake continue → Settled (152.498ms)
✔ OW worker + engagement leaf (S5c, mock mind) (515.389917ms)
▶ OW worker + Pi factory (S5d, fake session)
  ✔ dispatch → worker → wait completed Settled via Pi factory (98.609375ms)
  ✔ resume sessionRef through worker + Pi factory (63.250208ms)
  ✔ fail-closed pack → completed with failed leaf (Pi not opened for packs) (79.756958ms)
✔ OW worker + Pi factory (S5d, fake session) (315.822541ms)
▶ createSqliteRuntimeHost (ABS-C1, mock mind)
  ✔ constructs host with runtime, worker, join, ow (0.441834ms)
  ✔ dispatch → worker → wait completed with Settled-shaped output (106.222875ms)
  ✔ optional registerPlan wires runPlan path (164.180583ms)
✔ createSqliteRuntimeHost (ABS-C1, mock mind) (655.395584ms)
▶ engagement signals (scaffold)
  ✔ namespaces wake signal by runId (0.353584ms)
  ✔ parses WakeSignalData and string shorthand (1.045833ms)
✔ engagement signals (scaffold) (2.009291ms)
▶ SqliteJoinStore
  ✔ put / get / updateStatus in memory (1.828709ms)
  ✔ survives close + reopen on file path (2.774167ms)
  ✔ updateStatus on missing run throws (0.366667ms)
  ✔ re-put same runId overwrites; session unique moves (0.256417ms)
✔ SqliteJoinStore (6.707333ms)
{
  "outcome": {
    "kind": "settled",
    "sessionRef": "mock-session-1"
  },
  "sessionRef": "mock-session-1",
  "packSnapshotHash": "ca3babef42a62fdfc5122e46bbeedd188b3ca4f2c165b6dd8ca15372904ac7c3",
  "definitionId": "cli-s7"
}
mediation CLI (S7)

Commands:
  engage --agent <dir> --task <text> [--resume <sessionRef>] [--name <id>] [--project-root <dir>]

Options:
  --agent         Path to agent root (agent.yaml)
  --task          Engagement text
  --resume        SessionRef to rematerialize
  --name          Agent name override (default: basename of --agent)
  --project-root  Pack resolve root (default: agent dir)
  --no-json       Human-readable outcome (default: JSON on stdout)

Env:
  MEDIATION_CLI_PI=1  use Pi factory composition (default: mock engine)

{
  "outcome": {
    "kind": "settled",
    "sessionRef": "injected",
    "result": {}
  },
  "sessionRef": "injected",
  "packSnapshotHash": "hash",
  "definitionId": "injected-agent"
}
▶ Mediation façade (S7)
  ✔ engageLocal → Settled; resume keeps sessionRef (2.51325ms)
  ✔ yaml load via createLocalMediation (6.228792ms)
  ✔ dispatch without runtime throws (0.266834ms)
  ✔ createYamlDefinitionLoader still golden on fixture (1.033334ms)
✔ Mediation façade (S7) (10.542792ms)
▶ CLI parse / help / smoke (S7 / ABS-B2)
  ✔ parseArgs extracts engage flags (0.133ms)
  ✔ printHelp is non-empty (0.052375ms)
  ✔ runCli engage settles with mock mind (1.7175ms)
  ✔ runCli missing args exits 2 (0.1055ms)
✔ CLI parse / help / smoke (S7 / ABS-B2) (2.140959ms)
▶ createMediationSurface (ABS-B2)
  ✔ wraps Mediation.engageLocal as SurfacePort (0.375375ms)
  ✔ runCli uses injected SurfacePort without compose (0.1555ms)
✔ createMediationSurface (ABS-B2) (0.605792ms)
ℹ tests 205
ℹ suites 58
ℹ pass 205
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6551.0455

> gauges
> node --experimental-strip-types scripts/gauges/run.ts

=== @company/mediation gauges ===

layer_import_violations=0
second_door_count=0
public_export_surface=186
  export AgentDefinition
  export AgentPresence
  export AgentRef
  export AttachSurface
  export CapabilityArtifact
  export CapabilityDiagnostic
  export CapabilityDiagnosticSeverity
  export CapabilityEntry
  export CapabilityGetOptions
  export CapabilityId
  export CapabilityKind
  export CapabilityOrigin
  export CapabilityPlan
  export CapabilityPublisher
  export CapabilityRef
  export CapabilityResolveInput
  export CapabilityResolveResult
  export CapabilityResolver
  export CapabilitySpec
  export CapabilityStore
  export ConfigLayer
  export ConfigLayerKind
  export CreateHostedMediationOptions
  export CreateLocalMediationOptions
  export CreateSqliteRuntimeHostOptions
  export DefaultAgentPresence
  export DefaultAgentPresenceOptions
  export DefaultCapabilityResolver
  export DefaultCapabilityResolverOptions
  export DefaultPresenceFactory
  export DefaultPresenceFactoryDeps
  export DefinitionLoader
  export DispatchHandle
  export DispatchInput
  export DispatchRecipeInput
  export DispatchRecipeResult
  export ENGAGEMENT_ARC_MAX_PARK_LOOPS
  export ENGAGEMENT_WAKE_KIND
  export ENGAGEMENT_WORKFLOW_NAME
  export EffectiveCapabilitySpec
  export EngageInput
  export EngageLocalInput
  export EngageLocalResult
  export EngagementArcDeps
  export EngagementArcStep
  export EngagementLeafDeps
  export EngagementOwClient
  export EngagementRecord
  export EngagementStatus
  export EngagementWorkflowInput
  export EngagementWorkflowOutput
  export EngineEvent
  export EnginePort
  export EngineSessionHandle
  export EngineSettingsPolicy
  export FsCapabilitySource
  export FsCapabilityStore
  export FsCapabilityStoreOptions
  export FsResolvedModule
  export HostedMediationComposition
  export IdleSnapshot
  export InterruptKind
  export JoinKeys
  export JoinStore
  export LocalMediationComposition
  export MaterializeOptions
  export Mediation
  export MediationDeps
  export MediationError
  export MediationErrorCode
  export MediationEvent
  export MediationSurface
  export MemoryCapabilityStore
  export MemoryJoinStore
  export ModelSpec
  export OpenSessionRequest
  export OpenWorkflowRuntime
  export OpenWorkflowRuntimeOptions
  export OwWorkflowRunStatus
  export PLAN_WORKFLOW_NAME
  export PackDiagnostic
  export PackDiagnosticSeverity
  export PackLoadPlan
  export PackRef
  export PackSnapshot
  export PackSnapshotFn
  export PackSource
  export PiEngineAdapter
  export PiEngineAdapterOptions
  export PlanEdgeSpec
  export PlanLeafDeps
  export PlanNodeResult
  export PlanNodeSpec
  export PlanOwClient
  export PlanRecipeInput
  export PlanRecipeResult
  export PlanSpec
  export PlanWorkflowOutput
  export PresenceEvent
  export PresenceFactory
  export PresenceStatus
  export PublishCapabilityInput
  export Recipe
  export RecipeContext
  export ReenterInput
  export ReenterRecipeInput
  export ReenterRecipeResult
  export ReenterResult
  export RegisterEngagementWorkflowDeps
  export RegisterEngagementWorkflowResult
  export RegisterPlanWorkflowDeps
  export RegisterPlanWorkflowResult
  export RegistryCapabilityStore
  export RegistryCapabilityStoreOptions
  export RunEngagementArcParams
  export RunId
  export RunOutcome
  export RuntimeBackend
  export RuntimeHostOw
  export RuntimeHostWorker
  export RuntimeOwClient
  export RuntimePort
  export RuntimeStatus
  export SessionRef
  export SettledDecision
  export SettledPolicyInput
  export SoloInput
  export SoloResult
  export SqliteJoinStore
  export SqliteJoinStoreOptions
  export SqliteRuntimeHost
  export SurfaceEngageMode
  export SurfaceEngageResult
  export SurfacePort
  export SurfaceReenterRequest
  export SurfaceReenterResult
  export SurfaceRequest
  export ToolPolicy
  export WakeRecipeInput
  export WakeRecipeResult
  export WakeSignalData
  export WorkflowSpecRef
  export YamlDefinitionLoader
  export YamlDefinitionLoaderOptions
  export asCapabilityId
  export asRunId
  export asSessionRef
  export capabilitySpecFromDefinition
  export createCapabilityResolver
  export createFsCapabilityStore
  export createHostedMediation
  export createLocalMediation
  export createMediationSurface
  export createRegistryCapabilityStore
  export createSqliteRuntimeHost
  export createYamlDefinitionLoader
  export defaultEngagementWorkflowSpec
  export defaultHostedJoinPath
  export defaultPlanWorkflowSpec
  export dispatch
  export engagementSignalName
  export engagementWakeSignal
  export evaluateSettled
  export loadPromptField
  export mapYamlToDefinition
  export maySettle
  export mergeCapabilitySpecs
  export modulePathFromArtifact
  export packLoadPlanFromCapabilityArtifacts
  export packPlanHash
  export parseWakeSignalData
  export plan
  export planNodeToEngagementInput
  export reenter
  export registerEngagementWorkflow
  export registerPlanWorkflow
  export resolveCapabilityResolver
  export resolveFsModule
  export resolveHostedJoin
  export runEngagementArc
  export runEngagementLeaf
  export runPlanWorkflow
  export solo
  export summarizePlanResults
  export toPackSnapshot
  export wake
export_integrity=0
checked_files=75
checked_symbols=186
spawn_public_export_count=0
--- pack_plan (S1) ---
  case-basic: pack_plan_hash=3444ae487b30b4cdfca3ad6f1abd9dca516ee4ffc85c479599f40ff64441f7f4 pack_parity_delta=0 pack_count=2 ok=true
pack_parity_delta=0

gauges: OK
```
