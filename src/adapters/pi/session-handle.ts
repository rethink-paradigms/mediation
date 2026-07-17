/**
 * PiEngineSessionHandle — EngineSessionHandle over a Pi AgentSession surface.
 */

import { asSessionRef, type SessionRef } from "../../domain/presence.ts";
import type {
  EngineEvent,
  EngineSessionHandle,
  IdleSnapshot,
} from "../../ports/engine.ts";
import { mapPiEvent } from "./event-map.ts";
import type { PiSessionSurface } from "./types.ts";

type IdleWaiter = {
  resolve: (s: IdleSnapshot) => void;
  reject: (err: Error) => void;
  cleanup?: () => void;
};

export type PiEngineSessionHandleOptions = {
  readonly session: PiSessionSurface;
  readonly sessionRef: SessionRef;
  /** Map agent_end(willRetry=false) as idle (default false). */
  readonly mapAgentEndAsIdle?: boolean;
};

/**
 * EngineSessionHandle backed by real (or fake) Pi session surface.
 *
 * waitUntilIdle:
 * 1. If not streaming and we already observed agent_settled → resolve last idle.
 * 2. Else prefer session.waitForIdle() (Pi 0.80+), then snapshot idle.
 * 3. Concurrently listen for agent_settled via subscribe for observers.
 */
export class PiEngineSessionHandle implements EngineSessionHandle {
  readonly sessionRef: SessionRef;
  private readonly session: PiSessionSurface;
  private readonly mapAgentEndAsIdle: boolean;
  private readonly listeners = new Set<(e: EngineEvent) => void>();
  private disposed = false;
  private busy = false;
  private lastIdle: IdleSnapshot | null;
  private idleWaiters: IdleWaiter[] = [];
  private readonly unsubSession: () => void;

  constructor(opts: PiEngineSessionHandleOptions) {
    this.session = opts.session;
    this.sessionRef = opts.sessionRef;
    this.mapAgentEndAsIdle = opts.mapAgentEndAsIdle === true;
    // Fresh session is idle until prompt/continue.
    this.lastIdle = {
      at: new Date().toISOString(),
      reason: "session_open",
    };

    this.unsubSession = this.session.subscribe((pe) => {
      const mapped = mapPiEvent(pe, {
        mapAgentEndAsIdle: this.mapAgentEndAsIdle,
      });
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
      throw new Error("PiEngineSessionHandle: disposed");
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
      throw new Error("PiEngineSessionHandle: disposed");
    }
    this.markBusy();
    this.emit({ type: "raw", name: "continue" });
    const cont = this.session.agent?.continue;
    if (typeof cont === "function") {
      await cont.call(this.session.agent);
      return;
    }
    // No agent.continue: if already streaming, waitUntilIdle will settle;
    // if idle, no-op continue (already settled).
  }

  async interrupt(
    kind: "steer" | "followUp" | "abort",
    payload?: unknown,
  ): Promise<void> {
    if (this.disposed) {
      throw new Error("PiEngineSessionHandle: disposed");
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
      // abort() waits for idle in Pi; emit mediation idle if not already.
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
      return Promise.reject(new Error("PiEngineSessionHandle: disposed"));
    }
    if (!this.busy && this.lastIdle) {
      return Promise.resolve(this.lastIdle);
    }

    const signal = opts?.signal;
    if (signal?.aborted) {
      return Promise.reject(
        new Error("PiEngineSessionHandle: waitUntilIdle aborted"),
      );
    }

    return new Promise<IdleSnapshot>((resolve, reject) => {
      const entry: IdleWaiter = { resolve, reject };

      if (signal) {
        const onAbort = () => {
          const idx = this.idleWaiters.indexOf(entry);
          if (idx >= 0) this.idleWaiters.splice(idx, 1);
          reject(new Error("PiEngineSessionHandle: waitUntilIdle aborted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        entry.cleanup = () => signal.removeEventListener("abort", onAbort);
      }

      this.idleWaiters.push(entry);

      // Drive Pi's waitForIdle when busy; agent_settled will also resolve waiters via subscribe.
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
    // Prefer session.waitForIdle (agent_settled); fall back to agent.waitForIdle.
    if (typeof this.session.waitForIdle === "function") {
      await this.session.waitForIdle();
    } else if (typeof this.session.agent?.waitForIdle === "function") {
      await this.session.agent.waitForIdle();
    } else {
      // Fake without waitForIdle: rely solely on event map (agent_settled).
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
      w.reject(new Error("PiEngineSessionHandle: disposed"));
    }
    this.listeners.clear();
    try {
      this.session.dispose();
    } catch {
      // dispose best-effort
    }
  }
}

/** Build SessionRef from Pi session file path or id. */
export function sessionRefFromPi(session: PiSessionSurface): SessionRef {
  if (session.sessionFile && session.sessionFile.length > 0) {
    return asSessionRef(session.sessionFile);
  }
  return asSessionRef(session.sessionId);
}
