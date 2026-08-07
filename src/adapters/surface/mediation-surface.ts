/**
 * Mediation as SurfacePort (ABS-B2 / LIFE-P3).
 * Law D5: surfaces are connectors — CLI/MCP talk to SurfacePort only;
 * this adapter maps SurfaceRequest DTOs onto the Mediation façade.
 */

import type { Mediation } from "../../app/mediation.ts";
import type { RunId } from "../../domain/engagement.ts";
import type {
  SurfaceEngageResult,
  SurfacePort,
  SurfaceReenterRequest,
  SurfaceReenterResult,
  SurfaceRequest,
} from "../../ports/surface.ts";
import type { DispatchHandle, RuntimeStatus } from "../../ports/runtime.ts";

/**
 * Wrap a Mediation instance as SurfacePort.
 * Control methods always present; Mediation throws when runtime/join unwired.
 */
export function createMediationSurface(mediation: Mediation): SurfacePort {
  return {
    engageLocal(req: SurfaceRequest): Promise<SurfaceEngageResult> {
      return mediation.engageLocal({
        agent: req.agent,
        task: req.task,
        resume: req.resume,
        mode: req.mode,
        cwd: req.cwd,
        parkIntent: req.parkIntent,
        parkReason: req.parkReason,
        engine: req.engine,
      });
    },

    dispatch(req: SurfaceRequest): Promise<DispatchHandle> {
      return mediation.dispatch({
        agent: req.agent,
        task: req.task,
        resume: req.resume,
        clientRequestId: req.clientRequestId,
        parkIntent: req.parkIntent,
        parkReason: req.parkReason,
        engine: req.engine,
      });
    },

    reenter(req: SurfaceReenterRequest): Promise<SurfaceReenterResult> {
      return mediation.reenter({
        agent: req.agent,
        sessionRef: req.sessionRef,
        task: req.task,
        mode: req.mode,
        cwd: req.cwd,
        expectedPackSnapshotHash: req.expectedPackSnapshotHash,
        parkIntent: req.parkIntent,
        parkReason: req.parkReason,
        engine: req.engine,
      });
    },

    getStatus(runId: RunId): Promise<RuntimeStatus> {
      return mediation.getStatus(runId);
    },

    wait(
      runId: RunId,
      opts?: { timeoutMs?: number },
    ): Promise<RuntimeStatus> {
      return mediation.wait(runId, opts);
    },

    cancel(runId: RunId): Promise<void> {
      return mediation.cancel(runId);
    },

    sendSignal(runId: RunId, name: string, data?: unknown): Promise<void> {
      return mediation.sendSignal(runId, name, data);
    },

    wake(
      runId: RunId,
      data: {
        readonly payloadText: string;
        readonly mode?: "prompt" | "continue";
        readonly parkIntent?: boolean;
        readonly parkReason?: string;
      },
    ): Promise<void> {
      return mediation.wake(runId, data);
    },
  };
}

/** Alias for createMediationSurface — class-shaped name from the ABS-B2 contract. */
export const MediationSurface = createMediationSurface;
