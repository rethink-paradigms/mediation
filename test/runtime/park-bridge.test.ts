/**
 * ParkBridge — pure unit tests (D1 §4.3 / D2 tier-2 default).
 *
 * Scenarios:
 *   (e) bridge content contains whatWasAwaited + payload
 *   empty payload still carries the wait contract
 *   empty whatWasAwaited falls back to neutral wait-contract prose
 *   deterministic (same inputs → same text)
 *   hasParkBridge distinguishes bare continue from bridge continue
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildParkBridge,
  hasParkBridge,
  PARK_BRIDGE_DEFAULT_WAIT,
} from "../../src/domain/park-bridge.ts";

describe("ParkBridge (D1 §4.3 pure bridge)", () => {
  it("(e) bridge text contains whatWasAwaited and the payload", () => {
    const { text } = buildParkBridge({
      whatWasAwaited: "await_human_approval",
      payload: "human approved the plan",
    });
    assert.match(text, /await_human_approval/u);
    assert.match(text, /human approved the plan/u);
    // wait contract comes before the response (D2 shape)
    assert.ok(
      text.indexOf("await_human_approval") < text.indexOf("human approved the plan"),
      "wait contract must precede the response",
    );
  });

  it("empty payload still carries the wait contract (no response)", () => {
    const { text } = buildParkBridge({
      whatWasAwaited: "waiting on upstream build",
      payload: "",
    });
    assert.match(text, /waiting on upstream build/u);
    assert.match(text, /No new payload/u);
  });

  it("empty whatWasAwaited falls back to neutral wait-contract prose", () => {
    const { text } = buildParkBridge({
      whatWasAwaited: "   ",
      payload: "proceed",
    });
    assert.match(text, new RegExp(PARK_BRIDGE_DEFAULT_WAIT, "u"));
    assert.match(text, /proceed/u);
  });

  it("is deterministic (same inputs → identical text)", () => {
    const input = { whatWasAwaited: "review", payload: "done" };
    assert.equal(buildParkBridge(input).text, buildParkBridge(input).text);
    const other = buildParkBridge({ whatWasAwaited: "review", payload: "no" });
    assert.notEqual(other.text, buildParkBridge(input).text);
  });

  it("hasParkBridge distinguishes bare continue from bridge continue", () => {
    assert.equal(hasParkBridge(), false);
    assert.equal(hasParkBridge(""), false);
    assert.equal(hasParkBridge("   "), false);
    assert.equal(hasParkBridge("proceed"), true);
  });
});
