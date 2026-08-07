/**
 * Gauge: second_door_count
 *
 * Parameterized engine session doors (S0g). Each door regex is allowed ONLY
 * inside its listed adapter dirs; occurrences anywhere else in src/ count and
 * fail the gauge.
 *
 * Current doors:
 *   - "engine-session-door": createAgentSession / createAgentSessionFromServices
 *     allowed dirs: src/adapters/pi AND src/adapters/prime (both SDKs export
 *     the same symbol names — pi: @earendil-works/pi-coding-agent, prime:
 *     prime-agent fork).
 *
 * Expected value 0 (all door uses live under the allowed adapter dirs).
 */

import fs from "node:fs";
import path from "node:path";

const PKG_ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.join(PKG_ROOT, "src");

export type SecondDoorSpec = {
  readonly name: string;
  readonly re: RegExp;
  /** Adapter dirs (relative to src/adapters) where the door may live. */
  readonly allowedDirs: readonly string[];
};

/**
 * Doors registry — future engines append their own entry (door regex + dir).
 * Both pi and prime SDKs export createAgentSession(FromServices), so both are
 * allowed under one spec; imports stay distinct by module specifier.
 */
export const SECOND_DOORS: readonly SecondDoorSpec[] = [
  {
    name: "engine-session-door",
    re: /\bcreateAgentSession(?:FromServices)?\b/gu,
    allowedDirs: ["pi", "prime"],
  },
];

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.isFile() && /\.(ts|tsx|mts|cts|js|mjs|cjs)$/u.test(ent.name)) {
      out.push(p);
    }
  }
  return out;
}

function isAllowed(file: string, spec: SecondDoorSpec): boolean {
  const rel = path.relative(path.join(SRC, "adapters"), file);
  // Only files directly under an allowed adapter dir are permitted.
  return spec.allowedDirs.some((dir) => rel.startsWith(`${dir}${path.sep}`));
}

export type SecondDoorGauge = {
  name: "second_door_count";
  value: number;
  details: { file: string; line: number; match: string; door: string }[];
};

export function measureSecondDoor(): SecondDoorGauge {
  const details: SecondDoorGauge["details"] = [];
  if (!fs.existsSync(SRC)) {
    return { name: "second_door_count", value: 0, details };
  }
  for (const spec of SECOND_DOORS) {
    spec.re.lastIndex = 0;
    for (const file of walk(SRC)) {
      if (isAllowed(file, spec)) continue;
      const text = fs.readFileSync(file, "utf8");
      const lines = text.split(/\r?\n/u);
      lines.forEach((line, i) => {
        // Comments may document the door; only code / imports count as second doors.
        const code = line.replaceAll(/\/\/.*$/gu, "").replaceAll(/\/\*[\s\S]*?\*\//gu, "");
        spec.re.lastIndex = 0;
        if (spec.re.test(code)) {
          details.push({
            file: path.relative(PKG_ROOT, file),
            line: i + 1,
            match: line.trim(),
            door: spec.name,
          });
        }
      });
    }
  }
  return {
    name: "second_door_count",
    value: details.length,
    details,
  };
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("second-door.ts")
) {
  const g = measureSecondDoor();
  console.log(`${g.name}=${g.value}`);
  for (const d of g.details) {
    console.log(`  ${d.file}:${d.line}: ${d.match} (${d.door})`);
  }
  if (g.value !== 0) {
    console.error(`FAIL: ${g.name}=${g.value} (must be 0)`);
    process.exitCode = 1;
  }
}
