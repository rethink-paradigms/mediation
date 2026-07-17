/**
 * Internal Pi session surface used by the adapter.
 * Production: real AgentSession from @earendil-works/pi-coding-agent.
 * Unit tests: thin fake of this surface only (not a second EnginePort).
 */

import type { OpenSessionRequest } from "../../ports/engine.ts";

/** Minimal Pi event shape we map (session.subscribe). */
export type PiSessionEvent = {
  readonly type: string;
  readonly messages?: readonly unknown[];
  readonly willRetry?: boolean;
  readonly toolName?: string;
  readonly isError?: boolean;
  readonly message?: {
    readonly role?: string;
    readonly content?: unknown;
  };
  readonly assistantMessageEvent?: {
    readonly type?: string;
    readonly delta?: string;
  };
  readonly errorMessage?: string;
  readonly [key: string]: unknown;
};

/**
 * Session methods/properties EnginePort needs from Pi AgentSession (0.80+).
 */
export type PiSessionSurface = {
  prompt(
    text: string,
    options?: {
      images?: readonly unknown[];
      streamingBehavior?: "steer" | "followUp";
      expandPromptTemplates?: boolean;
    },
  ): Promise<void>;
  steer(text: string, images?: readonly unknown[]): Promise<void>;
  followUp(text: string, images?: readonly unknown[]): Promise<void>;
  abort(): Promise<void>;
  /** Pi 0.80+: resolves when agent will not continue automatically (agent_settled). */
  waitForIdle(): Promise<void>;
  subscribe(listener: (event: PiSessionEvent) => void): () => void;
  dispose(): void;
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
    onError?: (err: { extensionPath: string; message?: string }) => void;
  }): Promise<void>;
};

/** Result of opening a real or test Pi session. */
export type OpenedPiSession = {
  readonly session: PiSessionSurface;
  readonly sessionRefValue: string;
};

/**
 * Factory that opens a Pi session for an OpenSessionRequest.
 * Default production impl uses createAgentSession (only under adapters/pi).
 */
export type PiSessionFactory = (
  req: OpenSessionRequest,
) => Promise<OpenedPiSession>;

export type PiEngineAdapterOptions = {
  /** Override session open (unit tests inject a thin fake). */
  readonly sessionFactory?: PiSessionFactory;
  /**
   * Auth file path for live runs. Default: ~/.pi/agent/auth.json via getAgentDir.
   * Unit path with real createAgentSession can pass undefined + in-memory auth.
   */
  readonly authPath?: string;
  /** Prefer in-memory SessionManager (default true for mediation-owned D2). */
  readonly inMemorySession?: boolean;
  /** Optional logger for diagnostics. */
  readonly log?: (level: string, msg: string, data?: Record<string, unknown>) => void;
};
