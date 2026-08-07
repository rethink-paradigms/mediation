/**
 * Unit: Prime event → EngineEvent mapping (no prime-agent SDK required).
 * Fork deltas vs Pi: no agent_settled; agent_end has messages (no willRetry);
 * idle via waitForIdle / mapAgentEndAsIdle; auto_retry_end failure → error.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapPrimeEvent } from "../../src/adapters/prime/event-map.ts";

describe("mapPrimeEvent", () => {
  it("agent_end default → raw (no agent_settled on fork; idle via waitForIdle)", () => {
    const events = mapPrimeEvent({ type: "agent_end", messages: [] });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "raw");
    if (events[0]?.type === "raw") {
      assert.equal(events[0].name, "agent_end");
    }
  });

  it("agent_end + mapAgentEndAsIdle → idle", () => {
    const events = mapPrimeEvent(
      { type: "agent_end", messages: [] },
      { mapAgentEndAsIdle: true },
    );
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "idle");
    if (events[0]?.type === "idle") {
      assert.equal(events[0].snapshot.reason, "agent_end");
      assert.ok(events[0].snapshot.at);
    }
  });

  it("agent_start → raw", () => {
    const events = mapPrimeEvent({ type: "agent_start" });
    assert.equal(events[0]?.type, "raw");
    if (events[0]?.type === "raw") {
      assert.equal(events[0].name, "agent_start");
    }
  });

  it("message_update text_delta → assistant message", () => {
    const events = mapPrimeEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hi" },
    });
    assert.deepEqual(events[0], {
      type: "message",
      role: "assistant",
      text: "hi",
    });
  });

  it("message_update non-text event → raw", () => {
    const events = mapPrimeEvent({
      type: "message_update",
      assistantMessageEvent: { type: "reasoning_delta", delta: "hmm" },
    });
    assert.equal(events[0]?.type, "raw");
  });

  it("message_end extracts text content blocks", () => {
    const events = mapPrimeEvent({
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

  it("tool_execution_start/end → tool phases", () => {
    const start = mapPrimeEvent({
      type: "tool_execution_start",
      toolName: "ipython",
      toolCallId: "call-1",
    });
    assert.deepEqual(start[0], {
      type: "tool",
      name: "ipython",
      phase: "start",
    });
    const end = mapPrimeEvent({
      type: "tool_execution_end",
      toolName: "ipython",
      toolCallId: "call-1",
      isError: false,
    });
    assert.deepEqual(end[0], { type: "tool", name: "ipython", phase: "end" });
  });

  it("auto_retry_end failure → error", () => {
    const events = mapPrimeEvent({
      type: "auto_retry_end",
      success: false,
      attempt: 2,
      finalError: "rate limited",
    });
    assert.deepEqual(events[0], {
      type: "error",
      message: "rate limited",
    });
  });

  it("auto_retry_end success → raw", () => {
    const events = mapPrimeEvent({
      type: "auto_retry_end",
      success: true,
      attempt: 2,
    });
    assert.equal(events[0]?.type, "raw");
    if (events[0]?.type === "raw") {
      assert.equal(events[0].name, "auto_retry_end");
    }
  });

  it("session events (compaction_start, thinking_level_changed) → raw", () => {
    const events = mapPrimeEvent({ type: "compaction_start", reason: "threshold" });
    assert.equal(events[0]?.type, "raw");
    if (events[0]?.type === "raw") {
      assert.equal(events[0].name, "compaction_start");
    }
  });

  it("unknown event → raw passthrough", () => {
    const events = mapPrimeEvent({ type: "session_info_changed", name: "x" });
    assert.equal(events[0]?.type, "raw");
    if (events[0]?.type === "raw") {
      assert.equal(events[0].name, "session_info_changed");
    }
  });
});
