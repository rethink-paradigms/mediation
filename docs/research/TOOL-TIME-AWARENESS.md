# TOOL TIME-AWARENESS — how a tool can hold the agent loop, and how to guarantee it never does

> Research report (read-only). No source changed. Companion to the human discussion:
> *"agents get stuck on COMMANDS (blocking tool calls) with NO AWARENESS OF TIME and no way to come out.
> If they fall into a pit (e.g. a hung command), they only come back when something times out."*
>
> Scope: the prime-agent fork (`/opt/homebrew/lib/node_modules/prime-agent`, v0.7.0, the package this
> session runs on) + `company/` (toolkit, extensions, mediation, openworkflow).
> Date: 2026-08-xx. Author: research sub-agent.

---

## TL;DR

- **A tool can hold the loop today, forever, with no timeout anywhere in the chain.** The fork's agent
  loop awaits `tool.execute(...)` wrapped only in `raceWithAbort(promise, signal)` — an AbortSignal race,
  **not a timeout race**. The bash tool's `timeout` param is *optional* ("no default timeout"). Mediation
  has interrupt/cancel primitives but **no clock**: nothing watches for a stuck run. The gate's tests used
  to run with `--test-timeout=0` (no per-test deadline; parent changed to 120000) — same systemic shape:
  no timeout anywhere = no escape anywhere.
- **The user's existing Pi system already solved this by design**: every toolkit tool auto-escalates to
  background after **3s** (`Promise.race` against `timeoutMs ?? 3000`), so the agent loop *never* blocks
  longer than 3s on any tool; results come back as `task-notifier` notifications. The fork's built-in
  tools are NOT covered by that pattern (the pattern lives in company extensions + toolkit, applied to
  bash/grep/ls/find and toolkit-defined tools only).
- **Guarantee options, smallest → most systemic**: (1) default timeout on fork bash/exec tools,
  (2) per-tool timeout in the fork's `executePreparedToolCall` (race execute vs signal + timeout),
  (3) per-turn deadline that aborts the turn signal, (4) mediation live-turn watchdog that auto-`abort()`
  stale runs, (5) port the user's 3s auto-escalate-to-background pattern onto the fork's built-ins.

---

## (a) How a tool CAN hold the loop today — concrete code path

All line refs are to the installed fork `/opt/homebrew/lib/node_modules/prime-agent/dist/`.

### The loop

`bundle/chunk-ALQBG3TN.js` (the bundled `@earendil-works/pi-agent-core`) contains the canonical loop:

```
runLoop → while(true):
    inner while (hasMoreToolCalls || pendingMessages.length > 0):
        message = await streamAssistantResponse(...)          // LLM call
        toolCalls = message.content.filter(c => c.type === "toolCall")
        if (toolCalls.length > 0):
            executedToolBatch = await executeToolCalls(...)   // ← the hold point
            hasMoreToolCalls = !executedToolBatch.terminate
            ...
        steering = pollMessagesUnlessAborted(config.getSteeringMessages, signal)  // ← AFTER tools resolve
```

`executeToolCalls` fans out to **parallel by default**:

```
executeToolCallsParallel:
    for each toolCall:
        preparation = await prepareToolCall(...)              // beforeToolCall hook
        finalizedCalls.push(async () => {
            executed = await executePreparedToolCall(preparation, signal, emit)   // ← await tool.execute
            ...
        })
    orderedFinalizedCalls = await Promise.all(finalizedCalls.map(f => f()))        // ← hangs here
```

and the per-tool await is **signal-only**:

```
executePreparedToolCall(prepared, signal, emit):
    result = await raceWithAbort(
        prepared.tool.execute(prepared.toolCall.id, prepared.args, signal, onUpdate),
        signal
    )
```

`raceWithAbort(operation, signal, onAbort)` is exactly what it says: it listens for `signal`'s `"abort"`
event and otherwise resolves/rejects with the operation. **There is no timeout branch.** If
`tool.execute(...)` never settles and nobody aborts the signal, `Promise.all` never settles, the inner
`while` never exits, and the turn never ends. Sequential mode (`config.toolExecution === "sequential"`
or any tool with `executionMode: "sequential"`) holds the same way in a plain `for` loop.

### The tools that can hang

- **bash** (`core/tools/bash.js`):
  - Schema: `timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }))` — **no default**; the model must remember to pass it.
  - `ops.exec(command, cwd, { onData, signal, timeout, env })` spawns a shell child and, when no timeout is given, just `waitForChildProcess(child)` — a hung command (`sleep 10000`, an interactive prompt, `find /` on a huge tree, a server that never exits) waits forever.
  - When a timeout IS passed: `setTimeout → killProcessTree(pid)` then rejects `timeout:<secs>`; on abort signal it also kills the process tree and rejects `"aborted"`. So the kill machinery exists — it's just not defaulted on.
- **ipython** (`core/tools/ipython.js`): a kernel cell that never returns holds execute; escape is kernel interrupt → kill-and-restart, which is a *human* Ctrl+C flow in interactive mode (the BUSY_KERNEL_PROMPT "Wait and preserve state" / "Kill kernel and restart" choice).
- **Any network/foreign tool** (web search, fetch, MCP): if the handler doesn't impose its own timeout, the loop waits forever.
- **Extension API `pi.exec`** (`core/exec.js`): `execCommand` supports `options.timeout` + `signal` (SIGTERM → SIGKILL after 5s) — again, **only when the caller passes them**.

### What unblocks it today (the only escapes)

1. **AbortSignal**: the loop's signal aborts → `raceWithAbort` rejects `AbortError` → `executePreparedToolCall` catches → returns an error tool result (`"Tool execution aborted"`) → the loop *continues* (or ends if the whole agent was aborted). Who can abort:
   - **Interactive human**: Esc / Ctrl+C → `modes/interactive/interactive-mode.js` `handleInterruptKey → interruptOrClearInput` → `agentConnection.abort…` → `AgentSession.requestAbort → agent.abort()` (`core/agent-session.js`).
   - **RLM parent**: `_cancelRlmChildRun(run, reason) { run.abort(); … }` — a parent can abort a stuck child, cascading the signal into the child's hung tool.
   - **Mediation**: `interrupt(runId, "abort")` → `session.abort()` (see (c)).
   - **OpenWorkflow cancel**: `ow_cancel` / `cancelWorkflowRun` → `run-agent.ts` AbortSignal → `child.kill("SIGTERM")`.
2. **Outer process deadline (OW-dispatched runs only)**: `platform/openworkflow/run-agent.ts`: `const timeoutMs = options?.timeoutMs ?? 1_200_000;` (20 min) → `child.kill("SIGTERM")` and reject `timed out after …ms`. Coarse, and only for dispatched agents, not interactive/daemon sessions in the same process.
3. **Autonomous limits** (`core/autonomous.js`): `timeoutMs: 30min` default — but enforced **between turns** (continuation accounting), not during a tool call.

### The steering gap (important)

`steer()` is documented in `core/agent-session.js` as: *"Queue a prompt that interrupts the agent turn **as soon as the current turn finishes executing its tool calls**, before the next LLM call."* The core loop polls `getSteeringMessages` only after a tool batch settles. So **steer cannot rescue a hung tool** — only abort can. "Interrupt" in the mediation sense (`steer`/`followUp`) is not a preemptive interrupt of tool execution; it is a queue into the loop's next LLM call.

---

## (b) The user's async-tools pattern — as implemented (quotes)

Three layers in `company/` (all read-only here):

### 1. The toolkit auto-escalation — `lib/toolkit/define-tool.ts`

Every `defineTool` Mode 1/2 tool gets `wait`/`label` injected into its schema. The sync path races the
handler against a **3-second budget**:

```ts
// ── SYNC path with auto-escalation ──────────────────────────────
if (wait !== false) {
  const timeoutMs = (cfg as any).timeoutMs ?? 3000;     // ← default 3000ms
  // timeoutMs === 0 disables auto-escalation
  ...
  await Promise.race([
    execPromise,
    new Promise<void>((r) => setTimeout(r, timeoutMs)),
  ]);
  if (settled) { /* completed within timeout — return sync */ }

  // ── Auto-escalated: handler is still running ──────────────────
  pi.events.emit("task-notifier:started", { source, taskId, label, sessionId, startedAt });
  execPromise.then(() => { /* emit task-notifier:completed with result */ });
  return {
    content: [{
      type: "text",
      text:
        `Running in background. Auto-escalated: this call exceeded the 3s loop budget ` +
        `(non-blocking loop policy — the agent loop never blocks longer than 3s, so the human stays interjectable). ` +
        ...
        `Retrieve with get_result({ label: '${autoLabel}' }) once after the notification lands — never poll in a loop.`
    }],
    ...
  };
}
```

Design intent, in the code's own words (comment in `extensions/core/async-tools/index.ts`):

```ts
// HARD RULE (human design, 2026-08-02): NO timeoutMs here — the toolkit defaults to 3000ms.
// Calls exceeding 3s MUST auto-escalate to background (the agent loop never blocks >3s,
// so the human stays interjectable). Do NOT disable auto-escalation; fix communication instead.
```

### 2. The async tool overrides — `extensions/core/async-tools/{index,asyncify,run-async}.ts`

The built-in `bash`, `grep`, `ls`, `find` tools are **overridden by name** (extensions.md
§Overriding Built-in Tools) with `delegateTool` / `asyncify` wrappers that add `wait`/`label`:

```ts
// asyncify.ts — generic wrapper
async execute(toolCallId, params, signal, onUpdate, ctx) {
  const { wait, label, ...originalParams } = params as any;
  // ── Sync: pure delegation to built-in ──────────────────────────
  if (wait !== false) {
    const def = createDef(extCtx.cwd);
    return (def.execute as any)(toolCallId, originalParams, signal, onUpdate, ctx);
  }
  // ── Async: fire and forget ──────────────────────────────────────
  ...
  pi.events.emit("task-notifier:started", { source: meta.name, taskId, label, sessionId, startedAt });
  // Deliberately not awaited — runs to completion in background
  runAsync(pi, { def, toolCallId, params: originalParams, signal, ctx: extCtx, taskId, label, sessionId });
  return { content: [{ type: "text", text: JSON.stringify({ id: label, status: "running", ... }) }] };
}
```

`run-async.ts` awaits the built-in execute in the background and emits
`task-notifier:completed` (or `error`), attaching `durationMs: Date.now() - startedAt` — the
completion notification is the time-awareness the agent sees.

### 3. The notification + anti-poll layer — `extensions/core/task-notifier/index.ts`

A task store keyed by `(sessionId, label)` with `get_result` / `drain_notifications` tools and a
**poll guard** that structurally discourages re-checking a running task:

```ts
// Poll guard (poka-yoke: make polling structurally discouraged) ...
// Instead, track consecutive lookups per (session, label) and redirect the response
// to the designed path: end your turn, the completion notification arrives and carries the result.
...
return head + `\nYou've checked ${count} times — still running, nothing has changed.\n`
  + "Stop polling: the completion notification arrives automatically and carries the result. "
  + "End your turn now, or set_reminder({ yield: true }) for a bounded wake. "
  + "You lose nothing by yielding.";
```

**Key property of the user's pattern: it does not cancel — it decouples.** The loop is guaranteed an
answer within 3s; the work continues in the background; the result arrives as a notification. The agent
never *waits in a pit*; it yields and stays interjectable. (Contrast: `run-agent.ts`'s 20-min kill and
the fork's abort both *cancel*.)

**Coverage caveat:** the pattern covers toolkit-defined tools + the four overridden built-ins
(bash/grep/ls/find). Fork built-ins like `ipython`, `edit`, `websearch`, and any other fork tool are
**not** wrapped by it in the current fork session.

---

## (c) What already exists for escape — and the gaps

### Escape machinery that exists

| Layer | Primitive | What it can do | Where |
|---|---|---|---|
| Fork loop | `AbortSignal` + `raceWithAbort` | unblocks a hung tool (returns "Tool execution aborted" result), loop continues | `bundle/chunk-ALQBG3TN.js` `executePreparedToolCall` |
| Fork bash | `signal` + optional `timeout` | kills process tree on abort/timeout | `core/tools/bash.js` `createLocalBashOperations.exec` |
| Fork exec | `options.timeout` + `signal` | SIGTERM→SIGKILL | `core/exec.js` `execCommand` |
| Fork session | `abort()` / `steer()` / `followUp()` | abort preempts; steer/followUp queue between tool batches | `core/agent-session.js` |
| Fork interactive | Esc / Ctrl+C | human abort + steer | `modes/interactive/interactive-mode.js` |
| RLM | `_cancelRlmChildRun → run.abort()` | parent aborts stuck child (cascades signal) | `core/agent-session.js` |
| Toolkit (company) | 3s auto-escalate → background + task-notifier | loop never blocks >3s (user's pattern) | `lib/toolkit/define-tool.ts`, `extensions/core/async-tools/*` |
| Mediation | `interrupt(runId, steer\|followUp\|abort)` | steer/followUp/abort a **live in-process** presence | `src/app/mediation.ts`, `src/adapters/shared/engine-session-handle.ts` |
| Mediation | `cancel(runId)` (durable OW) | `cancelWorkflowRun` → SIGTERM to agent process | `src/app/mediation.ts`, `src/ports/surface.ts` |
| Mediation | `sendSignal` / `wake` | resume a parked run (Model P) | `src/adapters/openworkflow/signals.ts`, engagement-arc `waitForSignal` |
| OW bridge | `timeoutMs ?? 1_200_000` | kills a dispatched agent process after 20 min | `platform/openworkflow/run-agent.ts` |
| Autonomous | limits (30min etc.) | enforced between turns only | `core/autonomous.js` |
| bg skill | background jobs + `wait_any(timeout)` | agent-side bounded wait | `.prime/agent/skills/bg/` |

### The gaps

1. **No per-tool timeout in the fork core loop.** `raceWithAbort` is signal-only. A non-cooperative
   `execute` holds the turn indefinitely, in both parallel (`Promise.all`) and sequential modes.
2. **Bash has no default timeout** ("optional, no default timeout"). The model must remember to pass
   `timeout` — and a model deep in a loop forgets. Same for `pi.exec`.
3. **Steer can't rescue a hung tool.** Steering messages are delivered only after the tool batch
   settles; the loop's `pollMessagesUnlessAborted(getSteeringMessages)` calls sit after
   `executeToolCalls` returns. "Interrupt" in mediation ≠ preemptive tool interrupt.
4. **Mediation has no clock/watchdog.** `Mediation.interrupt` requires a caller that *notices* the run
   is stuck; nothing watches elapsed time per run (no "last progress" tracking, no live-turn clock).
   Also only in-process live presences are interruptible (`PRESENCE_NOT_LIVE` otherwise) — durable runs
   only get the coarse 20-min OW kill.
5. **Abort doesn't kill the underlying promise.** `raceWithAbort` rejects the await, but a tool that
   ignores `signal` keeps running (leak). Bash honors signal; arbitrary tools may not.
6. **No outer deadline for in-process sessions.** Interactive and daemon sessions in the fork have no
   per-turn or per-session deadline; autonomous limits apply between turns only.
7. **The gate had no deadline.** Mediation's test runner ran `--test-timeout=0` (no per-test deadline);
   parent's `a768ca7` changed to `--test-timeout=120000` in `product/mediation-engine/mediation/package.json`
   (`test`, `test:runtime`). Systemic echo of the same principle: a timeout-free system has no escape.

---

## (d) Proposals — ranked smallest → most systemic

**P1 — Default timeout on the fork's bash/exec tools (smallest, one file each).**
Change `core/tools/bash.js` schema: `timeout: "Timeout in seconds (default: 60)"`, apply the default in
`execute`. The kill machinery (`setTimeout → killProcessTree`) already exists — this just makes it
always-on. Same for `core/exec.js` `execCommand`. Cheap, immediate pit-avoidance for the hung-command
case. Doesn't fix the loop-level guarantee (a non-bash tool can still hang).

**P2 — Per-tool timeout in the fork loop (the real loop-level guarantee).**
Add `timeoutMs?: number` to `ToolDefinition` (`core/extensions/types.d.ts`) and race in
`executePreparedToolCall`:
```
Promise.race([ tool.execute(...), timeout(tool.timeoutMs ?? DEFAULT) , signal ])
```
On timeout, return an error tool result (`"Tool timed out after Ns"`) and continue the loop — the
agent stays in control and can retry/back off. This is the fork-side version of the user's 3s budget,
but with **cancel** semantics instead of backgrounding (or make it configurable per tool: cancel vs
background). Also fix the leak: pass `onAbort`/`onTimeout` through to tools that can kill their work
(bash already can).

**P3 — Per-turn deadline in the fork (`turnTimeoutMs`).**
A session setting (default, say, 10 min) that aborts the turn signal when exceeded, then steers
`"Turn exceeded budget — here's where you were"`. Turns the "only when something times out" complaint
into a *designed* timeout the agent is told about, instead of a hung process. This is the minimal
"time-awareness" the human asked for (agents that know time exists).

**P4 — Mediation live-turn watchdog (the orchestration-level guarantee).**
Mediation already owns the interrupt machinery (`interrupt(runId, "abort")`) and sees progress events
(`tool_execution_start/end`, `message_end`, idle snapshots via `EngineSessionHandleBase`). Add a
per-run **last-progress clock** + a supervisor sweep (daemon surface or a `setInterval` in the
engagement leaf) that auto-aborts runs idle > N minutes (or escalates to the human). This turns the
existing escape primitives into an automatic guarantee for unattended/durable runs — no human required
to notice the pit. Complements P2/P3 rather than replacing them.

**P5 — Port the user's async-tools pattern onto the fork's built-ins (most systemic, matches the
user's stated design).**
Bring the `defineTool` 3s auto-escalate + `task-notifier` + `get_result` + poll-guard stack to the
fork's built-in tools (ipython, edit, websearch, …) — i.e., make the fork itself guarantee "no tool can
hold the agent's loop in a state", exactly as the user did in their Pi system. The loop always gets an
answer ≤3s; long work continues in the background and reports back via notification. This is the only
option that preserves long-running work instead of killing it, and it is the user's demonstrated
preference. Cost: it's a fork + extensions change and needs the notification channel wired into
autonomous/mediation runs (the notification is currently a steer message; in a daemon run it must
become a signal/record).

**Recommended bundle:** P1 + P2 now (guarantee at the fork loop), P4 for unattended runs, P5 as the
long-term direction the human already believes in. P3 is a stopgap that gives time-awareness even
before the async port.

---

## (e) Open questions for the human discussion

1. **Cancel or decouple?** The user's Pi pattern *decouples* (background + notify, work survives).
   The fork/OW today *cancel* (SIGTERM/abort). Which semantics for which tool class? (bash → decouple
   like today's Pi; LLM streaming → cancel; network fetch → decouple with timeout?)
2. **Where does the guarantee live?** Fork core loop (P2 — every tool, every session), company toolkit
   (already done for Pi — port to fork?), or mediation watchdog (P4 — only orchestrated runs)? The
   answer depends on whether the pit is mostly interactive, daemon, or OW-dispatched.
3. **What is the time budget model?** 3s auto-background in interactive; what about autonomous/daemon
   where no human is watching to be "interjectable"? Per-tool budgets per class (bash 3s, web 15s,
   LLM 60s)? Should the budget be visible in the tool schema so the model reasons about it?
4. **Who is the human-in-the-loop in unattended runs?** P4's watchdog needs a policy: auto-abort →
   park → notify human? Or abort → record → resume later? The park/wake machinery (Model P) already
   exists — is "park a stuck run" the desired escape?
5. **Should steer become preemptive?** Today steer only lands between tool batches; a hung tool is
   invisible to steer. Should `steer` also abort the current tool batch (like `abort` + inject the
   steer text), so the human's interrupt always works even mid-tool? (This is arguably the smallest
   change with the biggest UX win — it makes "the human stays interjectable" true at the fork level.)
6. **Leak policy on abort:** when the loop escapes via abort/timeout, should it kill the underlying
   work (bash tree-kill today) or leave it running (ipython kernel)? Need a per-tool contract and a
   registry of orphaned executions so they can be reaped later.
7. **Test doctrine:** keep `--test-timeout=120000` and add a scenario class "stuck tool must not hold
   the loop" (gated live) so the guarantee is regression-tested, mirroring TESTING-DOCTRINE's
   "engine-touching behavior gets a gated live scenario".

---

## Appendix — evidence index

Fork (`/opt/homebrew/lib/node_modules/prime-agent/dist/`):
- `bundle/chunk-ALQBG3TN.js` — `runLoop`, `executeToolCalls{Parallel,Sequential}`, `executePreparedToolCall`, `raceWithAbort`, `prepareToolCall`, `finalizeExecutedToolCall`, `shouldTerminateToolBatch`.
- `core/tools/bash.js` — bashSchema (`timeout` optional, "no default timeout"), `createLocalBashOperations.exec` (timeout → killProcessTree; signal → killProcessTree; else wait forever), `"Command timed out after … seconds"`.
- `core/exec.js` — `execCommand` (timeout + signal, SIGTERM → SIGKILL 5s).
- `core/extensions/types.d.ts` — `ToolDefinition` (no timeout field; `execute(toolCallId, params, signal, onUpdate, ctx)`).
- `core/agent-session.js` — `requestAbort/abort() → agent.abort()`; `steer()` doc ("as soon as the current turn finishes executing its tool calls"); `_cancelRlmChildRun → run.abort()`; `_installAgentToolHooks` (beforeToolCall/afterToolCall).
- `core/autonomous.js` — `DEFAULT_AUTONOMOUS_LIMITS { timeoutMs: 30min … }` (between-turn enforcement).
- `modes/interactive/interactive-mode.js` — `handleInterruptKey → interruptOrClearInput`.
- `core/tools/ipython.js` — kernel interrupt vs kill-restart flow.

Company:
- `lib/toolkit/define-tool.ts` — 3s auto-escalation (`timeoutMs ?? 3000`, `Promise.race`, task-notifier, "never blocks longer than 3s").
- `lib/toolkit/async.ts` — `runInBackground` (wait:false path).
- `extensions/core/async-tools/index.ts` — HARD RULE comment; `delegateTool` overrides bash/grep/ls/find.
- `extensions/core/async-tools/asyncify.ts`, `run-async.ts` — wait/label, background execute, completion events.
- `extensions/core/task-notifier/index.ts` — task store, `get_result`, `drain_notifications`, poll guard.
- `extensions/agents/openworkflow-dispatch/tools/cancel.ts` (ow_cancel), `signal.ts` (ow_signal).
- `product/mediation-engine/mediation/src/adapters/shared/engine-session-handle.ts` — `interrupt(kind)` → `session.abort()/steer()/followUp()`; `waitUntilIdle`.
- `product/mediation-engine/mediation/src/app/mediation.ts` — `interrupt(runId, …)` via `livePresences` (PRESENCE_NOT_LIVE otherwise); `cancel(runId)`; `sendSignal/wake`.
- `product/mediation-engine/mediation/src/app/recipes/interrupt.ts` — Recipe F.
- `product/mediation-engine/mediation/src/ports/surface.ts` — `wait(timeoutMs?)`, `cancel`, `sendSignal`, `wake`.
- `product/mediation-engine/mediation/src/adapters/openworkflow/signals.ts` — `ENGAGEMENT_WAKE_KIND`, wake payload.
- `product/mediation-engine/mediation/src/adapters/openworkflow/workflows/engagement-arc.ts` — `waitForSignal` park/wake (no abort/cancel/timeout of its own).
- `product/mediation-engine/mediation/package.json` — `--test-timeout=120000` (parent change a768ca7; previously `0`).
- `platform/openworkflow/run-agent.ts` — `timeoutMs ?? 1_200_000`, SIGTERM + AbortSignal.
- `platform/openworkflow/worker.ts` — no timeouts/cancel of its own.
- `.prime/agent/skills/bg/SKILL.md` — background jobs + `wait_any(timeout)`.
