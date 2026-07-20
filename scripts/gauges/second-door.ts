/**
 * Gauge: second_door_count
 *
 * Count createAgentSession / createAgentSessionFromServices occurrences
 * outside src/adapters/pi/. Expected 0 until Pi adapter lands, then only there.
 */

import fs from "node:fs";
import path from "node:path";

const PKG_ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.join(PKG_ROOT, "src");

const DOOR_RE = /\bcreateAgentSession(?:FromServices)?\b/gu;
const PI_ADAPTER_PREFIX = path.join(SRC, "adapters", "pi") + path.sep;

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

export type SecondDoorGauge = {
  name: "second_door_count";
  value: number;
  details: { file: string; line: number; match: string }[];
};

export function measureSecondDoor(): SecondDoorGauge {
  const details: SecondDoorGauge["details"] = [];
  if (!fs.existsSync(SRC)) {
    return { name: "second_door_count", value: 0, details };
  }
  for (const file of walk(SRC)) {
    if (file.startsWith(PI_ADAPTER_PREFIX)) continue;
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/u);
    lines.forEach((line, i) => {
      // Comments may document the door; only code / imports count as second doors.
      const code = line.replaceAll(/\/\/.*$/gu, "").replaceAll(/\/\*[\s\S]*?\*\//gu, "");
      DOOR_RE.lastIndex = 0;
      if (DOOR_RE.test(code)) {
        details.push({
          file: path.relative(PKG_ROOT, file),
          line: i + 1,
          match: line.trim(),
        });
      }
    });
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
    console.log(`  ${d.file}:${d.line}: ${d.match}`);
  }
  if (g.value !== 0) {
    console.error(`FAIL: ${g.name}=${g.value} (must be 0)`);
    process.exitCode = 1;
  }
}

