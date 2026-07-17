/**
 * Mediation as SurfacePort (ABS-B2).
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
 * Optional methods (dispatch / reenter / getStatus) are always present;
 * Mediation still throws when runtime/join are unwired.
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
      });
    },

    dispatch(req: SurfaceRequest): Promise<DispatchHandle> {
      return mediation.dispatch({
        agent: req.agent,
        task: req.task,
        resume: req.resume,
        clientRequestId: req.clientRequestId,
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
      });
    },

    getStatus(runId: RunId): Promise<RuntimeStatus> {
      return mediation.getStatus(runId);
    },
  };
}

/** Alias for createMediationSurface — class-shaped name from the ABS-B2 contract. */
export const MediationSurface = createMediationSurface;
