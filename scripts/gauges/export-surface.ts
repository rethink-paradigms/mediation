/**
 * Gauge: public_export_surface
 *
 * List named exports from src/index.ts (type + value).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "../..");
const INDEX = path.join(PKG_ROOT, "src", "index.ts");

export type ExportSurfaceGauge = {
  name: "public_export_surface";
  value: number;
  exports: string[];
};

/**
 * Parse export { ... } and export type { ... } and export { X } / export class X
 * from index.ts in a lightweight way (no TS AST dependency).
 */
export function measureExportSurface(): ExportSurfaceGauge {
  if (!fs.existsSync(INDEX)) {
    return { name: "public_export_surface", value: 0, exports: [] };
  }
  const text = fs.readFileSync(INDEX, "utf8");
  const names = new Set<string>();

  // export type { A, B as C } from "..."
  // export { A, B as C } from "..."
  // export { A, B }
  const blockRe =
    /export\s+(?:type\s+)?\{([^}]+)\}\s*(?:from\s+["'][^"']+["'])?/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    const body = m[1];
    if (body === undefined) continue;
    for (const part of body.split(",")) {
      const raw = part.trim();
      if (!raw || raw.startsWith("//")) continue;
      // "Foo as Bar" → Bar (public name)
      const asMatch = raw.match(/^(\w+)\s+as\s+(\w+)$/);
      const asName = asMatch?.[2];
      if (asName !== undefined) {
        names.add(asName);
      } else {
        const id = raw.match(/^(\w+)/);
        const idName = id?.[1];
        if (idName !== undefined) names.add(idName);
      }
    }
  }

  // export class Foo / export function Foo / export const Foo / export enum Foo
  const declRe =
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|function|const|let|var|enum|interface|type)\s+(\w+)/g;
  while ((m = declRe.exec(text)) !== null) {
    const name = m[1];
    if (name !== undefined) names.add(name);
  }

  // export { MediationError } style already covered; also default
  if (/export\s+default\b/.test(text)) {
    names.add("default");
  }

  const exports = [...names].sort();
  return {
    name: "public_export_surface",
    value: exports.length,
    exports,
  };
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("export-surface.ts")
) {
  const g = measureExportSurface();
  console.log(`${g.name}=${g.value}`);
  for (const e of g.exports) {
    console.log(`  ${e}`);
  }
}
