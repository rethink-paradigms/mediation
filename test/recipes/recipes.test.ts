/**
 * ABS-B3: experience recipes — thin wrappers over Mediation.
 * Mock Mediation-compatible setup (MockEnginePort / mock RuntimePort).
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { MockEnginePort } from "../../src/adapters/mock/engine-adapter.ts";
import { toPackSnapshot } from "../../src/adapters/packs/pack-snapshot.ts";
import { agentDefForPacks } from "../../src/adapters/packs/resolve-packs.ts";
import { DefaultPresenceFactory } from "../../src/app/factory.ts";
import { Mediation } from "../../src/app/mediation.ts";
import { dispatch } from "../../src/app/recipes/dispatch.ts";
import { plan } from "../../src/app/recipes/plan.ts";
import { reenter } from "../../src/app/recipes/reenter.ts";
import { solo } from "../../src/app/recipes/solo.ts";
import type { Recipe, RecipeContext } from "../../src/app/recipes/types.ts";
import { asRunId } from "../../src/domain/engagement.ts";
import { asSessionRef } from "../../src/domain/presence.ts";
import type {
  DispatchHandle,
  DispatchInput,
  PlanSpec,
  RuntimePort,
  RuntimeStatus,
} from "../../src/ports/runtime.ts";
import { createFsCapabilityStore } from "../../src/adapters/capability/fs-store.ts";
import { createCapabilityResolver } from "../../src/adapters/capability/resolve.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/packs/case-basic");
const NO_HOME = path.join(FIXTURE_ROOT, "_no_home");

function makeLocalMediation(sessionRef = "recipe-sess"): Mediation {
  const factory = new DefaultPresenceFactory({
    engine: new MockEnginePort({
      sessionRefFactory: () => asSessionRef(sessionRef),
    }),
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
  return new Mediation({ loader, factory });
}

function makeMockRuntime(opts?: {
  status?: RuntimeStatus;
}): RuntimePort {
  const statuses = new Map<string, RuntimeStatus>();
  return {
    async dispatch(input: DispatchInput): Promise<DispatchHandle> {
      const runId = asRunId(
        input.clientRequestId ?? `run-${statuses.size + 1}`,
      );
      statuses.set(
        runId,
        opts?.status ?? { state: "completed", result: { kind: "settled" } },
      );
      return { runId };
    },
    async runPlan(planSpec: PlanSpec): Promise<DispatchHandle> {
      const runId = asRunId(`plan-${planSpec.id}`);
      statuses.set(
        runId,
        opts?.status ?? {
          state: "completed",
          result: { kind: "settled", planId: planSpec.id },
        },
      );
      return { runId };
    },
    async sendSignal(): Promise<void> {},
    async cancel(): Promise<void> {},
    async getStatus(runId) {
      return statuses.get(runId) ?? { state: "pending" };
    },
    async wait(runId) {
      return statuses.get(runId) ?? { state: "pending" };
    },
  };
}

function makeMediationWithRuntime(runtime: RuntimePort): Mediation {
  const factory = new DefaultPresenceFactory({
    engine: new MockEnginePort({
      sessionRefFactory: () => asSessionRef("recipe-rt-sess"),
    }),
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
  return new Mediation({ loader, factory, runtime });
}

describe("ABS-B3 Recipe interface", () => {
  it("Recipe shape: name + run(ctx, input)", async () => {
    const probe: Recipe<string, string> = {
      name: "probe",
      async run(_ctx, input) {
        return `ok:${input}`;
      },
    };
    assert.equal(probe.name, "probe");
    const mediation = makeLocalMediation();
    const ctx: RecipeContext = { mediation };
    assert.equal(await probe.run(ctx, "x"), "ok:x");
  });
});

describe("ABS-B3 solo recipe", () => {
  it("solo → engageLocal Settled", async () => {
    const mediation = makeLocalMediation("solo-sess");
    const result = await solo.run(
      { mediation },
      {
        agent: { name: "solo-agent", rootDir: FIXTURE_ROOT },
        task: "hello solo",
      },
    );
    assert.equal(solo.name, "solo");
    assert.equal(result.outcome.kind, "settled");
    assert.equal(result.sessionRef, "solo-sess");
    assert.equal(typeof result.packSnapshotHash, "string");
    assert.equal(result.definitionId, "solo-agent");
  });
});

describe("ABS-B3 reenter recipe", () => {
  it("reenter → same sessionRef + pack gate match", async () => {
    const mediation = makeLocalMediation("reenter-sess");
    const agent = { name: "reenter-agent", rootDir: FIXTURE_ROOT };
    const first = await solo.run(
      { mediation },
      { agent, task: "first" },
    );
    assert.equal(first.outcome.kind, "settled");

    const again = await reenter.run(
      { mediation },
      {
        agent,
        sessionRef: asSessionRef(first.sessionRef!),
        task: "second",
        expectedPackSnapshotHash: first.packSnapshotHash,
      },
    );
    assert.equal(reenter.name, "reenter");
    assert.equal(again.packSnapshotMatch, true);
    assert.equal(again.outcome.kind, "settled");
    assert.equal(again.sessionRef, "reenter-sess");
  });
});

describe("ABS-B3 dispatch recipe", () => {
  it("dispatch without wait returns handle only", async () => {
    const runtime = makeMockRuntime();
    const mediation = makeMediationWithRuntime(runtime);
    const result = await dispatch.run(
      { mediation },
      {
        agent: { name: "d-agent", rootDir: FIXTURE_ROOT },
        task: "durable",
        clientRequestId: "abs-b3-dispatch-1",
      },
    );
    assert.equal(dispatch.name, "dispatch");
    assert.equal(result.handle.runId, "abs-b3-dispatch-1");
    assert.equal(result.status, undefined);
  });

  it("dispatch + wait returns terminal status", async () => {
    const runtime = makeMockRuntime({
      status: { state: "completed", result: { ok: true } },
    });
    const mediation = makeMediationWithRuntime(runtime);
    const result = await dispatch.run(
      { mediation },
      {
        agent: { name: "d-agent", rootDir: FIXTURE_ROOT },
        task: "durable-wait",
        clientRequestId: "abs-b3-dispatch-wait",
        wait: true,
      },
    );
    assert.equal(result.handle.runId, "abs-b3-dispatch-wait");
    assert.equal(result.status?.state, "completed");
  });

  it("dispatch without runtime throws", async () => {
    const mediation = makeLocalMediation();
    await assert.rejects(
      () =>
        dispatch.run(
          { mediation },
          {
            agent: { name: "x", rootDir: FIXTURE_ROOT },
            task: "nope",
          },
        ),
      /no RuntimePort/,
    );
  });
});

describe("ABS-B3 plan recipe", () => {
  it("plan → runPlan when runtime present", async () => {
    const runtime = makeMockRuntime();
    const mediation = makeMediationWithRuntime(runtime);
    const planSpec: PlanSpec = {
      id: "plan-abs-b3",
      nodes: [
        {
          id: "n1",
          agent: { name: "p-agent", rootDir: FIXTURE_ROOT },
          task: "step",
        },
      ],
    };
    const handle = await plan.run({ mediation }, planSpec);
    assert.equal(plan.name, "plan");
    assert.equal(handle.runId, "plan-plan-abs-b3");
  });

  it("plan without runtime throws", async () => {
    const mediation = makeLocalMediation();
    await assert.rejects(
      () =>
        plan.run(
          { mediation },
          {
            id: "missing-rt",
            nodes: [
              {
                id: "n1",
                agent: { name: "x", rootDir: FIXTURE_ROOT },
                task: "t",
              },
            ],
          },
        ),
      /no RuntimePort/,
    );
  });
});
