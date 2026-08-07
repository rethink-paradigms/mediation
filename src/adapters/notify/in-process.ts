/**
 * InProcessNotifier — default NotifyPort adapter (D3 P4 first pour).
 *
 * In-process listeners map; no external transport (no HTTP/IPC/MCP yet).
 * Listener errors are isolated: one throwing listener never breaks delivery
 * to the rest, and notify() itself never throws.
 *
 * Layer: adapters — implements ports/notify.ts only.
 */

import type {
  ObservableNotifyPort,
  NotifyRecord,
} from "../../ports/notify.ts";

export type InProcessNotifyListener = (record: NotifyRecord) => void;

export class InProcessNotifier implements ObservableNotifyPort {
  private readonly listeners = new Set<InProcessNotifyListener>();

  /** Subscribe; returns unsubscribe. */
  on(listener: InProcessNotifyListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async notify(record: NotifyRecord): Promise<void> {
    for (const listener of [...this.listeners]) {
      try {
        listener(record);
      } catch {
        // listener errors are isolated — delivery must never break producers
      }
    }
  }

  /** Diagnostic: number of subscribed listeners. */
  listenerCount(): number {
    return this.listeners.size;
  }
}
