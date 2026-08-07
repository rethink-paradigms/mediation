/**
 * Map prime-agent (fork) AgentSession events → mediation EngineEvent.
 *
 * Fork deltas vs Pi event map:
 * - NO agent_settled event. Idle is driven by session.waitForIdle() (the
 *   handle's primary wait primitive); agent_end maps to raw by default and
 *   to idle only when `mapAgentEndAsIdle` is true.
 * - agent_end has NO willRetry (fork AgentEvent: agent_end { messages }).
 * - message_update text_delta → message; tool_execution_start/end → tool;
 *   auto_retry_end failure → error.
 */

import type { EngineEvent, IdleSnapshot } from "../../ports/engine.ts";
import type { PrimeSessionEvent } from "./types.ts";

export type MapPrimeEventOptions = {
  /**
   * When true, agent_end also emits idle (fork has no agent_settled; the
   * handle drives idle via session.waitForIdle() by default).
   * Default false.
   */
  readonly mapAgentEndAsIdle?: boolean;
};

/** Narrow the fork's loosely-typed `message` field (AgentMessage | KernelSentAgentMessage | …). */
function messageShape(message: unknown): { role?: string; content?: unknown } | undefined {
  if (!message || typeof message !== "object") return undefined;
  const m = message as { role?: unknown; content?: unknown };
  if (!("role" in m) && !("content" in m)) return undefined;
  return {
    role: typeof m.role === "string" ? m.role : undefined,
    content: m.content,
  };
}

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
 * Map one Prime session event to zero or more EngineEvents.
 */
export function mapPrimeEvent(
  event: PrimeSessionEvent,
  opts: MapPrimeEventOptions = {},
): EngineEvent[] {
  const mapAgentEndAsIdle = opts.mapAgentEndAsIdle === true;
  switch (event.type) {
    case "agent_end": {
      if (mapAgentEndAsIdle) {
        const snapshot: IdleSnapshot = {
          at: new Date().toISOString(),
          reason: "agent_end",
        };
        return [{ type: "idle", snapshot }];
      }
      return [{ type: "raw", name: "agent_end", data: event }];
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
      const msg = messageShape(event.message);
      const role = msg?.role ?? "unknown";
      const text = textFromContent(msg?.content);
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
