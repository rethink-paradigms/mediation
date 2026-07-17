/**
 * Unit: Pi event → EngineEvent mapping (no Pi SDK required).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapPiEvent } from "../../src/adapters/pi/event-map.ts";

describe("mapPiEvent", () => {
  it("agent_settled → idle", () => {
    const events = mapPiEvent({ type: "agent_settled" });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "idle");
    if (events[0]?.type === "idle") {
      assert.equal(events[0].snapshot.reason, "agent_settled");
      assert.ok(events[0].snapshot.at);
    }
  });

  it("agent_end willRetry=true → raw, not idle", () => {
    const events = mapPiEvent({ type: "agent_end", willRetry: true });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "raw");
    if (events[0]?.type === "raw") {
      assert.equal(events[0].name, "agent_end");
    }
  });

  it("agent_end willRetry=false default → raw (prefer agent_settled)", () => {
    const events = mapPiEvent({ type: "agent_end", willRetry: false });
    assert.equal(events[0]?.type, "raw");
  });

  it("agent_end willRetry=false + mapAgentEndAsIdle → idle", () => {
    const events = mapPiEvent(
      { type: "agent_end", willRetry: false },
      { mapAgentEndAsIdle: true },
    );
    assert.equal(events[0]?.type, "idle");
    if (events[0]?.type === "idle") {
      assert.equal(events[0].snapshot.reason, "agent_end");
    }
  });

  it("tool_execution_start/end → tool phases", () => {
    const start = mapPiEvent({
      type: "tool_execution_start",
      toolName: "read",
    });
    assert.deepEqual(start[0], {
      type: "tool",
      name: "read",
      phase: "start",
    });
    const end = mapPiEvent({
      type: "tool_execution_end",
      toolName: "read",
    });
    assert.deepEqual(end[0], { type: "tool", name: "read", phase: "end" });
  });

  it("message_update text_delta → assistant message", () => {
    const events = mapPiEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hi" },
    });
    assert.deepEqual(events[0], {
      type: "message",
      role: "assistant",
      text: "hi",
    });
  });

  it("message_end extracts text content blocks", () => {
    const events = mapPiEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
      },
    });
    assert.equal(events[0]?.type, "message");
    if (events[0]?.type === "message") {
      assert.equal(events[0].role, "assistant");
      assert.equal(events[0].text, "done");
    }
  });
});
