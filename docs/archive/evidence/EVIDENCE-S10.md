# Evidence — Slice S10 (Plan leaf, same Gamma leaf)

**Package:** `@company/mediation`  
**Branch:** `slice/S10-plan-leaf`  
**Date:** 2026-07-18  
**Law:** D0 Gamma leaf reuse; RuntimePort.runPlan; no second monocoque  

---

## 1. What landed

| Path | Role |
|------|------|
| `src/adapters/openworkflow/workflows/plan.ts` | Sequential `runPlanWorkflow` — each PlanSpec node → `runEngagementLeaf` |
| `src/adapters/openworkflow/register-plan.ts` | `registerPlanWorkflow(ow, deps)` — implementWorkflow + durable `step.run` per node |
| `test/runtime/ow-plan.test.ts` | Pure body + OW worker + fail-closed + runPlan without planSpec |
| `src/index.ts` | Append-only exports for plan symbols |
| `EVIDENCE-S10.md` | this packet |

**Behavior (v1):**

- Nodes run in `PlanSpec.nodes` array order; edges ignored.
- Each node maps to engagement input and calls the same Gamma leaf with injected factory / join / resolveDefinition.
- Join keys: `${planRunId}:${nodeId}` (OW path) or `${plan.id}:${nodeId}` (pure path).
- Plan output: `{ kind: "completed" \| "failed", planId, nodes: [{ nodeId, outcome }] }`.
  - `kind: "completed"` iff every node outcome is `settled`.
  - Fail-closed pack → node `outcome.kind === "failed"` with `PACK_RESOLVE_FAILED`; plan `kind: "failed"`; OW run still **completed** (not crash).
- `runPlan` without `planSpec` still throws (existing S5a behavior).

---

## 2. Test names (default check, mock mind)

| Suite | Case |
|-------|------|
| `runPlanWorkflow pure body (S10, no OW)` | `2-node sequential plan both Settled` |
| `runPlanWorkflow pure body (S10, no OW)` | `fail-closed missing pack on one node → plan kind failed, node failed` |
| `OW worker + plan leaf (S10, mock mind)` | `runPlan → worker → wait completed with 2 Settled nodes` |
| `OW worker + plan leaf (S10, mock mind)` | `fail-closed pack on plan node → OW completed with plan kind failed` |
| `OW worker + plan leaf (S10, mock mind)` | `runPlan without planSpec still throws` |

Also retained: `OpenWorkflowRuntime` `runPlan enqueues…` / `runPlan without planSpec throws` (S5a).

---

## 3. Check

```text
npm run check
```

**Result:** exit 0  

- typecheck: pass  
- tests: 90 pass (0 fail); S10 plan path included (no `MEDIATION_LIVE_PI`)  
- gauges: `layer_import_violations=0`, `second_door_count=0`  

---

## 4. Git

```text
ab0d856 S10: Plan leaf reuses Gamma engagement via sequential OW workflow.
```

Full SHA: `ab0d856acc111072e36ff0dcdb5d9218d832321b`  
Branch only: `slice/S10-plan-leaf`. **Not merged to main.**

---

## 5. What was not done

- Edge / topological ordering (v1 sequential array order only)
- Parallel node execution
- Live Pi plan worker path
- Plan-executor migration beyond this monocoque leaf
- Changes under `src/adapters/pi/**`, S11 legacy/spawn, or other worktrees
