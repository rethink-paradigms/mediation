# Evidence — ABS-B3 (Recipes package)

**Package:** `@company/mediation`  
**Branch:** `slice/ABS-B3-recipes`  
**Date:** 2026-07-18  
**Law:** D0 P6 — experiences are thin recipes on the core, not alternate monocoques  

---

## 1. Artifacts

| Path | Role |
|------|------|
| `src/app/recipes/types.ts` | `Recipe<I,O>` + `RecipeContext` (`{ mediation }`) |
| `src/app/recipes/solo.ts` | Recipe A → `mediation.engageLocal` |
| `src/app/recipes/reenter.ts` | Recipe E → `mediation.reenter` |
| `src/app/recipes/dispatch.ts` | Recipe B → `mediation.dispatch` (+ optional `wait`) |
| `src/app/recipes/plan.ts` | Recipe C → `mediation.runPlan` (runtime required) |
| `src/app/recipes/index.ts` | barrel re-exports |
| `src/app/mediation.ts` | minimal `runPlan(plan)` façade (mirrors `dispatch`) |
| `src/index.ts` | append-only recipe exports |
| `test/recipes/recipes.test.ts` | mock Mediation + mock RuntimePort proofs |
| `EVIDENCE-ABS-B3.md` | this packet |

**Layer:** app recipes import Mediation + ports types only. No pi / OW / second monocoque.

**Not touched:** CLI, SurfacePort, openworkflow host rewrite, domain capability, no merge to main.

---

## 2. Recipe surface

```ts
interface Recipe<I, O> {
  readonly name: string;
  run(ctx: { mediation: Mediation }, input: I): Promise<O>;
}

solo     → engageLocal
reenter  → reenter
dispatch → dispatch (+ optional wait → status)
plan     → runPlan if RuntimePort present (else throw)
```

---

## 3. Proofs

| Case | Result |
|------|--------|
| Recipe shape name + run(ctx, input) | pass |
| solo → engageLocal Settled (MockEngine) | pass |
| reenter → pack gate match, same sessionRef | pass |
| dispatch without wait → handle only | pass |
| dispatch + wait → completed status | pass |
| dispatch without runtime throws | pass |
| plan → runPlan when runtime present | pass |
| plan without runtime throws | pass |
| `layer_import_violations=0` | pass |
| `second_door_count=0` | pass |
| `solo` / `reenter` / `dispatch` / `plan` / `Recipe` on public export surface | pass |

---

## 4. Check

```bash
npm run check
```

**Result:** exit 0  

- typecheck: clean  
- tests: 171 pass (includes ABS-B3 recipes suite)  
- gauges: OK (`layer_import_violations=0`, `second_door_count=0`, `spawn_public_export_count=0`)

---

## 5. Git

```text
0dbeaef ABS-B3: record evidence tip SHA and check surface on recipes branch.
e03ca58 ABS-B3: recipes package (solo, reenter, dispatch, plan) as thin Mediation wrappers.
09684e7 Merge branch 'slice/ABS-A7-factory-capability'.
```

**Tip:** `e03ca5876eb43bc0e070de74cdfb1211c7ba03bf`  
**Branch only:** `slice/ABS-B3-recipes` — no checkout/switch, no merge main.
