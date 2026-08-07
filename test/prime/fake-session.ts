/**
 * Thin fake of prime-agent AgentSession surface for adapter unit tests only.
 * Not an EnginePort — proves PrimeEngineSessionHandle mapping without live
 * prime-agent.
 *
 * Fork event deltas vs FakePiSession: NO agent_settled, agent_end carries
 * `messages` (no willRetry). Idle is observable via waitForIdle() resolution.
 */

import type {
  PrimeSessionEvent,
  PrimeSessionSurface,
} from "../../src/adapters/prime/types.ts";

export type FakePrimeSessionOptions = {
  sessionId?: string;
  sessionFile?: string;
  /** Delay before agent_end after prompt (ms). Default 0 (microtask). */
  settleDelayMs?: number;
  /** If true, agent.continue is available. */
  withAgentContinue?: boolean;
};

export class FakePrimeSession implements PrimeSessionSurface {
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  isStreaming = false;
  readonly agent: {
    continue?: () => Promise<void>;
    waitForIdle?: () => Promise<void>;
  };

  private listeners = new Set<(e: PrimeSessionEvent) => void>();
  private disposed = false;
  private settleDelayMs: number;
  private idleResolvers: Array<() => void> = [];
  private waitForIdleCalls = 0;
  promptCalls: string[] = [];
  steerCalls: string[] = [];
  followUpCalls: string[] = [];
  abortCalls = 0;
  continueCalls = 0;

  constructor(opts: FakePrimeSessionOptions = {}) {
    this.sessionId = opts.sessionId ?? "fake-prime-session-id";
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

  private emit(e: PrimeSessionEvent): void {
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
      this.emit({ type: "agent_end", messages: [] });
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
    if (this.disposed) throw new Error("FakePrimeSession: disposed");
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

  subscribe(listener: (event: PrimeSessionEvent) => void): () => void {
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
