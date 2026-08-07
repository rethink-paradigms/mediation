/**
 * OutcomeMapper — engine errors / idle / partial → RunOutcome (issue #5).
 *
 * Scenario suite (testing doctrine — scenario first, from real failure shapes):
 *   1. Engine throws (raw Error) during engage → Failed + sessionRef (the
 *      shape the presence catch produces — issue #1 park-wake engine failures).
 *   2. Engine reports MediationError with taxonomy code → code preserved
 *      (e.g. PARK_CONTINUE_FAILED from the Pi continue verb guard).
 *   3. Engine idle + no park intent → Settled (S2).
 *   4. Park intent after idle → Parked with reason / resumeToken / payload (S9).
 *   5. Missing capability at materialize → failed-closed, code preserved
 *      (CAPABILITY_RESOLVE_FAILED — the real CUT fail-closed path).
 *   6. No idle snapshot → policy denial Failed POLICY_VIOLATION.
 *   7. Explicit code wins over error.code / fallbackCode (caller taxonomy).
 *   8. withCause preserves the raw engine error for in-process diagnostics.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  outcomeFromError,
  outcomeFromIdle,
  OUTCOME_DEFAULT_CODE,
} from "../../src/app/outcomes.ts";
import { MediationError } from "../../src/domain/errors.ts";
import { asSessionRef, type RunOutcome, type SessionRef } from "../../src/domain/presence.ts";

const SREF = asSessionRef("scenario-1");

describe("OutcomeMapper — outcomeFromError (engine error → Failed)", () => {
  it("raw engine Error → Failed with sessionRef and ENGAGE_FAILED code", () => {
    const outcome = outcomeFromError({
      sessionRef: SREF,
      error: new Error("engine loop exploded"),
    });
    assert.equal(outcome.kind, "failed");
    if (outcome.kind === "failed") {
      assert.equal(outcome.sessionRef, SREF);
      assert.equal(outcome.error.message, "engine loop exploded");
      assert.equal(outcome.error.code, "ENGAGE_FAILED");
    }
  });

  it("MediationError taxonomy code is preserved through the mapper", () => {
    const engineErr = new MediationError(
      "PARK_CONTINUE_FAILED",
      "continue illegal after assistant tail",
    );
    const outcome = outcomeFromError({ sessionRef: SREF, error: engineErr });
    assert.equal(outcome.kind, "failed");
    if (outcome.kind === "failed") {
      assert.equal(outcome.error.code, "PARK_CONTINUE_FAILED");
      assert.equal(
        outcome.error.message,
        "continue illegal after assistant tail",
      );
    }
  });

  it("string error → Failed with message = string, default code", () => {
    const outcome = outcomeFromError({ error: "socket closed" });
    assert.equal(outcome.kind, "failed");
    if (outcome.kind === "failed") {
      assert.equal(outcome.error.message, "socket closed");
      assert.equal(outcome.error.code, OUTCOME_DEFAULT_CODE);
      // sessionRef absent when not provided (shape parity with inline sites)
      assert.equal("sessionRef" in outcome, false);
    }
  });

  it("missing capability → failed-closed, error code preserved over fallback", () => {
    // Real CUT path: factory.materialize throws MediationError
    // CAPABILITY_RESOLVE_FAILED; the leaf catches with fallbackCode
    // MATERIALIZE_FAILED — the mapper must keep the original code.
    const capErr = new MediationError(
      "CAPABILITY_RESOLVE_FAILED",
      "capability foo/missing not found",
    );
    const outcome = outcomeFromError({
      error: capErr,
      fallbackCode: "MATERIALIZE_FAILED",
    });
    assert.equal(outcome.kind, "failed");
    if (outcome.kind === "failed") {
      assert.equal(outcome.error.code, "CAPABILITY_RESOLVE_FAILED");
      assert.equal(outcome.error.message, "capability foo/missing not found");
    }
  });

  it("explicit code wins over error.code and fallbackCode", () => {
    const outcome = outcomeFromError({
      error: new MediationError("ENGAGE_FAILED", "denied"),
      code: "POLICY_VIOLATION",
    });
    assert.equal(outcome.kind, "failed");
    if (outcome.kind === "failed") {
      assert.equal(outcome.error.code, "POLICY_VIOLATION");
    }
  });

  it("withCause preserves the raw engine error for diagnostics", () => {
    const engineErr = new Error("raw engine failure");
    const outcome = outcomeFromError({
      sessionRef: SREF,
      error: engineErr,
      withCause: true,
    });
    assert.equal(outcome.kind, "failed");
    if (outcome.kind === "failed") {
      assert.equal(outcome.error.cause, engineErr);
    }
  });

  it("without withCause the failure stays JSON-safe (no cause, no sessionRef)", () => {
    const outcome = outcomeFromError({ error: new Error("boom") });
    const wire = JSON.parse(JSON.stringify(outcome)) as RunOutcome;
    assert.equal(wire.kind, "failed");
    if (wire.kind === "failed") {
      assert.equal(wire.error.code, "ENGAGE_FAILED");
      assert.equal("cause" in wire.error, false);
    }
  });
});

describe("OutcomeMapper — outcomeFromIdle (engine idle → Settled | Parked | Failed)", () => {
  it("idle + no park intent → Settled", () => {
    const outcome = outcomeFromIdle({
      sessionRef: SREF,
      idle: { at: "2026-01-01T00:00:00.000Z" },
    });
    assert.equal(outcome.kind, "settled");
    if (outcome.kind === "settled") {
      assert.equal(outcome.sessionRef, SREF);
    }
  });

  it("idle + park intent → Parked with reason, resumeToken, payload", () => {
    const outcome = outcomeFromIdle({
      sessionRef: SREF,
      idle: { at: "2026-01-01T00:00:00.000Z" },
      parkIntent: true,
      parkReason: "await_human",
      text: "need human",
      mode: "prompt",
    });
    assert.equal(outcome.kind, "parked");
    if (outcome.kind === "parked") {
      assert.equal(outcome.sessionRef, SREF);
      assert.equal(outcome.reason, "await_human");
      assert.ok(
        outcome.resumeToken.startsWith(`park:${SREF}:`),
        `resumeToken shape, got ${outcome.resumeToken}`,
      );
      assert.deepEqual(outcome.payload, { text: "need human", mode: "prompt" });
    }
  });

  it("park intent without reason → default park_intent reason", () => {
    const outcome = outcomeFromIdle({
      sessionRef: SREF,
      idle: { at: "2026-01-01T00:00:00.000Z" },
      parkIntent: true,
    });
    assert.equal(outcome.kind, "parked");
    if (outcome.kind === "parked") {
      assert.equal(outcome.reason, "park_intent");
    }
  });

  it("injected resumeToken is honored (deterministic tests)", () => {
    const outcome = outcomeFromIdle({
      sessionRef: SREF,
      idle: { at: "2026-01-01T00:00:00.000Z" },
      parkIntent: true,
      resumeToken: "park:fixed:token",
    });
    assert.equal(outcome.kind, "parked");
    if (outcome.kind === "parked") {
      assert.equal(outcome.resumeToken, "park:fixed:token");
    }
  });

  it("missing idle snapshot → failed-closed policy denial", () => {
    const outcome = outcomeFromIdle({
      sessionRef: SREF,
      idle: undefined,
    });
    assert.equal(outcome.kind, "failed");
    if (outcome.kind === "failed") {
      assert.equal(outcome.error.code, "POLICY_VIOLATION");
      assert.match(outcome.error.message, /no_idle_snapshot/u);
      assert.equal(outcome.sessionRef, SREF);
    }
  });
});

describe("OutcomeMapper — settle policy parity", () => {
  it("matches evaluateSettled allow/deny on the same inputs", async () => {
    const { evaluateSettled } = await import("../../src/app/settled-policy.ts");
    for (const parkIntent of [false, true]) {
      const idle = { at: "2026-01-01T00:00:00.000Z" };
      const decision = evaluateSettled({ idle, parkIntent });
      const outcome = outcomeFromIdle({
        sessionRef: asSessionRef("parity") as SessionRef,
        idle,
        parkIntent,
      });
      if (decision.allow) {
        assert.equal(outcome.kind, "settled");
      } else {
        assert.equal(outcome.kind, parkIntent ? "parked" : "failed");
      }
    }
  });
});
