/**
 * S2e resume pinning:
 *   - park → wake continue copies engine through the arc (park→wake pins)
 *   - reenterFromJoin defaults to record.engine
 *   - explicit override wins over record.engine
 *   - direct reenter reuses join record engine when no override
 */
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { MemoryJoinStore } from "../../src/adapters/join/memory-store.ts";
import { MockEngineSessionHandle } from "../../src/adapters/mock/engine-adapter.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { runEngagementArc } from "../../src/adapters/openworkflow/workflows/engagement-arc.ts";
import { runEngagementLeaf } from "../../src/adapters/openworkflow/workflows/engagement.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { Mediation } from "../../src/app/mediation.ts";
import { asRunId } from "../../src/domain/engagement.ts";
import {
  asSessionRef,
  type MaterializeOptions,
} from "../../src/domain/presence.ts";
import type { AgentDefinition } from "../../src/domain/definition.ts";
import type { EnginePort, EngineRegistry } from "../../src/ports/engine.ts";
import type { OpenSessionRequest } from "../../src/ports/engine.ts";
import { agentDefForPacks } from "../helpers/agent-def.ts";

const HERE = import.meta.dirname;
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

function fakePort(sessionRef: string): EnginePort {
  return {
    async openSession(_req: OpenSessionRequest) {
      return new MockEngineSessionHandle(asSessionRef(sessionRef));
    },
  };
}

function registryWith(ports: Record<string, EnginePort>): EngineRegistry {
  return {
    async get(kind) {
      const port = ports[kind];
      if (!port) throw new Error(`no fake ${kind}`);
      return port;
    },
    has(kind) {
      return kind in ports;
    },
    kinds: Object.keys(ports) as never,
  };
}

function makeFactory() {
  return new DefaultPresenceFactory({
    registry: registryWith({
      pi: fakePort("pi-session"),
      prime: fakePort("prime-session"),
      mock: fakePort("mock-session"),
    }),
    defaultEngine: "mock",
    toPackSnapshot,
    capabilityResolver: createCapabilityResolver(
      createFsCapabilityStore({ projectRoot: FIXTURE_ROOT, homeDir: NO_HOME }),
    ),
  });
}

const DEF = agentDefForPacks(FIXTURE_ROOT, ["foo", "bar"], "pin-agent-s2e");

describe("resume pins the engine (S2e §5)", () => {
  it("park → wake continue copies engine through the arc", async () => {
    const factory = makeFactory();
    const join = new MemoryJoinStore();
    const runId = "arc-pin-1";
    const continueEngines: Array<string | undefined> = [];

    const outcome = await runEngagementArc({
      input: {
        agentName: "pin-agent-s2e",
        agentRoot: FIXTURE_ROOT,
        task: "first park",
        parkIntent: true,
        parkReason: "await-human",
        engine: "prime",
      },
      runId,
      step: {
        async run(_config, fn) {
          return fn();
        },
        async waitForSignal() {
          return {
            data: { payloadText: "human approved", mode: "continue" } as never,
          };
        },
      },
      deps: {
        factory,
        join,
        defaultEngine: "mock",
        resolveDefinition: (inp) => {
          // Continue leaf carries a sessionRef; capture the pinned engine.
          if (inp.sessionRef !== undefined) continueEngines.push(inp.engine);
          return DEF;
        },
      },
    });

    assert.equal(outcome.kind, "settled");
    if (outcome.kind === "settled") {
      // parked under prime, continued under prime (engine copied, not reset)
      assert.equal(outcome.engine, "prime");
      assert.equal(outcome.sessionRef, "prime-session");
    }
    assert.deepEqual(continueEngines, ["prime"]);

    // join records the pinned engine through park → wake
    const record = await join.getByRunId(asRunId(runId));
    assert.ok(record);
    assert.equal(record.status, "settled");
    assert.equal(record.engine, "prime");
  });

  it("reenterFromJoin defaults to record.engine (pins the creating run)", async () => {
    const join = new MemoryJoinStore();
    const runId = asRunId("join-pin-1");
    await join.put({
      runId,
      sessionRef: asSessionRef("prime-session"),
      definitionId: "pin-agent-s2e",
      packSnapshot: {
        planHash: "0".repeat(64),
        packs: [],
        createdAt: new Date().toISOString(),
      },
      status: "parked",
      engine: "prime",
      updatedAt: new Date().toISOString(),
    });

    const recorded: Array<{ engine?: string }> = [];
    const factory = makeFactory();
    const recording = {
      async materialize(def: AgentDefinition, opts?: MaterializeOptions) {
        recorded.push({ engine: opts?.engine });
        return factory.materialize(def, { ...opts, resume: asSessionRef("prime-session") });
      },
    };

    const mediation = new Mediation({
      loader: { load: async () => DEF },
      factory: recording as never,
      join,
    });

    const result = await mediation.reenterFromJoin(
      { runId },
      { agent: { name: "pin-agent-s2e", rootDir: FIXTURE_ROOT }, task: "continue" },
    );
    assert.equal(result.outcome.kind, "settled");
    // no explicit override → record.engine "prime" pinned
    assert.deepEqual(recorded, [{ engine: "prime" }]);
  });

  it("explicit override wins over record.engine", async () => {
    const join = new MemoryJoinStore();
    const runId = asRunId("join-pin-2");
    await join.put({
      runId,
      sessionRef: asSessionRef("prime-session"),
      definitionId: "pin-agent-s2e",
      packSnapshot: {
        planHash: "0".repeat(64),
        packs: [],
        createdAt: new Date().toISOString(),
      },
      status: "parked",
      engine: "prime",
      updatedAt: new Date().toISOString(),
    });

    const recorded: Array<{ engine?: string }> = [];
    const factory = makeFactory();
    const recording = {
      async materialize(def: AgentDefinition, opts?: MaterializeOptions) {
        recorded.push({ engine: opts?.engine });
        return factory.materialize(def, { ...opts, resume: asSessionRef("prime-session") });
      },
    };

    const mediation = new Mediation({
      loader: { load: async () => DEF },
      factory: recording as never,
      join,
    });

    const result = await mediation.reenterFromJoin(
      { runId },
      {
        agent: { name: "pin-agent-s2e", rootDir: FIXTURE_ROOT },
        task: "continue",
        engine: "mock",
      },
    );
    assert.equal(result.outcome.kind, "settled");
    assert.deepEqual(recorded, [{ engine: "mock" }]);
  });

  it("direct reenter reuses join record engine via sessionRef when no override", async () => {
    const join = new MemoryJoinStore();
    await join.put({
      runId: asRunId("direct-pin-1"),
      sessionRef: asSessionRef("prime-session"),
      definitionId: "pin-agent-s2e",
      packSnapshot: {
        planHash: "0".repeat(64),
        packs: [],
        createdAt: new Date().toISOString(),
      },
      status: "parked",
      engine: "prime",
      updatedAt: new Date().toISOString(),
    });

    const recorded: Array<{ engine?: string }> = [];
    const factory = makeFactory();
    const recording = {
      async materialize(def: AgentDefinition, opts?: MaterializeOptions) {
        recorded.push({ engine: opts?.engine });
        return factory.materialize(def, { ...opts, resume: asSessionRef("prime-session") });
      },
    };

    const mediation = new Mediation({
      loader: { load: async () => DEF },
      factory: recording as never,
      join,
    });

    const result = await mediation.reenter({
      agent: { name: "pin-agent-s2e", rootDir: FIXTURE_ROOT },
      sessionRef: asSessionRef("prime-session"),
      task: "continue",
    });
    assert.equal(result.outcome.kind, "settled");
    assert.deepEqual(recorded, [{ engine: "prime" }]);
  });

  it("leaf output engine matches the engine that drove materialize", async () => {
    const factory = makeFactory();
    const join = new MemoryJoinStore();
    const output = await runEngagementLeaf(
      {
        agentName: "pin-agent-s2e",
        agentRoot: FIXTURE_ROOT,
        task: "leaf pin",
        engine: "prime",
      },
      {
        factory,
        join,
        runId: asRunId("leaf-pin-1"),
        defaultEngine: "mock",
        resolveDefinition: () => DEF,
      },
    );
    assert.equal(output.kind, "settled");
    if (output.kind === "settled") {
      assert.equal(output.engine, "prime");
      assert.equal(output.sessionRef, "prime-session");
    }
    const record = await join.getByRunId(asRunId("leaf-pin-1"));
    assert.ok(record);
    assert.equal(record.engine, "prime");
  });
});
