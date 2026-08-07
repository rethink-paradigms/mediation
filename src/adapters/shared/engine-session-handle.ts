/**
 * Engine-agnostic session handle over any vendor session surface.
 *
 * Extracted from the Pi adapter handle (src/adapters/pi/session-handle.ts) so
 * Pi and Prime share one waitUntilIdle / busy / event-fanout implementation.
 * The only engine-specific parts are injected:
 *   - `session`: a structural surface (prompt/steer/followUp/abort/subscribe/…)
 *   - `mapEvent`: vendor event → mediation EngineEvent[]
 *   - `mapAgentEndAsIdle`: whether agent_end maps to idle (Pi: default false,
 *     settle on agent_settled; Prime: no agent_settled exists, idle is driven by
 *     session.waitForIdle() or mapAgentEndAsIdle).
 *
 * Idle policy (normative for waitUntilIdle / evidence):
 * - `session.waitForIdle()` is the primary wait primitive (both SDKs 0.80+ /
 *   fork); the event map still emits EngineEvent idle for subscribe observers.
 * - agent_end maps to raw by default; mapAgentEndAsIdle=true also emits idle.
 */

import { asSessionRef, type SessionRef } from "../../domain/presence.ts";
import type {
  EngineEvent,
  EngineSessionHandle,
  IdleSnapshot,
} from "../../ports/engine.ts";

/**
 * Minimal vendor session surface the handle needs. Each adapter's own surface
 * type (PiSessionSurface / PrimeSessionSurface) is structurally assignable.
 */
export type EngineSessionSurface<TEvent> = {
  prompt(
    text: string,
    options?: {
      images?: readonly unknown[];
      streamingBehavior?: "steer" | "followUp";
      expandPromptTemplates?: boolean;
    },
  ): Promise<void>;
  steer(text: string, images?: readonly unknown[]): Promise<void>;
  /** Vendor may return a boolean receipt (prime fork followUp → Promise<boolean>). */
  followUp(text: string, images?: readonly unknown[]): Promise<unknown>;
  abort(): Promise<void>;
  /** Primary idle primitive; optional (agent.waitForIdle fallback, else events only). */
  waitForIdle?(): Promise<void>;
  subscribe(listener: (event: TEvent) => void): () => void;
  dispose(): void;
  /** Graceful async teardown when the vendor supports it (Prime does). */
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

/** Vendor session event → mediation EngineEvent[] (engine-specific). */
export type EngineSessionEventMapper<TEvent> = (event: TEvent) => EngineEvent[];

export type EngineSessionHandleBaseOptions<TEvent> = {
  readonly session: EngineSessionSurface<TEvent>;
  readonly sessionRef: SessionRef;
  /** Map agent_end as idle (default false). */
  readonly mapAgentEndAsIdle?: boolean;
  /** Vendor event → EngineEvent mapper. */
  readonly mapEvent: EngineSessionEventMapper<TEvent>;
  /** Label used in error messages (e.g. "PiEngineSessionHandle"). */
  readonly label?: string;
};

type IdleWaiter = {
  resolve: (s: IdleSnapshot) => void;
  reject: (err: Error) => void;
  cleanup?: () => void;
};

/**
 * EngineSessionHandle over any vendor session surface.
 *
 * waitUntilIdle:
 * 1. If not streaming and we already observed an idle snapshot → resolve it.
 * 2. Else prefer session.waitForIdle(), then snapshot idle.
 * 3. Concurrently listen for mapped idle events via subscribe for observers.
 */
export class EngineSessionHandleBase<TEvent> implements EngineSessionHandle {
  readonly sessionRef: SessionRef;
  private readonly session: EngineSessionSurface<TEvent>;
  private readonly mapEvent: EngineSessionEventMapper<TEvent>;
  private readonly label: string;
  private readonly listeners = new Set<(e: EngineEvent) => void>();
  private disposed = false;
  private busy = false;
  private lastIdle: IdleSnapshot | null;
  private idleWaiters: IdleWaiter[] = [];
  private readonly unsubSession: () => void;

  constructor(opts: EngineSessionHandleBaseOptions<TEvent>) {
    this.session = opts.session;
    this.sessionRef = opts.sessionRef;
    this.mapEvent = opts.mapEvent;
    this.label = opts.label ?? "EngineSessionHandle";
    // Fresh session is idle until prompt/continue.
    this.lastIdle = {
      at: new Date().toISOString(),
      reason: "session_open",
    };

    this.unsubSession = this.session.subscribe((pe) => {
      const mapped = this.mapEvent(pe);
      for (const e of mapped) {
        this.onEngineEvent(e);
      }
    });
  }

  private onEngineEvent(e: EngineEvent): void {
    if (e.type === "idle") {
      this.busy = false;
      this.lastIdle = e.snapshot;
      this.emit(e);
      const waiters = this.idleWaiters.splice(0);
      for (const w of waiters) {
        w.cleanup?.();
        w.resolve(e.snapshot);
      }
      return;
    }
    if (e.type === "raw" && e.name === "agent_start") {
      this.busy = true;
      this.lastIdle = null;
    }
    this.emit(e);
  }

  private emit(e: EngineEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        // listener errors must not break the engine handle
      }
    }
  }

  private markBusy(): void {
    this.busy = true;
    this.lastIdle = null;
  }

  async prompt(text: string, images?: readonly unknown[]): Promise<void> {
    if (this.disposed) {
      throw new Error(`${this.label}: disposed`);
    }
    this.markBusy();
    this.emit({ type: "message", role: "user", text });
    await this.session.prompt(text, {
      images: images as readonly unknown[] | undefined,
      expandPromptTemplates: true,
    });
  }

  async continue(): Promise<void> {
    if (this.disposed) {
      throw new Error(`${this.label}: disposed`);
    }
    this.markBusy();
    this.emit({ type: "raw", name: "continue" });
    const cont = this.session.agent?.continue;
    if (typeof cont === "function") {
      await cont.call(this.session.agent);
    }
    // No agent.continue: if already streaming, waitUntilIdle will settle;
    // if idle, no-op continue (already settled).
  }

  async interrupt(
    kind: "steer" | "followUp" | "abort",
    payload?: unknown,
  ): Promise<void> {
    if (this.disposed) {
      throw new Error(`${this.label}: disposed`);
    }
    this.emit({ type: "raw", name: "interrupt", data: { kind, payload } });
    const text =
      typeof payload === "string"
        ? payload
        : payload &&
            typeof payload === "object" &&
            "text" in payload &&
            typeof (payload as { text: unknown }).text === "string"
          ? (payload as { text: string }).text
          : "";

    if (kind === "abort") {
      await this.session.abort();
      // abort() waits for idle in both SDKs; emit mediation idle if not already.
      if (this.busy || !this.lastIdle) {
        this.onEngineEvent({
          type: "idle",
          snapshot: {
            at: new Date().toISOString(),
            reason: "aborted",
          },
        });
      }
      return;
    }
    if (kind === "steer") {
      await this.session.steer(text);
      return;
    }
    await this.session.followUp(text);
  }

  subscribe(listener: (e: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  waitUntilIdle(opts?: { signal?: AbortSignal }): Promise<IdleSnapshot> {
    if (this.disposed) {
      return Promise.reject(new Error(`${this.label}: disposed`));
    }
    if (!this.busy && this.lastIdle) {
      return Promise.resolve(this.lastIdle);
    }

    const signal = opts?.signal;
    if (signal?.aborted) {
      return Promise.reject(
        new Error(`${this.label}: waitUntilIdle aborted`),
      );
    }

    return new Promise<IdleSnapshot>((resolve, reject) => {
      const entry: IdleWaiter = { resolve, reject };

      if (signal) {
        const onAbort = () => {
          const idx = this.idleWaiters.indexOf(entry);
          if (idx >= 0) this.idleWaiters.splice(idx, 1);
          reject(new Error(`${this.label}: waitUntilIdle aborted`));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        entry.cleanup = () => signal.removeEventListener("abort", onAbort);
      }

      this.idleWaiters.push(entry);

      // Drive the vendor idle primitive when busy; mapped idle events will
      // also resolve waiters via subscribe.
      void this.driveWaitForIdle().catch((err: unknown) => {
        const idx = this.idleWaiters.indexOf(entry);
        if (idx >= 0) {
          this.idleWaiters.splice(idx, 1);
          entry.cleanup?.();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }

  private async driveWaitForIdle(): Promise<void> {
    if (this.disposed) return;
    // Prefer session.waitForIdle; fall back to agent.waitForIdle.
    if (typeof this.session.waitForIdle === "function") {
      await this.session.waitForIdle();
    } else if (typeof this.session.agent?.waitForIdle === "function") {
      await this.session.agent.waitForIdle();
    } else {
      // Fake without waitForIdle: rely solely on the event map.
      return;
    }
    // waitForIdle resolved — ensure idle snapshot even if event was missed.
    if (this.busy || !this.lastIdle) {
      this.onEngineEvent({
        type: "idle",
        snapshot: {
          at: new Date().toISOString(),
          reason: "waitForIdle",
        },
      });
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubSession();
    const waiters = this.idleWaiters.splice(0);
    for (const w of waiters) {
      w.cleanup?.();
      w.reject(new Error(`${this.label}: disposed`));
    }
    this.listeners.clear();
    try {
      if (typeof this.session.disposeAsync === "function") {
        await this.session.disposeAsync();
      } else {
        this.session.dispose();
      }
    } catch {
      // dispose best-effort
    }
  }
}

/** Build SessionRef from a session file path or id. */
export function sessionRefFromSurface<TEvent>(
  session: EngineSessionSurface<TEvent>,
): SessionRef {
  if (session.sessionFile && session.sessionFile.length > 0) {
    return asSessionRef(session.sessionFile);
  }
  return asSessionRef(session.sessionId);
}
