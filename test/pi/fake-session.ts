/**
 * Thin fake of Pi AgentSession surface for adapter unit tests only.
 * Not an EnginePort — proves PiEngineSessionHandle mapping without live Pi.
 */

import type {
  PiSessionEvent,
  PiSessionSurface,
} from "../../src/adapters/pi/types.ts";

export type FakePiSessionOptions = {
  sessionId?: string;
  sessionFile?: string;
  /** Delay before agent_settled after prompt (ms). Default 0 (microtask). */
  settleDelayMs?: number;
  /** If true, agent.continue is available. */
  withAgentContinue?: boolean;
};

export class FakePiSession implements PiSessionSurface {
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  isStreaming = false;
  readonly agent: {
    continue?: () => Promise<void>;
    waitForIdle?: () => Promise<void>;
  };

  private listeners = new Set<(e: PiSessionEvent) => void>();
  private disposed = false;
  private settleDelayMs: number;
  private idleResolvers: Array<() => void> = [];
  private waitForIdleCalls = 0;
  promptCalls: string[] = [];
  steerCalls: string[] = [];
  followUpCalls: string[] = [];
  abortCalls = 0;
  continueCalls = 0;

  constructor(opts: FakePiSessionOptions = {}) {
    this.sessionId = opts.sessionId ?? "fake-session-id";
    this.sessionFile = opts.sessionFile;
    this.settleDelayMs = opts.settleDelayMs ?? 0;
    const self = this;
    this.agent = {
      waitForIdle: () => self.waitForIdle(),
    };
    if (opts.withAgentContinue !== false) {
      this.agent.continue = async () => {
        self.continueCalls += 1;
        self.scheduleSettle();
      };
    }
  }

  private emit(e: PiSessionEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        // ignore
      }
    }
  }

  private scheduleSettle(): void {
    this.isStreaming = true;
    this.emit({ type: "agent_start" });
    const finish = () => {
      if (this.disposed) return;
      this.emit({ type: "agent_end", willRetry: false, messages: [] });
      this.emit({ type: "agent_settled" });
      this.isStreaming = false;
      const resolvers = this.idleResolvers.splice(0);
      for (const r of resolvers) r();
    };
    if (this.settleDelayMs <= 0) {
      queueMicrotask(finish);
    } else {
      setTimeout(finish, this.settleDelayMs);
    }
  }

  async prompt(text: string): Promise<void> {
    if (this.disposed) throw new Error("FakePiSession: disposed");
    this.promptCalls.push(text);
    this.scheduleSettle();
  }

  async steer(text: string): Promise<void> {
    this.steerCalls.push(text);
  }

  async followUp(text: string): Promise<void> {
    this.followUpCalls.push(text);
  }

  async abort(): Promise<void> {
    this.abortCalls += 1;
    this.isStreaming = false;
    this.emit({ type: "agent_settled" });
    const resolvers = this.idleResolvers.splice(0);
    for (const r of resolvers) r();
  }

  async waitForIdle(): Promise<void> {
    this.waitForIdleCalls += 1;
    if (!this.isStreaming) return;
    await new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  subscribe(listener: (event: PiSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.idleResolvers.splice(0);
  }

  get waitForIdleCallCount(): number {
    return this.waitForIdleCalls;
  }
}
