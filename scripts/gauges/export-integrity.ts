/**
 * Gauge: export_integrity
 *
 * Verifies every named re-export in src/index.ts resolves to a real export
 * in the source module. Catches dead re-exports like `isWakeSignalData`
 * that would otherwise go undetected until runtime.
 *
 * Checks both `export { X } from "./foo"` and `export type { X } from "./foo"`.
 */

import fs from "node:fs";
import path from "node:path";

const PKG_ROOT = path.resolve(import.meta.dirname, "../..");
const INDEX = path.join(PKG_ROOT, "src", "index.ts");

export type ExportIntegrityGauge = {
  name: "export_integrity";
  // count of dead exports
  value: number;
  deadExports: Array<{
    symbol: string;
    sourceFile: string;
    indexLine: number;
  }>;
  checkedFiles: number;
  checkedSymbols: number;
};

/**
 * Parse exported names from a TypeScript source file.
 * Handles: export const/function/class/enum/interface/type X
 *          export { X, Y } / export type { X }
 *          export { default } from "..."
 */
function parseExportedNames(filePath: string) {
    const names = new Set<string>();
    if (!fs.existsSync(filePath)) return names;

    const text = fs.readFileSync(filePath, "utf8");

    // export async function Foo / export function Foo / export const Foo
    // export class Foo / export enum Foo / export abstract class Foo
    // export interface Foo / export type Foo
    const declRe =
      /export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function|const|let|var|enum|interface|type)\s+(\w+)/gu;
    let m: RegExpExecArray | null;
    while ((m = declRe.exec(text)) !== null) {
      if (m[1]) names.add(m[1]);
    }

    // export { X, Y as Z } (local declarations with optional semicolon)
    // export type { X }
    const blockLocalRe =
      /export\s+(?:type\s+)?\{([^}]+)\}\s*;?\s*$/gmu;
    while ((m = blockLocalRe.exec(text)) !== null) {
      const body = m[1];
      if (!body) continue;
      for (const part of body.split(",")) {
        const raw = part.trim();
        if (!raw || raw.startsWith("//")) continue;
        const name = raw.match(/^(\w+)/u)?.[1];
        if (name) names.add(name);
      }
    }

    // export { X, Y } from "./other" — re-exports count as exports of this file
    // export type { X } from "./other"
    const blockReExRe =
      /export\s+(?:type\s+)?\{([^}]+)\}\s*from\s+["'][^"']+["']\s*;?\s*$/gmu;
    while ((m = blockReExRe.exec(text)) !== null) {
      const body = m[1];
      if (!body) continue;
      for (const part of body.split(",")) {
        const raw = part.trim();
        if (!raw || raw.startsWith("//")) continue;
        const name = raw.match(/^(\w+)/u)?.[1];
        if (name) names.add(name);
      }
    }

    // export default
    if (/export\s+default\b/u.test(text)) {
      names.add("default");
    }

    return names;
}

/**
 * Parse re-export statements from index.ts.
 * Returns array of { names, sourceFile, indexLine }.
 */
function parseReExports(
  indexPath: string,
) {
   const text = fs.readFileSync(indexPath, "utf8");
   const results: Array<{ names: string[]; sourceFile: string; indexLine: number }> = [];

   // Match: export { X, Y } from "./foo"
   //        export type { X } from "./foo"
   const blockRe =
      /export\s+(?:type\s+)?\{([^}]+)\}\s*(?:from\s+["']([^"']+)["'])?/gu;

   let m: RegExpExecArray | null;
   while ((m = blockRe.exec(text)) !== null) {
     const body = m[1];
     const sourcePath = m[2];
     if (!body || !sourcePath) continue;

     const names: string[] = [];
     for (const part of body.split(",")) {
       const raw = part.trim();
       if (!raw || raw.startsWith("//")) continue;
        const name = raw.match(/^(\w+)/u)?.[1];
       if (name) names.push(name);
     }

     if (names.length === 0) continue;

     // Compute line number from match position
      const lineNumber = (text.slice(0, m.index).match(/\n/gu) ?? []).length + 1;

     results.push({
       names,
       sourceFile: path.resolve(path.dirname(indexPath), sourcePath),
       indexLine: lineNumber,
     });
   }

   return results;
}

export function measureExportIntegrity(): ExportIntegrityGauge {
  if (!fs.existsSync(INDEX)) {
    return {
      name: "export_integrity",
      value: 0,
      deadExports: [],
      checkedFiles: 0,
      checkedSymbols: 0,
    };
  }

  const reExports = parseReExports(INDEX);
  const deadExports: ExportIntegrityGauge["deadExports"] = [];
  let checkedSymbols = 0;

  for (const re of reExports) {
    // Resolve source file — try .ts, .tsx
    let sourceFile = re.sourceFile;
    if (!fs.existsSync(sourceFile)) {
      const ts = `${sourceFile}.ts`;
      if (fs.existsSync(ts)) sourceFile = ts;
      else {
        const tsx = `${sourceFile}.tsx`;
        if (fs.existsSync(tsx)) sourceFile = tsx;
        else {
          // Check for directory with index.ts
          const idx = path.join(sourceFile, "index.ts");
          if (fs.existsSync(idx)) sourceFile = idx;
          // can't resolve — skip (will be caught by other tools)
          else continue;
        }
      }
    }

    const exportedNames = parseExportedNames(sourceFile);

    for (const name of re.names) {
      checkedSymbols++;
      if (!exportedNames.has(name)) {
        deadExports.push({
          symbol: name,
          sourceFile: path.relative(PKG_ROOT, sourceFile),
          indexLine: re.indexLine,
        });
      }
    }
  }

  return {
    name: "export_integrity",
    value: deadExports.length,
    deadExports,
    checkedFiles: reExports.length,
    checkedSymbols,
  };
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("export-integrity.ts")
) {
  const g = measureExportIntegrity();
  console.log(`${g.name}=${g.value}`);
  console.log(`checked_files=${g.checkedFiles}`);
  console.log(`checked_symbols=${g.checkedSymbols}`);
  for (const d of g.deadExports) {
    console.log(`  dead-export: ${d.symbol} (re-exported from ${d.sourceFile}, index.ts:${d.indexLine})`);
  }
  if (g.value !== 0) {
    process.exitCode = 1;
  }
}

