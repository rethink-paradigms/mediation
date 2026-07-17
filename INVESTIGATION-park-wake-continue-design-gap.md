# Investigation: Park/wake continue design gap (real Pi)

**Date:** 2026-07-18  
**Kind:** Design investigation only (no product fix)  
**Scope:** Why default park → wake / reenter with `mode: "continue"` fails under real Pi after a full settled idle park  
**Tip SHA at reconfirm:** `a2b6725ad5fbc87e11d84be9f9fba697798693ad`  
**Pi:** `@earendil-works/pi-coding-agent@0.80.10` / `@earendil-works/pi-agent-core@0.80.10`

---

## Executive summary

The failure is **not** OpenWorkflow wait/wake, and not file-session resume. After a full `parkIntent` engage the transcript ends with **role `assistant`**. Product language “continue after park” was bound 1:1 to Pi’s **`agent.continue()`**, which is a *loop-resume* API legal only when the last message is **user or tool-result** (not assistant). D1/D2 already specified a **bridge step** (append whatWasAwaited + payload, then engage) and left bridge schema open; implementation **skipped the bridge**, defaults wake/reenter to `"continue"`, and in continue mode **drops `payloadText`**. MockEngine treats `continue()` as “emit idle” with no role guard, so LIFE R2/R3 stayed green. Live H4b reconfirms: file resume succeeds, then Pi throws `Cannot continue from message role: assistant`. Root design gap: **product continuum (“continue engagement”) was confused with Pi’s `session.agent.continue()`**, and the deferred bridge was never treated as a hard precondition of the continue verb.

---

## Expected (by our decisions / Model P / D1)

### D1 — Presence operations contract

Engage input includes modes:

```
mode?: "prompt" | "continue"
```

**Continue after Parked (normative shape, detail open):**

1. External response arrives.
2. Same `sessionRef` is used (`materialize` resume or still-held Presence).
3. Context is extended with **wait contract + response** (bridge message(s) — exact wording later).
4. `engage(..., mode: "continue" | prompt with payload)` → next RunOutcome.

Explicit: this is **context-array continue**, not process thaw.  
Explicit open detail (§8): *Exact bridge message schema for Parked continue* deferred.

Status machine: `idle → parked → (continue) → idle | engaging`.

G1c gate: *Parked path: engage returns Parked; process gone; continue engage with payload → Settled or next Parked*.

### D2 — Tier-2 defaults

| Topic | Default |
|-------|---------|
| Parked continue | **Append whatWasAwaited + payload; engage continue** |
| Live short-chat interrupt | May use interrupt without Parked if engagement never released |
| Notify | Delivery via interrupt or continue-engage interface |

### Understanding / Model P (tier map)

On wake:

1. Runtime/join marks wake payload available.
2. `materialize(resume)` if no handle.
3. Append **continue bundle** into context: `{ whatWasAwaited, payload }`.
4. `engage(mode: continue | prompt)`.

“Antigravity-shaped bridge” is the default *cognition* pattern; exact prose open, **shape is not optional**.

Agent-presence recipe sketch (older) also mixes interrupt delivery + `engage(continue|empty)` while handle may still be live — a different process model than dispose-after-leaf.

### What “continue” meant in product law

- **Continue the engagement story** after external truth arrives.
- Same cognitive artifact (`sessionRef`).
- Context grows with wait-contract + response.
- Then another engage slice runs to Settled | Parked | Failed.

It did **not** normatively require the engine verb to be “no new user message.” D1 even allows `prompt with payload` as an alternate form of step 4.

---

## Implemented (code path defaults)

### End-to-end path (H4b)

```
dispatch(parkIntent: true)
  → runEngagementArc
    → step leaf: runEngagementLeaf
         materialize (new file session)
         join.put engaging
         engage({ text: task, parkIntent: true })   // mode unset → presence defaults "prompt"
         handle.prompt(task) → model → assistant final
         idle → Parked (policy park_intent)
         finally: presence.dispose()
    → waitForSignal(wake)
    → client mediation.wake(runId, { payloadText })  // mode omitted
    → parseWakeSignalData → mode "continue"
    → continue leaf: runEngagementLeaf
         materialize({ resume: sessionRef })         // file open OK
         engage({ text: payloadText, mode: "continue" })
         handle.continue() → agent.continue()
         Pi: last role assistant → throw
         → RunOutcome Failed ENGAGE_FAILED
         dispose
  → OW run completes with result.kind "failed"
```

OW wait/wake **succeeds**. Failure is entirely on the second leaf’s Pi engage.

### Defaults that select Pi `continue()`

| Site | Default | File |
|------|---------|------|
| Wake signal parse | `mode` missing → `"continue"` | `src/adapters/openworkflow/signals.ts` |
| Arc after park | `engageMode: wake.mode ?? "continue"` | `src/adapters/openworkflow/workflows/engagement-arc.ts` |
| Reenter | `mode: input.mode ?? "continue"` | `src/app/mediation.ts` |
| Presence engage | `mode ?? "prompt"` (first cold engage OK) | `src/app/presence.ts` |

### Continue mode drops payload

```107:112:src/app/presence.ts
      const mode = input.mode ?? "prompt";
      if (mode === "continue") {
        await this.handle.continue();
      } else {
        await this.handle.prompt(input.text, input.images);
      }
```

When `mode === "continue"`, **`input.text` / wake `payloadText` is never sent to the engine**. Arc still passes `task: wake.payloadText` into the leaf — dead for continue mode.

No code path:

- appends wait-contract / bridge messages into the Pi transcript,
- injects tool-result-shaped messages for a wait tool,
- or chooses engine verb from last message role.

### Leaf lifecycle

`runEngagementLeaf` always `dispose()`s presence in `finally`. Park therefore implies:

- handle is gone,
- next turn must rematerialize from `sessionRef`,
- live-only Pi APIs (`steer` / mid-stream `followUp` on the same process session) are **not** available across the park boundary unless the handle was retained (it is not).

### Session durability (`create-session.ts`)

- Default `inMemorySession` true unless `req.settings.inMemory === false` or adapter opts force file.
- Resume: if path exists → `SessionManager.open`; if inMemory and path missing → **new empty inMemory** + warn `resume path missing; inMemory session`.
- File sessions yield durable `.jsonl` `sessionRef`; inMemory yields id that cannot rehydrate transcript.

This matches H6b: reenter continue after inMemory park → empty history → `No messages to continue from` (and often a new sessionRef).

### Proven workarounds (live)

- File session + wake/reenter `mode: "prompt"` → Settled, same sessionRef (H4, H6).
- That path is effectively “next user turn with payload as prompt text,” which **is** a legal Pi continuum — and accidentally implements D1 step 4’s “prompt with payload” branch without an explicit bridge schema.

---

## Pi actual semantics (with file/path citations)

### Source of truth: `Agent.continue()` (pi-agent-core 0.80.10)

```226:248:node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent.js
    /** Continue from the current transcript. The last message must be a user or tool-result message. */
    async continue() {
        if (this.activeRun) {
            throw new Error("Agent is already processing. Wait for completion before continuing.");
        }
        const lastMessage = this._state.messages[this._state.messages.length - 1];
        if (!lastMessage) {
            throw new Error("No messages to continue from");
        }
        if (lastMessage.role === "assistant") {
            const queuedSteering = this.steeringQueue.drain();
            if (queuedSteering.length > 0) {
                await this.runPromptMessages(queuedSteering, { skipInitialSteeringPoll: true });
                return;
            }
            const queuedFollowUps = this.followUpQueue.drain();
            if (queuedFollowUps.length > 0) {
                await this.runPromptMessages(queuedFollowUps);
                return;
            }
            throw new Error("Cannot continue from message role: assistant");
        }
        await this.runContinuation();
    }
```

Typed surface (`agent.d.ts`): *“Continue from the current transcript. The last message must be a user or tool-result message.”*

### Agent-loop guard (same rule)

```19:33:node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js
/**
 * Continue an agent loop from the current context without adding a new message.
 * Used for retries - context already has user message or tool results.
 *
 * **Important:** The last message in context must convert to a `user` or `toolResult` message
 * via `convertToLlm`. If it doesn't, the LLM provider will reject the request.
 */
export function agentLoopContinue(context, config, signal, streamFn) {
    if (context.messages.length === 0) {
        throw new Error("Cannot continue: no messages in context");
    }
    if (context.messages[context.messages.length - 1].role === "assistant") {
        throw new Error("Cannot continue from message role: assistant");
    }
    // ...
}
```

### What Pi `continue` is for

| Legal last role | Meaning |
|-----------------|---------|
| `user` | User message already in context; run assistant without appending another user turn |
| `toolResult` (or non-assistant) | Tool results pending; resume model after tools |
| empty | Illegal → `No messages to continue from` |
| `assistant` | Illegal unless **queued steer/followUp** can be drained into a new prompt run |

Pi coding-agent itself uses `agent.continue()` after post-run handling (retry / compaction / queued follow-ups) inside `_runAgentPrompt` — not as “resume a finished chat after human wake.” Vendor comment in compaction path:

> *“the assistant answer already completed and agent.continue() cannot continue from an assistant message.”*  
> (`pi-coding-agent/dist/core/agent-session.js` ~1533–1534)

### What Pi `prompt` is for

`session.prompt(text)` appends a **user** message and runs the full agent loop to settlement. After a normal completed turn, **last role is assistant**. The correct “human said something later” API is almost always **`prompt`**, not `continue`.

### Mid-turn delivery vs wall-clock park

| Pi API | When | Survives dispose + rematerialize? |
|--------|------|-----------------------------------|
| `steer` | Mid-run | No (queue is process state) |
| `followUp` | Mid-run / until drained | No (queue is process state) |
| `prompt` | Idle session | Yes if session file/transcript restored |
| `agent.continue` | Idle, last ≠ assistant | Yes if transcript restored **and** last role legal |

Across Model P park (dispose handle, OW wait, later resume), **only transcript-backed prompt (or transcript mutation + continue)** works. Queues are not continuum.

### Session file vs in-memory

- File (`SessionManager.create` / `open`): durable JSONL; rematerialize restores messages → last role still assistant after settled park.
- In-memory: no durable path; mediation resume falls back to empty inMemory → continue fails with **no messages**.

---

## OW actual role (innocent or not)

**Innocent of the Pi continue failure.**

Evidence:

1. H4b: after wake, OW run reaches `state: "completed"` with a **failed leaf result** — waitForSignal delivered, continue step ran.
2. File resume logs `Session resumed { path: …jsonl }` before the continue error — rematerialize succeeded.
3. Error string is pure pi-agent-core, not OW.
4. H4 with same OW path but `mode: "prompt"` Settles — same arc, different engage verb.

OW’s role is correctly: park leaf → wait → deliver signal → next leaf. It does not invent last-message roles. The only OW-adjacent issue is **product defaulting** of wake mode inside arc/signals (`"continue"`), which is mediation policy layered *on* OW, not OW misbehavior.

---

## Gap analysis: where design was wrong or incomplete

### 1. Language collapse (primary)

| Layer | “Continue” meant |
|-------|------------------|
| Product / Model P | Continue the **engagement** after external truth |
| D1 mode enum | `"prompt" \| "continue"` as engage *modes* |
| Implementation | `handle.continue()` → **Pi `agent.continue()`** |

Product continuum was bound to a Pi API that is the **opposite** of “agent finished speaking; human/system adds payload.”

### 2. Deferred bridge treated as optional forever

D1/D2 required **append whatWasAwaited + payload** before continue. Implementation never added that step. With no bridge:

- last role remains assistant after full idle park,
- Pi continue is definitionally illegal,
- payloadText is unused in continue mode.

So even if defaults stayed `"continue"`, **without bridge the verb cannot work** after settled park.

### 3. `parkIntent` stand-in does not leave a continue-ready transcript

Today park is: run a full **prompt** turn → assistant settles → return Parked. There is no wait-tool toolResult left as last message. True wait-tool park might leave toolResult last (continue legal); explicit parkIntent after idle **does not**.

### 4. Research map misstated Pi continue (fed the bug)

`understanding/pi-sdk-feature-map.md`:

> `agent.continue()` … Effect: **resumes from last assistant message** without new user input.

Pi source: **cannot** continue from last assistant message. This is an understanding error in our own research, not merely an implementation slip.

### 5. Mock contract weaker than Pi

Mock `continue()` schedules idle with no role checks and no message list — continuum always “works.”

### 6. inMemory continuum assumed without durability design

Ops/default inMemory + continuum expectations conflict. D2 says multi-day park = session commit; file is required for rehydrate. Implementation defaults inMemory true; continuum without file is structurally impossible.

### 7. Asymmetry of defaults

- Cold engage: presence defaults **prompt** (correct for new task).
- Wake / reenter after park: default **continue** (incorrect for post-assistant transcript).

That asymmetry encodes the product story “park is special, continue resumes” without mapping to Pi’s actual continue precondition.

### Classification answer (investigation Q7)

| Hypothesis | Verdict |
|------------|---------|
| Pi misunderstanding | **Yes** — continue ≠ resume-after-idle-assistant; research map inverted |
| OW misunderstanding | **No** — wait/wake fine |
| Product-language confusion (continue vs prompt) | **Yes** — primary binding error |
| Incomplete Model P (missing bridge before continue) | **Yes** — open detail never closed; code skipped it |

All three of: language confusion + missing bridge + mock blind spot. Not monocoque/resolver issues.

---

## Why mock continuum lied

`MockEngineSessionHandle.continue()`:

- marks busy, emits raw `"continue"`, schedules idle `continue_complete`,
- **no** transcript, **no** last-role guard, **no** payload requirement.

LIFE R2/R3 (`life-runtime-scenarios.test.ts`) use mock hosted mediation with `mode: "continue"` and assert Settled + same sessionRef. That proves **arc/join/signal plumbing**, not Pi continuum fidelity.

Live health correctly encoded H4b/H6b as *documented failure* assertions so the suite stays green while recording the real-mind gap.

---

## Language confusion map

| Product word | We mapped to | Pi means | Better mapping |
|--------------|--------------|----------|----------------|
| continue after park (Model P) | `engageMode: "continue"` → `agent.continue()` | Resume loop **without** new user msg; last must be user/toolResult | **Bridge + prompt**, or bridge user/tool msgs then `agent.continue()` |
| `EngageInput.mode: "continue"` | bare `handle.continue()`; **drop text** | Same as above | Either rename, or implement as “apply bridge then engine-continue if legal else prompt” |
| `EngageInput.mode: "prompt"` | `session.prompt(text)` | New user turn + full loop | Correct for “payload is next human/system utterance” |
| wake `payloadText` | leaf `task` → engage `text` | (only used if prompt) | Always part of bridge/user turn |
| interrupt steer/followUp | available on live handle only | Mid-run queues | Not a substitute for multi-day Parked continuum after dispose |
| session continue (CLI `-c`) | confused with agent.continue | **Open most recent session file** | SessionManager resume ≠ agent.continue |
| reenter | default mode continue | Rematerialize + next turn | Default should match post-park transcript reality (usually prompt/bridge) |
| “context-array continue” (D1) | assumed = Pi continue API | Grow messages then run model | Literal: mutate context, then choose legal run entrypoint |

---

## Design options (no implement) — ranked by fidelity to D1

### Option A — Implement deferred bridge, keep product word “continue” (highest D1 fidelity)

On wake/reenter after Parked:

1. `materialize(resume)`.
2. Append bridge messages into session (whatWasAwaited + payload) so last role is **user** (or toolResult if wait-tool shaped).
3. `engage(mode: "continue")` → Pi `agent.continue()` now legal.
4. Or: bridge as user message via `prompt(bridgeText)` and treat that as the engage (D1 allows prompt-with-payload).

**Pros:** Matches D1/D2 law; payload not dropped; true “context-array continue.”  
**Cons:** Must freeze bridge schema; need session mutation API or always use prompt as the bridge carrier; wait-tool vs parkIntent may need different bridge shapes.

### Option B — Default post-park engage to `prompt`; reserve `continue` for engine-legal cases (highest ops pragmatism; still D1-legal)

- Arc/reenter default: `"prompt"` after park (payload = user turn).
- Keep `mode: "continue"` only when caller knows last role is user/toolResult (tool-result resume, incomplete turn).
- Optional adapter: if mode continue and last role assistant → fail closed with clear error, or auto-fallback to prompt (policy choice).

**Pros:** Matches live H4/H6 success path; minimal new concepts; D1 already lists prompt-with-payload.  
**Cons:** Product default word shifts from D2 table’s “engage continue”; still no Antigravity bridge prose unless layered in prompt text.

### Option C — Role-aware engine adapter (auto map)

`EngineSessionHandle.continue()` or presence engage inspects last role:

- assistant → `prompt(text)` (or inject bridge then continue),
- user/toolResult → `agent.continue()`,
- empty → fail closed.

**Pros:** Call sites keep saying “continue engagement.”  
**Cons:** Hides engine semantics; payload policy still required; harder to test without real transcript; risks silent behavior change.

### Option D — True wait-tool park leaves continue-ready last message

Park only via tool that ends with toolResult pending / structured wait message; then Pi continue is natural.

**Pros:** Aligns with Pi’s intended continue use.  
**Cons:** Does not fix today’s `parkIntent` after full assistant idle; tool schema not landed; multi-day still needs payload injection somehow (toolResult content or following user msg).

### Option E — Retain handle across park (interrupt delivery)

Same-process: don’t dispose; deliver via followUp/steer; no rematerialize.

**Pros:** Matches live short-chat D2 interrupt path.  
**Cons:** Breaks multi-day / worker recycle Model P; not the durable park story.

**Ranking by fidelity to written D1/D2:** A ≥ B > C > D > E  
(A is the letter of the law; B is the already-proven half of D1 step 4.)

---

## What we should have understood earlier

1. **Pi `continue` is not “resume session after idle.”** It is “run the loop again from a non-assistant tail (user/toolResult), typically retries/tools.”
2. **After a completed assistant turn, the only universal next step is a new user message (`prompt`) or an injected non-assistant message + continue.**
3. **D1’s open “bridge schema” was a load-bearing precondition**, not cosmetic copy. Shipping continue defaults without bridge guaranteed failure under real mind after settled park.
4. **Mock continuum cannot certify engine verbs.** LIFE green ≠ Pi green for role-sensitive APIs.
5. **Our research map inverted continue semantics** (“from last assistant”) — that should have been caught against pi-agent-core before binding product defaults.
6. **Dispose-after-leaf** makes steer/followUp irrelevant to park continuum; only session transcript matters.
7. **inMemorySession and continuum are mutually exclusive** by construction; continuum ops require file (or another durable transcript medium).
8. Live H4 already proved the workable continuum: **file + prompt**. That is evidence for Option B/A, not a hack outside the model.

---

## Non-goals of this investigation

- Implementing continuum fix or changing product defaults in code.
- Redesigning monocoque / CapabilityResolver / D0.
- Opening fix PRs or rewriting engagement-arc beyond notes.
- Full multi-day process-restart soak or wait-tool schema freeze.
- Litigating OW park signal buffering / cancel-while-parked.
- Choosing final bridge prose (still open under D1 §8 / D2).

---

## Evidence / commands / SHAs

### Artifacts

| Path | Role |
|------|------|
| `HEALTH-REPORT-LIVE-PI.md` | Live matrix; H4b/H6b diagnosis |
| `EVIDENCE-LIVE-HEALTH.md` | Compact 13/13 live band |
| `test/runtime/live-life-health.test.ts` | H4, H4b, H6, H6b |
| `test/runtime/life-runtime-scenarios.test.ts` | Mock R2/R3 continuum |
| `src/adapters/openworkflow/workflows/engagement-arc.ts` | `wake.mode ?? "continue"` |
| `src/adapters/openworkflow/signals.ts` | parse default continue |
| `src/app/presence.ts` | continue drops text; prompt path |
| `src/app/mediation.ts` | reenter `mode ?? "continue"` |
| `src/adapters/pi/session-handle.ts` | maps to `session.agent.continue` |
| `src/adapters/pi/create-session.ts` | inMemory vs file resume |
| `src/adapters/mock/engine-adapter.ts` | permissive continue |
| Research `decisions/D1-…`, `D2-…` | normative continuum + bridge |
| Research `understanding/pi-sdk-feature-map.md` | inverted continue description |
| pi-agent-core `dist/agent.js` / `agent-loop.js` | hard role guards |

### Commands

```bash
# Reconfirmed 2026-07-18 — pass documents failure
cd company/platform/mediation
MEDIATION_LIVE_PI=1 MEDIATION_LIVE_MODEL=deepseek/deepseek-v4-flash \
  node --experimental-strip-types --test --test-name-pattern 'H4b' \
  test/runtime/live-life-health.test.ts
```

Observed (excerpt):

- First leaf: file session created under agent `sessions/*.jsonl`
- Second leaf: `Session resumed { path: …jsonl }`
- Result: `kind: "failed"`, `code: "ENGAGE_FAILED"`,  
  `message: "Cannot continue from message role: assistant"`
- OW `state: "completed"` (run finished; leaf failed)

### Versions

| Item | Value |
|------|--------|
| Mediation tip | `a2b6725ad5fbc87e11d84be9f9fba697798693ad` |
| pi-coding-agent | 0.80.10 |
| pi-agent-core | 0.80.10 |
| Model (live) | `deepseek/deepseek-v4-flash` |
| Auth | `~/.pi/agent/auth.json` present |

---

## Bottom line for leads

Default park→wake continuum fails because we bound **engagement continue** to **Pi agent.continue** after an assistant-final idle, **without** the D1 bridge that would make that API legal (or without choosing D1’s alternate: prompt-with-payload). OW is not the defect. Mock could not see the defect. Correct design specifies bridge-or-prompt as mandatory continuum machinery; it does not treat Pi continue as a synonym for “wake the agent.”
