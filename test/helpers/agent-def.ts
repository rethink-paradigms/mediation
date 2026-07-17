/**
 * Test-only minimal AgentDefinition builders.
 * Not production API — keeps fixtures free of dead PackResolver module.
 */

import type { AgentDefinition } from "../../src/domain/definition.ts";

/** Minimal AgentDefinition with extension ids for capability/materialize tests. */
export function agentDefForPacks(
  rootDir: string,
  extensions: readonly string[],
  name = "fixture-agent",
): AgentDefinition {
  return {
    id: name,
    name,
    rootDir,
    model: "test/fixture",
    extensions: [...extensions],
  };
}
