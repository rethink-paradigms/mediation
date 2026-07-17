/**
 * DefinitionLoader — load inert AgentDefinition from AgentRef.
 */

import type { AgentDefinition, AgentRef } from "../domain/definition.js";

export interface DefinitionLoader {
  load(ref: AgentRef): Promise<AgentDefinition>;
}
