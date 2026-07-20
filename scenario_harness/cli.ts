
import { resolve } from "node:path";
import { Harness, runCli } from "@company/test-harness";
import { YamlEntityLoader } from "./entity-loader.ts";
import { MediationRunner } from "./runner.ts";



const resultsDir = resolve(import.meta.dirname, "../results");
const scenariosDir = resolve(import.meta.dirname, "./scenarios");
const entitiesDir = resolve(import.meta.dirname, "./entities");

const harness = new Harness({
  name: "mediation",
  resultsDir,
  scenariosDir,
  entityLoader: new YamlEntityLoader(entitiesDir),
  runners: {
    default: new MediationRunner(),
  },
  defaultRunner: "default",
});

await runCli(harness, resultsDir, process.argv.slice(2));

