/**
 * Gauge: layer_import_violations
 *
 * Scan src/domain, src/ports, and src/app (if present) for imports of
 * pi-coding-agent, prime-agent, @earendil-works/*, or openworkflow.
 * Observational: prints count (expected 0).
 */

import fs from "node:fs";
import path from "node:path";

const PKG_ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.join(PKG_ROOT, "src");

const FORBIDDEN = [
  /from\s+["']pi-coding-agent(?:\/[^"']*)?["']/u,
  /from\s+["']prime-agent(?:\/[^"']*)?["']/u,
  /from\s+["']@earendil-works\/[^"']+["']/u,
  /from\s+["']openworkflow(?:\/[^"']*)?["']/u,
  /require\(\s*["']pi-coding-agent(?:\/[^"']*)?["']\s*\)/u,
  /require\(\s*["']prime-agent(?:\/[^"']*)?["']\s*\)/u,
  /require\(\s*["']@earendil-works\/[^"']+["']\s*\)/u,
  /require\(\s*["']openworkflow(?:\/[^"']*)?["']\s*\)/u,
  /import\(\s*["']pi-coding-agent(?:\/[^"']*)?["']\s*\)/u,
  /import\(\s*["']prime-agent(?:\/[^"']*)?["']\s*\)/u,
  /import\(\s*["']@earendil-works\/[^"']+["']\s*\)/u,
  /import\(\s*["']openworkflow(?:\/[^"']*)?["']\s*\)/u,
];

const LAYERS = ["domain", "ports", "app"] as const;

function walkTs(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTs(p, out);
    else if (ent.isFile() && /\.(ts|tsx|mts|cts|js|mjs|cjs)$/u.test(ent.name)) {
      out.push(p);
    }
  }
  return out;
}

export type LayerImportGauge = {
  name: "layer_import_violations";
  value: number;
  details: { file: string; line: number; match: string }[];
};

export function measureLayerImports(): LayerImportGauge {
  const details: LayerImportGauge["details"] = [];
  for (const layer of LAYERS) {
    const root = path.join(SRC, layer);
    for (const file of walkTs(root)) {
      const text = fs.readFileSync(file, "utf8");
      const lines = text.split(/\r?\n/u);
      lines.forEach((line, i) => {
        for (const re of FORBIDDEN) {
          if (re.test(line)) {
            details.push({
              file: path.relative(PKG_ROOT, file),
              line: i + 1,
              match: line.trim(),
            });
            break;
          }
        }
      });
    }
  }
  return {
    name: "layer_import_violations",
    value: details.length,
    details,
  };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("layer-imports.ts")) {
  const g = measureLayerImports();
  console.log(`${g.name}=${g.value}`);
  for (const d of g.details) {
    console.log(`  ${d.file}:${d.line}: ${d.match}`);
  }
  if (g.value !== 0) {
    console.error(`FAIL: ${g.name}=${g.value} (must be 0)`);
    process.exitCode = 1;
  }
}

