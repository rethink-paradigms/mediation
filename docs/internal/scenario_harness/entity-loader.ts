import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";
import type { EntityDef, EntityLoaderPort } from "@company/test-harness";

export class YamlEntityLoader implements EntityLoaderPort {
  private entitiesDir: string;
  constructor(entitiesDir: string) {
    this.entitiesDir = entitiesDir;
  }

  async loadEntities(): Promise<Record<string, EntityDef>> {
    const entities: Record<string, EntityDef> = {};
    if (!existsSync(this.entitiesDir)) return entities;

    const files = await readdir(this.entitiesDir);
    const yamlFiles = files.filter((f) => f.endsWith(".lifecycle.yml"));

    for (const file of yamlFiles) {
      const content = await readFile(join(this.entitiesDir, file), "utf-8");
      const parsed = parseYaml(content) as EntityDef;
      if (parsed.name) {
        entities[parsed.name] = parsed;
      }
    }

    return entities;
  }
}
