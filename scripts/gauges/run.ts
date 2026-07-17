/**
 * Gauge runner — hard gates for mediation package (S0 + S1 + S0g).
 *
 * Architectural gauges fail the process when violated:
 *   layer_import_violations !== 0 → exit 1
 *   second_door_count !== 0 → exit 1
 * Measurement errors also fail the process (agents get hard feedback).
 */

import { measureExportSurface } from "./export-surface.ts";
import { measureLayerImports } from "./layer-imports.ts";
import { runPackPlanGauges } from "./pack-plan.ts";
import { measureSecondDoor } from "./second-door.ts";

function main(): void {
  console.log("=== @company/mediation gauges ===");
  console.log("");

  let failed = false;

  // --- S0 architectural gates ---
  try {
    const layer = measureLayerImports();
    console.log(`layer_import_violations=${layer.value}`);
    for (const d of layer.details) {
      console.log(`  ${d.file}:${d.line}: ${d.match}`);
    }
    if (layer.value !== 0) {
      console.error(
        `FAIL: layer_import_violations=${layer.value} (must be 0)`,
      );
      failed = true;
    }
  } catch (e) {
    console.error(
      `layer_import_violations=error ${e instanceof Error ? e.message : e}`,
    );
    failed = true;
  }

  try {
    const doors = measureSecondDoor();
    console.log(`second_door_count=${doors.value}`);
    for (const d of doors.details) {
      console.log(`  ${d.file}:${d.line}: ${d.match}`);
    }
    if (doors.value !== 0) {
      console.error(`FAIL: second_door_count=${doors.value} (must be 0)`);
      failed = true;
    }
  } catch (e) {
    console.error(
      `second_door_count=error ${e instanceof Error ? e.message : e}`,
    );
    failed = true;
  }

  try {
    const surface = measureExportSurface();
    console.log(`public_export_surface=${surface.value}`);
    for (const name of surface.exports) {
      console.log(`  export ${name}`);
    }
  } catch (e) {
    console.error(
      `public_export_surface=error ${e instanceof Error ? e.message : e}`,
    );
    failed = true;
  }

  // --- S1 pack plan (observational numbers; parity/ok failures gate) ---
  try {
    const rows = runPackPlanGauges();
    console.log("--- pack_plan (S1) ---");
    for (const r of rows) {
      console.log(
        `  ${r.fixture}: pack_plan_hash=${r.pack_plan_hash} pack_parity_delta=${r.pack_parity_delta} pack_count=${r.pack_count} ok=${r.ok}`,
      );
    }
    const parity = rows.reduce((s, r) => s + r.pack_parity_delta, 0);
    console.log(`pack_parity_delta=${parity}`);
    if (parity !== 0) {
      console.error(`FAIL: pack_parity_delta=${parity} (must be 0)`);
      failed = true;
    }
  } catch (e) {
    console.log("--- pack_plan (S1) ---");
    console.error(`  error: ${e instanceof Error ? e.message : String(e)}`);
    failed = true;
  }

  if (failed) {
    process.exitCode = 1;
    console.error("");
    console.error("gauges: FAILED (architectural / measurement gate)");
  } else {
    console.log("");
    console.log("gauges: OK");
  }
}

main();
