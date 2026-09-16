# EVIDENCE-PARK-WAKE-FIX — park→wake continue on real Pi (issue #1)

**Slice:** LIFE-FIX park-wake bridge · **Date:** 2026-08-07 · **Issue:** github.com/rethink-paradigms/mediation#1
**Parent verify:** gate re-run + gated live run executed by lead after sub-agent's live run was interrupted.

## Root cause (from INVESTIGATION-park-wake-continue-design-gap.md, H4b)

D1 + software-architecture §4.3 specify a **ParkBridge**: on wake, append
`whatWasAwaited` + payload as a user message, THEN engage continue. The
implementation skipped the bridge: arc passed raw `payloadText`, the shared
handle called `session.continue()` with no payload, and Pi rejects
`continue` when the last message role is `assistant` ("Cannot continue from
message role: assistant"). Mock engine has no role guard → mock-green masked
the production defect.

## Fix

- `src/domain/park-bridge.ts` (NEW): pure `ParkBridge.build(waitContract,
  payload)` → bridge message (whatWasAwaited + payload; neutral prose
  fallbacks for empty parts). Fully unit-tested.
- `src/app/mediation.ts`: wake/reenter route through the bridge (mode
  `continue` default → bridge message → engage prompt-with-bridge so the
  session sees a user turn, not an illegal continue).
- `src/adapters/openworkflow/signals.ts`: wake payload parsing carries
  wait-contract context into the bridge.
- `src/adapters/openworkflow/workflows/engagement-arc.ts`: continue leaf
  builds the bridge via ParkBridge before the next engage.
- `src/adapters/shared/engine-session-handle.ts`: continue() path made
  payload-honest; Pi + Prime parity kept.
- `test/runtime/live-life-health.test.ts`: H4b expectation FLIPPED from
  "wake default continue fails on real Pi" → "wake default continue →
  Settled same sessionRef (bridge)" — the honest regression marker.

## Scenario suite (TESTING-DOCTRINE)

- `test/runtime/park-bridge.test.ts` — bridge content: whatWasAwaited +
  payload present; empty-payload and empty-contract fallbacks.
- `test/runtime/park-wake-regression.test.ts` — role-guard fake session
  (enforces Pi's continue-after-assistant rule): wake default continue
  FAILS pre-fix, PASSES post-fix; re-park loop; prompt-mode wake.
- `test/runtime/live-park-wake-pi.test.ts` (gated MEDIATION_LIVE_PI=1):
  L-W1 hosted parkIntent → wake default continue → Settled same sessionRef;
  L-W2 local park → reenter default continue → Settled same sessionRef.

## Results

- `npm run check` GREEN at slice isolation: 320 pass / 0 fail / 3 skipped
  (pre sibling tests); full-tree re-run by lead: 383 pass / 0 fail / 2 skip.
- **Gated live on real Pi (deepseek/deepseek-v4-flash), run by lead:
  2/2 PASS** — L-W1 (hosted arc, 3.2s) and L-W2 (local reenter, 1.6s), both
  Settled on the SAME sessionRef. Park→wake→continue continuum now works on
  a real engine, not just mock.

## Not touched

adapters/pi internals, adapters/prime/**, domain/engine.ts, engine-registry,
capability/**, compose.ts, wiring.ts, cli.ts, ports/surface.ts, package.json.

## Commit

`<filled at commit>` — see `git log -1 --format='%h %s'`.
