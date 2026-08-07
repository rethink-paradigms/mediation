/**
 * NotifyPort — notification delivery to external surfaces (D3 P4).
 *
 * Intent (software-architecture §2.4): the v1 named-pipe "notify API" retires
 * behind this port — delivery is interrupt or continue-engage only, never a
 * second notification protocol. First pour: in-process listeners map
 * (src/adapters/notify/in-process.ts), no external transport.
 *
 * Records are emitted at product lifecycle moments:
 *   parked      — leaf/façade parks (Model P: run waits for wake)
 *   settled     — run settles (or local engage settles)
 *   failed      — run/engage failed
 *   interrupted — runId-scoped interrupt steered a live presence
 *
 * Wake keeps riding RuntimePort.sendSignal("wake") — notify is delivery of
 * *outcomes*, wake is a control verb.
 */

import type { NotifyRecordShape } from "../domain/events.js";

/** Delivery record (D3 P4). See NotifyRecordShape in domain/events.ts. */
export type NotifyRecord = NotifyRecordShape;

/** Delivery event kinds. */
export type NotifyEventKind = NotifyRecord["event"];

/** Port contract — surfaces/consumers implement or observe this. */
export interface NotifyPort {
  notify(record: NotifyRecord): Promise<void>;
}

/**
 * In-process observable extension (first pour): listeners map, no transport.
 * Mediation.observe bridges these records into MediationEvent (recipe G).
 * External transports (HTTP, IPC, MCP) implement NotifyPort only.
 */
export interface ObservableNotifyPort extends NotifyPort {
  on(listener: (record: NotifyRecord) => void): () => void;
}

/** True when the port exposes an in-process listener surface. */
export function isObservableNotifyPort(
  port: NotifyPort | undefined,
): port is ObservableNotifyPort {
  return (
    port !== undefined &&
    typeof (port as { readonly on?: unknown }).on === "function"
  );
}
