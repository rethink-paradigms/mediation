/**
 * Map Pi AgentSession events → mediation EngineEvent.
 *
 * Idle policy (normative for waitUntilIdle / evidence):
 * - Prefer Pi `agent_settled` as true mediation idle (agent will not auto-continue).
 * - `agent_end` with willRetry=true is NOT idle (retry/compaction may continue).
 * - `agent_end` with willRetry=false maps to a provisional idle only when
 *   `mapAgentEndAsIdle` is true; default false — settle on agent_settled only.
 * - Session-level `waitForIdle()` is the primary wait primitive (Pi 0.80+);
 *   event map still emits EngineEvent idle for subscribe observers.
 */

import type { EngineEvent, IdleSnapshot } from "../../ports/engine.ts";
import type { PiSessionEvent } from "./types.ts";

export type MapPiEventOptions = {
  /**
   * When true, agent_end (willRetry=false) also emits idle.
   * Default false — prefer agent_settled only (blueprint: not merely agent_end).
   */
  readonly mapAgentEndAsIdle?: boolean;
};

function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      "type" in block &&
      (block as { type: string }).type === "text" &&
      "text" in block &&
      typeof (block as { text: unknown }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.length > 0 ? parts.join("") : undefined;
}

/**
 * Map one Pi session event to zero or more EngineEvents.
 */
export function mapPiEvent(
  event: PiSessionEvent,
  opts: MapPiEventOptions = {},
): EngineEvent[] {
  const mapAgentEndAsIdle = opts.mapAgentEndAsIdle === true;
  switch (event.type) {
    case "agent_settled": {
      const snapshot: IdleSnapshot = {
        at: new Date().toISOString(),
        reason: "agent_settled",
      };
      return [{ type: "idle", snapshot }];
    }
    case "agent_end": {
      if (event.willRetry === true) {
        return [{ type: "raw", name: "agent_end", data: { willRetry: true } }];
      }
      if (mapAgentEndAsIdle) {
        const snapshot: IdleSnapshot = {
          at: new Date().toISOString(),
          reason: "agent_end",
        };
        return [{ type: "idle", snapshot }];
      }
      return [{ type: "raw", name: "agent_end", data: { willRetry: false } }];
    }
    case "agent_start":
      return [{ type: "raw", name: "agent_start" }];
    case "message_update": {
      const delta = event.assistantMessageEvent?.delta;
      if (
        event.assistantMessageEvent?.type === "text_delta" &&
        typeof delta === "string"
      ) {
        return [{ type: "message", role: "assistant", text: delta }];
      }
      return [{ type: "raw", name: "message_update", data: event.assistantMessageEvent }];
    }
    case "message_end": {
      const role = event.message?.role ?? "unknown";
      const text = textFromContent(event.message?.content);
      return [{ type: "message", role, text }];
    }
    case "tool_execution_start":
      return [
        {
          type: "tool",
          name: typeof event.toolName === "string" ? event.toolName : "unknown",
          phase: "start",
        },
      ];
    case "tool_execution_end":
      return [
        {
          type: "tool",
          name: typeof event.toolName === "string" ? event.toolName : "unknown",
          phase: "end",
        },
      ];
    case "auto_retry_end": {
      if (event.success === false && typeof event.finalError === "string") {
        return [{ type: "error", message: event.finalError }];
      }
      return [{ type: "raw", name: event.type, data: event }];
    }
    default:
      return [{ type: "raw", name: event.type, data: event }];
  }
}
