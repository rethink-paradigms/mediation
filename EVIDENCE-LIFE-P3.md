# Evidence — LIFE-P3 control façade + runtime scenarios

**Date:** 2026-07-18  
**Branch:** `slice/LIFE-P3-runtime-control`  
**Contracts:** `LIFE-P3-control-facade-contract.md`, `RUNTIME-SCENARIOS.md`

---

## Façade (P3)

| API | Location |
|-----|----------|
| `Mediation.cancel` | `app/mediation.ts` |
| `Mediation.sendSignal` | same |
| `Mediation.wake` | same → signal kind `"wake"` |
| recipe `wake` | `app/recipes/wake.ts` (+ optional wait) |
| SurfacePort wait/cancel/sendSignal/wake | `ports/surface.ts` + mediation-surface |
| dispatch surface | maps `parkIntent` |

App does not import openworkflow. Wake kind literal `"wake"` matches `ENGAGEMENT_WAKE_KIND`.

---

## Runtime scenarios (proper product-door tests)

`test/runtime/life-runtime-scenarios.test.ts` — mock mind, real OW worker + sqlite.

| ID | Scenario | Pass |
|----|----------|------|
| R1 | Hosted settle Mediation | ✔ |
| R2+R3 | Park wait + Mediation.wake Settled | ✔ |
| R4 | Wake recipe + wait | ✔ |
| R5 | SurfacePort continuum | ✔ |
| R6 / R6b | Cancel pending / while parked | ✔ |
| R7 | Fail-closed packs | ✔ |
| R8 | Resume sessionRef | ✔ |
| R9 | Local engageLocal | ✔ |
| R10 | Local park + reenter | ✔ |
| R11 | runPlan two nodes | ✔ |
| R12+R13 | File db settle + park/wake join durable | ✔ |
| R14 | Re-park via wake then settle | ✔ |
| R15 | No-runtime control throws | ✔ |
| recipe dispatch wait | ✔ |

```bash
npm run check
# optional focused:
node --experimental-strip-types --test test/runtime/life-runtime-scenarios.test.ts
```

**Tip:** record after merge.

---

## Still out of default wall

- Live Pi / LLM  
- Multi-process worker  
- Runtime CLI (S1)  
