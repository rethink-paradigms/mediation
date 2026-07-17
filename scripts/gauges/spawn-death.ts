/**
 * Gauge: spawn_public_export_count (S11 / D3)
 *
 * Public monocoque must not export spawn / runner-as-core APIs.
 * Scans src/index.ts export names and re-export paths for spawn/legacy-spawn
 * product doors. Expected: 0.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "../..");
const INDEX = path.join(PKG_ROOT, "src", "index.ts");

/** Public export names that constitute a spawn / runner-as-core second door. */
const FORBIDDEN_EXPORT_NAME =
  /^(spawn|Spawn|SPAWN)|SpawnEngage|spawnEngage|LegacySpawn|legacySpawn|SpawnAdapter|spawnAdapter|RunAgent|runAgent|RunnerAsCore|runnerAsCore/;

/** Re-export path fragments that must not appear on the public index. */
const FORBIDDEN_FROM_PATH =
  /adapters\/legacy(?:\/|["'])|spawn-engage|\/spawn(?:\.|\/|["'])/i;

export type SpawnDeathDetail = {
  kind: "export_name" | "from_path" | "export_line";
  match: string;
  line?: number;
};

export type SpawnDeathGauge = {
  name: "spawn_public_export_count";
  value: number;
  details: SpawnDeathDetail[];
};

/**
 * Pure scan of index-source text (unit-testable with synthetic violations).
 */
export function detectSpawnPublicExports(indexSource: string): SpawnDeathGauge {
  const details: SpawnDeathDetail[] = [];
  const lines = indexSource.split(/\r?\n/);

  // export { A, B as C } from "..."
  // export type { A } from "..."
  const blockRe =
    /export\s+(?:type\s+)?\{([^}]+)\}\s*(?:from\s+["']([^"']+)["'])?/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(indexSource)) !== null) {
    const body = m[1];
    const fromPath = m[2];
    if (body !== undefined) {
      for (const part of body.split(",")) {
        const raw = part.trim();
        if (!raw || raw.startsWith("//")) continue;
        const asMatch = raw.match(/^(\w+)\s+as\s+(\w+)$/);
        const publicName =
          asMatch?.[2] ?? raw.match(/^(\w+)/)?.[1] ?? undefined;
        if (publicName !== undefined && FORBIDDEN_EXPORT_NAME.test(publicName)) {
          details.push({
            kind: "export_name",
            match: publicName,
          });
        }
        // Also catch local name before `as` if it is spawn-shaped and re-exported
        const localName = asMatch?.[1];
        if (
          localName !== undefined &&
          FORBIDDEN_EXPORT_NAME.test(localName) &&
          publicName !== localName
        ) {
          details.push({
            kind: "export_name",
            match: `${localName} as ${publicName}`,
          });
        }
      }
    }
    if (fromPath !== undefined && FORBIDDEN_FROM_PATH.test(fromPath)) {
      details.push({
        kind: "from_path",
        match: fromPath,
      });
    }
  }

  // export class Foo / export function spawnEngage / etc.
  const declRe =
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|function|const|let|var|enum|interface|type)\s+(\w+)/g;
  while ((m = declRe.exec(indexSource)) !== null) {
    const name = m[1];
    if (name !== undefined && FORBIDDEN_EXPORT_NAME.test(name)) {
      details.push({ kind: "export_name", match: name });
    }
  }

  // Line-level: any export … from … legacy/spawn (comments stripped for code check)
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (!/\bexport\b/.test(code)) return;
    if (FORBIDDEN_FROM_PATH.test(code) || /\bexport\s+.*\bspawnEngage\b/i.test(code)) {
      // Avoid double-counting pure comments; code path already matched
      if (
        FORBIDDEN_FROM_PATH.test(code) ||
        FORBIDDEN_EXPORT_NAME.test(code)
      ) {
        // Only add line detail if we already have a structural hit or clear export
        if (
          /export\s+.*from\s+["'][^"']*(?:legacy|spawn-engage|\/spawn)/i.test(
            code,
          ) ||
          /export\s+\{[^}]*\b(?:spawn|SpawnEngage|spawnEngage|LegacySpawn)\b/i.test(
            code,
          )
        ) {
          const already = details.some(
            (d) =>
              d.line === i + 1 ||
              (d.kind === "from_path" && code.includes(d.match)),
          );
          if (!already) {
            details.push({
              kind: "export_line",
              match: line.trim(),
              line: i + 1,
            });
          }
        }
      }
    }
  });

  return {
    name: "spawn_public_export_count",
    value: details.length,
    details,
  };
}

export function measureSpawnPublicExportCount(): SpawnDeathGauge {
  if (!fs.existsSync(INDEX)) {
    return { name: "spawn_public_export_count", value: 0, details: [] };
  }
  const text = fs.readFileSync(INDEX, "utf8");
  return detectSpawnPublicExports(text);
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("spawn-death.ts")
) {
  const g = measureSpawnPublicExportCount();
  console.log(`${g.name}=${g.value}`);
  for (const d of g.details) {
    const loc = d.line !== undefined ? `:${d.line}` : "";
    console.log(`  ${d.kind}${loc}: ${d.match}`);
  }
  if (g.value !== 0) {
    console.error(`FAIL: ${g.name}=${g.value} (must be 0)`);
    process.exitCode = 1;
  }
}
