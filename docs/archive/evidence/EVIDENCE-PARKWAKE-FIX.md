# EVIDENCE-PARKWAKE-FIX — park→wake bridge on any known transcript tail (phase 2)

**Slice:** slice/phase2-parkwake · **Worktree:** /tmp/wt-parkwake · **Date:** 2026-08-08
**Bug (strongest product blocker, H4b/H6b):** after a settled park the transcript ends
with an assistant message; Pi's loop-resume `agent.continue()` is illegal there
("Cannot continue from message role: assistant"). Mock hid it by accepting any resume.

**Fix (D2 shape):** `EngineSessionHandleBase` wake path — when a bridge (wake payload)
is present AND the transcript is known (non-empty), append the bridge as a **user
message** and run (`agent.prompt`-style full loop — the legal engine path for "human
said something later"). Applies to ANY known tail (assistant, user, toolResult): D2
says the bridge is appended to the parked context unconditionally, so a bare
loop-resume must never silently drop the wake payload. Unknown/empty transcripts keep
the bare engine verb (fail-closed, inMemory "No messages to continue from").

**Files:** src/adapters/shared/engine-session-handle.ts (wake/continue bridge logic);
test/runtime/park-wake-regression.test.ts (+28: bridge-on-assistant, bridge-on-user,
bridge-on-toolResult, empty-transcript fail-closed, no-bridge bare continue preserved).

**Test matrix:** park-wake-regression 7/7 pass; parent re-ran with bounded
--test-timeout=120000. Slice's own `npm run check` passed (exit 0) before the child
stalled; full gate re-run on integrated main done by parent.

**Coordination:** change confined to the shared session handle (pi + prime both wrap
it) — no app/mediation.ts edits, no park-bridge.ts edits; clean 3-way merge expected.
