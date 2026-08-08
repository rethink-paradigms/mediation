/**
 * PARK→WAKE REGRESSION — default continue after settled park on a
 * Pi-faithful role-guard session (TESTING-DOCTRINE rule 3).
 *
 * The mock engine has no role guard, so mock-green masked the real-Pi bug:
 *   session.agent.continue() throws "Cannot continue from message role:
 *   assistant" when the last transcript message is assistant (which is always
 *   the case after a full settled parkIntent turn).
 *
 * This suite drives the SAME product doors (handle/leaf/arc/mediation) over
 * a fake Pi session that enforces Pi's real continue precondition. It must
 * FAIL on pre-fix code (bare continue → role-guard throw) and PASS post-fix
 * (bridge → route through prompt when last role is assistant).
 *
 * Keyless — no MEDIATION_LIVE_PI gate; the role-guard fake IS the engine.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { MemoryJoinStore } from "../../src/adapters/join/memory-store.ts";
import { PiEngineAdapter } from "../../src/adapters/pi/engine-adapter.ts";
import { PiEngineSessionHandle } from "../../src/adapters/pi/session-handle.ts";
import type {
  PiSessionEvent,
  PiSessionSurface,
} from "../../src/adapters/pi/types.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { runEngagementArc } from "../../src/adapters/openworkflow/workflows/engagement-arc.ts";
import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { Mediation } from "../../src/app/mediation.ts";
import { asRunId } from "../../src/domain/engagement.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import { engagementWakeSignal } from "../../src/adapters/openworkflow/signals.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

// ─── Pi-faithful role-guard fake session ───────────────────────────────────
// Mirrors pi-agent-core 0.80.10 Agent.continue(): last message MUST NOT be
// assistant. prompt() appends a user message + runs to an assistant settle,
// exactly like the real session after a settled turn.

export type RoleMsg = { readonly role: string; readonly text: string };

export class RoleGuardPiSession implements PiSessionSurface {
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  isStreaming = false;
  readonly agent: {
    continue?: () => Promise<void>;
    waitForIdle?: () => Promise<void>;
  };
  /** Transcript the handle can inspect (real AgentSession.messages). */
  readonly messages: RoleMsg[];
  promptCalls: string[] = [];
  continueCalls = 0;

  private listeners = new Set<(e: PiSessionEvent) => void>();
  private idleResolvers: Array<() => void> = [];
  private disposed = false;

  constructor(opts: {
    sessionId?: string;
    sessionFile?: string;
    messages?: RoleMsg[];
  } = {}) {
    this.sessionId = opts.sessionId ?? "rg-session-id";
    this.sessionFile = opts.sessionFile;
    this.messages = opts.messages ?? [];
    const self = this;
    this.agent = {
      waitForIdle: () => self.waitForIdle(),
      // Pi's exact role guard (pi-agent-core dist/agent.js Agent.continue).
      continue: async () => {
        self.continueCalls += 1;
        if (self.lastRole === "assistant") {
          throw new Error("Cannot continue from message role: assistant");
        }
        self.scheduleSettle();
      },
    };
  }

  get lastRole(): string | undefined {
    return this.messages.at(-1)?.role;
  }

  private emit(e: PiSessionEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        // listener errors must not break the session
      }
    }
  }

  private scheduleSettle(): void {
    this.isStreaming = true;
    this.emit({ type: "agent_start" });
    const finish = () => {
      if (this.disposed) return;
      this.emit({ type: "agent_end", willRetry: false, messages: [] });
      this.emit({ type: "agent_settled" });
      this.isStreaming = false;
      const resolvers = this.idleResolvers.splice(0);
      for (const r of resolvers) r();
    };
    queueMicrotask(finish);
  }

  async prompt(text: string): Promise<void> {
    if (this.disposed) throw new Error("RoleGuardPiSession: disposed");
    this.promptCalls.push(text);
    this.messages.push({ role: "user", text });
    this.scheduleSettle();
    // A completed turn settles with an assistant tail (real Pi behavior).
    queueMicrotask(() => {
      if (this.disposed) return;
      this.messages.push({ role: "assistant", text: "ok" });
    });
  }

  async steer(text: string): Promise<void> {
    void text;
  }

  async followUp(text: string): Promise<void> {
    void text;
  }

  async abort(): Promise<void> {
    this.isStreaming = false;
    this.emit({ type: "agent_settled" });
    const resolvers = this.idleResolvers.splice(0);
    for (const r of resolvers) r();
  }

  async waitForIdle(): Promise<void> {
    if (!this.isStreaming) return;
    await new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  subscribe(listener: (event: PiSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.idleResolvers.splice(0);
  }
}

// ─── Role-guard session factory (resume reopens fresh object, same transcript) ─
// Mirrors real Pi file sessions: dispose ends the in-process object; a later
// materialize(resume) opens a NEW session object seeded from the persisted
// transcript. The shared `messages` array is the durable transcript.

function makeRoleGuardWiring() {
  const sessions = new Map<string, RoleGuardPiSession>();
  const transcripts = new Map<string, RoleMsg[]>();
  let seq = 0;
  const engine = new PiEngineAdapter({
    inMemorySession: false,
    sessionFactory: async (req) => {
      const ref = req.resume ? String(req.resume) : `rg-file-${(seq += 1)}`;
      let messages = transcripts.get(ref);
      if (!messages) {
        messages = [];
        transcripts.set(ref, messages);
      }
      const session = new RoleGuardPiSession({
        sessionId: ref,
        sessionFile: ref,
        messages,
      });
      sessions.set(ref, session);
      return { session, sessionRefValue: ref };
    },
  });
  const factory = new DefaultPresenceFactory({
    engine,
    toPackSnapshot,
    capabilityResolver: createCapabilityResolver(
      createFsCapabilityStore({
        projectRoot: FIXTURE_ROOT,
        homeDir: NO_HOME,
      }),
    ),
  });
  const loader = {
    load: async (ref: { name: string; rootDir: string }) =>
      agentDefForPacks(ref.rootDir, ["foo", "bar"], ref.name),
  };
  const join = new MemoryJoinStore();
  const mediation = new Mediation({ loader, factory, join });
  return { sessions, engine, factory, join, mediation };
}

async function sessionOfRun(
  join: MemoryJoinStore,
  sessions: Map<string, RoleGuardPiSession>,
  runId: string,
): Promise<RoleGuardPiSession> {
  const record = await join.getByRunId(runId as never);
  assert.ok(record, `join record missing for ${runId}`);
  const session = sessions.get(String(record.sessionRef));
  assert.ok(session, `session missing for ${record.sessionRef}`);
  return session;
}

/** User messages of the durable transcript (bridge is the last one post-park). */
function userMessages(session: RoleGuardPiSession): string[] {
  return session.messages
    .filter((m) => m.role === "user")
    .map((m) => m.text);
}

describe("park→wake default continue on role-guard Pi session (regression)", () => {
  it("bare handle.continue() on assistant tail fails closed (Pi rule preserved)", async () => {
    const session = new RoleGuardPiSession({
      sessionId: "rg-bare",
      sessionFile: "rg-bare",
      messages: [
        { role: "user", text: "park me" },
        { role: "assistant", text: "waiting" },
      ],
    });
    const handle = new PiEngineSessionHandle({
      session,
      sessionRef: asSessionRef("rg-bare"),
    });
    await assert.rejects(
      () => handle.continue(),
      /Cannot continue from message role: assistant/u,
    );
    assert.equal(session.continueCalls, 1);
    assert.deepEqual(session.promptCalls, []);
    await handle.dispose();
  });

  it("REGRESSION: continue with bridge on assistant tail routes through prompt", async () => {
    const session = new RoleGuardPiSession({
      sessionId: "rg-bridge",
      sessionFile: "rg-bridge",
      messages: [
        { role: "user", text: "park me" },
        { role: "assistant", text: "waiting for approval" },
      ],
    });
    const handle = new PiEngineSessionHandle({
      session,
      sessionRef: asSessionRef("rg-bridge"),
    });
    // Pre-fix: the argument is dropped, agent.continue() runs, role guard
    // throws → rejects. Post-fix: bridge routes through prompt → resolves.
    await handle.continue({
      bridgeText: "[park bridge] waiting for approval / approved, go",
    });
    assert.equal(session.continueCalls, 0);
    assert.equal(session.promptCalls.length, 1);
    assert.match(session.promptCalls[0]!, /waiting for approval/u);
    assert.match(session.promptCalls[0]!, /approved, go/u);
    await handle.dispose();
  });

  it("REGRESSION: continue with bridge on user/toolResult tail routes through prompt (payload never dropped)", async () => {
    // D2: the bridge is appended to the parked context unconditionally. A
    // bare loop-resume on a user/toolResult tail would be Pi-legal but would
    // silently DROP the wake payload. Assert the bridge reaches the model via
    // prompt for a non-assistant known tail too.
    const session = new RoleGuardPiSession({
      sessionId: "rg-bridge-usertail",
      sessionFile: "rg-bridge-usertail",
      messages: [
        { role: "user", text: "park me" },
        { role: "toolResult", text: "tool finished" },
      ],
    });
    const handle = new PiEngineSessionHandle({
      session,
      sessionRef: asSessionRef("rg-bridge-usertail"),
    });
    await handle.continue({
      bridgeText: "[park bridge] waiting on review / reviewer approved, go",
    });
    // Pi's continue() is legal after toolResult — but the bridge must still be
    // delivered: route through prompt, never bare continue.
    assert.equal(session.continueCalls, 0);
    assert.equal(session.promptCalls.length, 1);
    assert.match(session.promptCalls[0]!, /reviewer approved, go/u);
    await handle.dispose();
  });

  it("arc: park → wake default continue → Settled same sessionRef + bridge in prompt", async () => {
    const { sessions, factory, join } = makeRoleGuardWiring();
    const runId = "rg-arc-1";
    const stepNames: string[] = [];

    const outcome = await runEngagementArc({
      input: {
        agentName: "rg-arc",
        agentRoot: FIXTURE_ROOT,
        task: "first park",
        parkIntent: true,
        parkReason: "need-human-approval",
      },
      runId,
      step: {
        async run(config, fn) {
          stepNames.push(config.name);
          return fn();
        },
        async waitForSignal(opts) {
          assert.equal(opts.signal, engagementWakeSignal(runId));
          return { data: { payloadText: "approved, go" } as never };
        },
      },
      deps: {
        factory,
        join,
        resolveDefinition: (inp) =>
          agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
      },
    });

    assert.deepEqual(stepNames, ["engagement-leaf", "engagement-continue-1"]);
    assert.equal(
      outcome.kind,
      "settled",
      `expected settled, got ${JSON.stringify(outcome)}`,
    );
    if (outcome.kind === "settled") {
      const parked = await join.getByRunId(runId as never);
      assert.ok(parked);
      assert.equal(outcome.sessionRef, String(parked.sessionRef));
      assert.equal(parked.status, "settled");
    }
    // Durable transcript: [park prompt, bridge]. Bridge carries wait contract + payload.
    const session = await sessionOfRun(join, sessions, runId);
    const users = userMessages(session);
    assert.equal(users.length, 2);
    const bridge = users[1]!;
    assert.match(bridge, /need-human-approval/u);
    assert.match(bridge, /approved, go/u);
  });

  it("arc: wake explicit prompt mode delivers raw payload (no bridge)", async () => {
    const { sessions, factory, join } = makeRoleGuardWiring();
    const runId = "rg-arc-prompt";

    const outcome = await runEngagementArc({
      input: {
        agentName: "rg-arc-prompt",
        agentRoot: FIXTURE_ROOT,
        task: "park first",
        parkIntent: true,
        parkReason: "await-review",
      },
      runId,
      step: {
        async run(_config, fn) {
          return fn();
        },
        async waitForSignal() {
          return {
            data: { payloadText: "explicit prompt payload", mode: "prompt" } as never,
          };
        },
      },
      deps: {
        factory,
        join,
        resolveDefinition: (inp) =>
          agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
      },
    });

    assert.equal(outcome.kind, "settled");
    const session = await sessionOfRun(join, sessions, runId);
    assert.deepEqual(userMessages(session), ["park first", "explicit prompt payload"]);
  });

  it("arc: re-park via wake parkIntent then settle", async () => {
    const { sessions, factory, join } = makeRoleGuardWiring();
    const runId = "rg-arc-repark";
    let wakeCount = 0;

    const outcome = await runEngagementArc({
      input: {
        agentName: "rg-arc-repark",
        agentRoot: FIXTURE_ROOT,
        task: "park 1",
        parkIntent: true,
        parkReason: "first-wait",
      },
      runId,
      step: {
        async run(_config, fn) {
          return fn();
        },
        async waitForSignal() {
          wakeCount += 1;
          if (wakeCount === 1) {
            return {
              data: {
                payloadText: "still waiting",
                parkIntent: true,
                parkReason: "second-wait",
              } as never,
            };
          }
          return { data: { payloadText: "done now" } as never };
        },
      },
      deps: {
        factory,
        join,
        resolveDefinition: (inp) =>
          agentDefForPacks(inp.agentRoot, ["foo", "bar"], inp.agentName),
      },
    });

    assert.equal(wakeCount, 2);
    assert.equal(outcome.kind, "settled");
    const session = await sessionOfRun(join, sessions, runId);
    // [park 1, bridge(first-wait), bridge(second-wait)]
    const users = userMessages(session);
    assert.equal(users.length, 3);
    assert.match(users[1]!, /first-wait/u);
    assert.match(users[1]!, /still waiting/u);
    assert.match(users[2]!, /second-wait/u);
    assert.match(users[2]!, /done now/u);
  });

  it("REGRESSION: mediation.reenter default continue after park → Settled same sessionRef", async () => {
    const { sessions, join, mediation } = makeRoleGuardWiring();
    const agent = { name: "rg-reenter", rootDir: FIXTURE_ROOT };

    const parked = await mediation.engageLocal({
      agent,
      task: "need review",
      parkIntent: true,
      parkReason: "await-approval",
    });
    assert.equal(parked.outcome.kind, "parked");
    assert.ok(parked.sessionRef);
    const parkedRef = parked.sessionRef!;

    // Leaf/hosted flows persist the parked wait contract on the join record;
    // mirror that so reenter can rebuild the bridge from parked.reason.
    await join.put({
      runId: asRunId("rg-run-reenter"),
      sessionRef: asSessionRef(parkedRef),
      definitionId: parked.definitionId,
      packSnapshot: {
        planHash: parked.packSnapshotHash!,
        packs: [],
        createdAt: new Date().toISOString(),
      },
      status: "parked",
      parked: {
        reason: "await-approval",
        resumeToken: `park:${parkedRef}:x`,
      },
      updatedAt: new Date().toISOString(),
    });

    // Omit mode → reenter defaults to "continue" (product default under test).
    const cont = await mediation.reenter({
      agent,
      sessionRef: asSessionRef(parkedRef),
      task: "approved by human",
    });

    assert.equal(
      cont.outcome.kind,
      "settled",
      `expected settled reenter, got ${JSON.stringify(cont.outcome)}`,
    );
    assert.equal(cont.sessionRef, parkedRef);
    const session = sessionForRef(sessions, parkedRef);
    // Bridge prose reaches the resumed session as the next user turn.
    const users = userMessages(session);
    const bridge = users.at(-1) ?? "";
    assert.match(bridge, /await-approval/u);
    assert.match(bridge, /approved by human/u);
  });
});

function sessionForRef(
  sessions: Map<string, RoleGuardPiSession>,
  ref: string,
): RoleGuardPiSession {
  const s = sessions.get(ref);
  assert.ok(s, `role-guard session missing for ${ref}`);
  return s;
}
