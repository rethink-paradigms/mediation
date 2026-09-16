# TESTING DOCTRINE — real-world intent testing (binding)

The gate (`npm run check`) proves the code *typechecks, lints, and does not
violate architecture gauges*. It does NOT prove the product works. This
doctrine governs how every slice proves its intent.

## Why this exists

A model that writes code and then writes the tests tends to adjust the tests
so its code passes. That is green-washing: the number goes to 100 and the
intent goes untested. A test plan exists to REVIEW what was coded, surface
issues, and cover scenarios that occur in real life — NOT to be trimmed so
the first run shows 100%.

Rules:
1. **Intent first, scenario first.** Before code, the slice writes a SCENARIO
   SUITE: concrete real-world situations the feature must survive. Scenarios
   come from the design intent (and from a scenario-designer sub-agent when
   useful), not from the implementation.
2. **Never delete or weaken a scenario to make code pass.** If a scenario
   exposes a defect, the defect is real: fix the code or explicitly document
   why the scenario is wrong (evidence + reviewer sign-off).
3. **Every bug fix ships a regression scenario** that FAILS on the pre-fix
   code and PASSES after. A fix with no failing-before test is incomplete.
4. **Engine-touching behavior gets a gated live scenario** (MEDIATION_LIVE_PI=1
   / MEDIATION_LIVE_PRIME=1) in addition to unit scenarios. The mock engine
   must never be the sole proof for a path that runs on a real engine (the
   park→wake continue bug was masked by mock-green).
5. **Test counts are observational, not objectives.** A slice that adds real
   scenarios and shows 90% pass with 5 honest failures-in-progress is closer
   to done than one that shows 100% after trimming.
6. **Scenarios live with the code** (`test/<slice>/scenarios/` or
   `scenario_harness/scenarios/`) and are run by the normal gate unless
   gated live.

## Blockers, not stalls

If something is genuinely difficult, obscure, or architecturally blocking:
1. File a GitHub issue on https://github.com/rethink-paradigms/mediation
   (`gh issue create --title "..." --body "...what, why blocked, what tried"`).
2. Append the same entry to `ISSUES-LOG.md`.
3. CARRY ON: complete everything else in the slice, ship it green, and leave
   the issue OPEN with a pointer to what remains.

A slice that finishes everything except a filed blocker is DONE and honest.
A slice that silently reshapes tests until green is FAILED.
