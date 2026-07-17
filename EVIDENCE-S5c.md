# Evidence — Slice S5c (OW worker + engagement leaf, mock mind)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Law:** D0 Gamma leaf, RuntimePort, worker executes orchestration  
**Depends on:** S5a RuntimePort + leaf, S2 mock factory path

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `src/adapters/openworkflow/register-engagement.ts` | `registerEngagementWorkflow` — `implementWorkflow` + leaf in durable step |
| `test/runtime/ow-worker-engagement.test.ts` | sqlite backend + worker start + RuntimePort dispatch/wait |
| `src/index.ts` | public export of register helper + types |
| `EVIDENCE-S5c.md` | this packet |

---

## 2. Composition pattern

```
OpenWorkflow({ BackendSqlite })
  → registerEngagementWorkflow(ow, { factory, join, resolveDefinition })
  → ow.newWorker({ concurrency }).start()
  → OpenWorkflowRuntime.dispatch(DispatchInput)
  → worker runs step "engagement-leaf" → runEngagementLeaf
  → RuntimePort.wait → completed + EngagementWorkflowOutput
```

- Join `runId` = OW workflow run id (`run.id` inside handler).
- Mock mind: `MockEnginePort` + `DefaultPresenceFactory` (no live Pi).
- Leaf fail-closed (pack miss) → **OW status completed**, output `kind: failed` (not workflow crash).

---

## 3. Proofs (default check)

| Case | Result |
|------|--------|
| dispatch → wait → completed, Settled-shaped output | pass |
| join row settled + packSnapshotHash parity | pass |
| resume sessionRef via dispatch.resume | pass |
| fail-closed pack → completed + failed leaf output | pass |

```
▶ OW worker + engagement leaf (S5c, mock mind)
  ✔ dispatch → worker → wait completed with Settled-shaped output
  ✔ resume sessionRef through worker path
  ✔ fail-closed pack → completed run with failed leaf output
```

---

## 4. Closes S5a gap

S5a without worker left runs **pending**. S5c proves the full mock orchestration path to **completed**.

---

## 5. Not in S5c

| Item | Owner |
|------|--------|
| Worker + live / real Pi factory | S5d |
| Production worker process / CLI | S7 / ops |
| Plan-executor workflow body | later |

---

## 6. Check

`npm run check` green.  
`layer_import_violations=0` · `second_door_count=0`
