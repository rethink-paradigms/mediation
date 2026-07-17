/**
 * Test/gauge helper: build PackLoadPlan from resolveFsModule (capability FS search).
 * Production materialize uses CapabilityResolver — this is golden/parity only.
 */

import type {
  PackDiagnostic,
  PackLoadPlan,
  PackRef,
} from "../../src/domain/packs.ts";
import { resolveFsModule } from "../../src/adapters/capability/fs-store.ts";

export function planHasErrors(plan: PackLoadPlan): boolean {
  return !plan.ok || plan.diagnostics.some((d) => d.level === "error");
}

/** Resolve extension name list via FS capability search order → PackLoadPlan. */
export function packLoadPlanFromFsSpecs(
  extensionSpecs: readonly string[],
  projectRoot: string,
  homeDir: string,
): PackLoadPlan {
  const packs: PackRef[] = [];
  const diagnostics: PackDiagnostic[] = [];

  for (const name of extensionSpecs) {
    const found = resolveFsModule(name, projectRoot, homeDir);
    if (found) {
      packs.push({
        id: found.id,
        path: found.path,
        source: found.source,
      });
    } else {
      diagnostics.push({
        level: "error",
        code: "pack_not_found",
        packName: name,
        message: `Extension not found: "${name}"`,
      });
    }
  }

  const ok = !diagnostics.some((d) => d.level === "error");
  return { packs, diagnostics, ok };
}
