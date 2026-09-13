# Agents — @company/mediation

This package is the sole **Agent Presence** monocoque. Treat tooling as the compiler.

## Before every commit

```bash
npm run check
```

`check` = typecheck && test && gauges. Non-zero exit means do not commit.

## Git

- **Repo root:** this package only (`company/product/mediation-engine/mediation/`). Do not `git init` parent `company/` or research trees.
- **Branches:** `slice/S2b-short-description` (example: `slice/S2b-pi-engine-adapter`).
- **Main:** no force-push; no history rewrite of accepted baselines.
- **Commits:** complete sentences; mention slice id and which gauges/tests prove the change.
- **Worktrees:** not required yet — ordinary branches are enough for sequential slices. Parallel worktrees may land later.

## Evidence

Slice evidence packets live in package root:

- `EVIDENCE-S0.md`, `EVIDENCE-S1.md`, `EVIDENCE-S2.md`, `EVIDENCE-S0g.md`, …

After a slice lands, leave `git status` clean and record `git log --oneline` + `npm run check` in the evidence file.

## Fail-fast law

Architectural gauges are gates, not dashboards:

- `layer_import_violations !== 0` → process fails
- `second_door_count !== 0` → process fails

See `TOOLING.md` for the agent feedback surface.
