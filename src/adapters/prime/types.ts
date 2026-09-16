/**
 * Internal Prime session surface used by the adapter.
 * Production: real AgentSession from prime-agent (fork AgentSession).
 * Unit tests: thin fake of this surface only (not a second EnginePort).
 */

import type { OpenSessionRequest } from "../../ports/engine.ts";

export type AuthStorageLike = unknown;
export type ModelRegistryLike = {
  getAll(): readonly { provider: string; id: string; [key: string]: unknown }[];
  [key: string]: unknown;
};

/**
 * Minimal Prime event shape we map (session.subscribe).
 * Fork AgentEvent deltas vs Pi:
 *   - NO agent_settled event (idle comes from session.waitForIdle()).
 *   - agent_end carries `messages` (NO willRetry).
 *   - message_update carries assistantMessageEvent; message_end carries message.
 *   - Session events: auto_retry_start/end, compaction_start/end,
 *     session_info_changed, thinking_level_changed, service_tier_changed,
 *     ipython_sent_agent_message, session_action_update.
 */
export type PrimeSessionEvent = {
  readonly type: string;
  readonly messages?: readonly unknown[];
  readonly success?: boolean;
  readonly attempt?: number;
  readonly finalError?: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly isError?: boolean;
  /**
   * unknown on purpose: the fork's `message` field is AgentMessage for
   * turn_end/message_end but KernelSentAgentMessage for
   * ipython_sent_agent_message — event-map narrows when extracting text.
   */
  readonly message?: unknown;
  readonly assistantMessageEvent?: {
    readonly type?: string;
    readonly delta?: string;
  };
  readonly errorMessage?: string;
  readonly [key: string]: unknown;
};

/**
 * Session methods/properties EnginePort needs from prime-agent AgentSession
 * (fork). Structurally satisfied by the real fork AgentSession.
 */
export type PrimeSessionSurface = {
  prompt(
    text: string,
    options?: {
      images?: readonly unknown[];
      streamingBehavior?: "steer" | "followUp";
      expandPromptTemplates?: boolean;
    },
  ): Promise<void>;
  steer(text: string, images?: readonly unknown[]): Promise<void>;
  /** Fork AgentSession.followUp returns Promise<boolean> — surface stays loose. */
  followUp(text: string, images?: readonly unknown[]): Promise<unknown>;
  abort(): Promise<void>;
  /** Fork: resolves once agent is idle after awaited agent_end listeners settle. */
  waitForIdle(): Promise<void>;
  subscribe(listener: (event: PrimeSessionEvent) => void): () => void;
  dispose(): void;
  disposeAsync?(): Promise<void>;
  readonly sessionFile?: string | undefined;
  readonly sessionId: string;
  readonly isStreaming: boolean;
  readonly agent?: {
    continue?: () => Promise<void>;
    waitForIdle?: () => Promise<void>;
  };
  setActiveToolsByName?(names: string[]): void;
  getActiveToolNames?(): string[];
  bindExtensions?(bindings: {
    onError?: (err: { extensionPath: string; message?: string; error?: string }) => void;
  }): Promise<void>;
};

/** Result of opening a real or test Prime session. */
export type OpenedPrimeSession = {
  readonly session: PrimeSessionSurface;
  readonly sessionRefValue: string;
};

/**
 * Factory that opens a Prime session for an OpenSessionRequest.
 * Default production impl uses createAgentSession (only under adapters/prime).
 */
export type PrimeSessionFactory = (
  req: OpenSessionRequest,
) => Promise<OpenedPrimeSession>;

export type PrimeEngineAdapterOptions = {
  /** Override session open (unit tests inject a thin fake). */
  readonly sessionFactory?: PrimeSessionFactory;
  /**
   * Auth file path for live runs. Default: ~/.prime/agent/auth.json via
   * getAgentDir (fork config dir, unlike Pi's ~/.pi/agent).
   */
  readonly authPath?: string;
  /** Auth storage override (unit path: AuthStorage.inMemory). */
  readonly authStorage?: AuthStorageLike;
  /** Model registry override (unit path: ModelRegistry.inMemory). */
  readonly modelRegistry?: ModelRegistryLike;
  /** Prefer in-memory SessionManager (default true for mediation-owned D2). */
  readonly inMemorySession?: boolean;
  /** Optional logger for diagnostics. */
  readonly log?: (level: string, msg: string, data?: Record<string, unknown>) => void;
};
