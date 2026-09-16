# Evidence — Slice S1b (YamlDefinitionLoader)

**Package:** `@company/mediation`  
**Date:** 2026-07-18  
**Branch:** `slice/S1b-yaml-definition-loader`  
**Worktree:** `product/mediation-engine/mediation-wt-s1b`  
**Law:** D0 Definition inert, D4 DefinitionLoader port  
**Harness reference (read-only):** `company/agents/_harness/types.ts`, `loadConfig` in `prepare.ts`, `loadPrompt` in `resolve.ts`

---

## 1. Artifacts landed

| Path | Role |
|------|------|
| `src/adapters/definition/yaml-definition-loader.ts` | `YamlDefinitionLoader`, `mapYamlToDefinition`, `loadPromptField`, `createYamlDefinitionLoader` |
| `test/definition/yaml-definition-loader.test.ts` | Goldens: field map, fail-closed, model forms, optional real agent |
| `fixtures/definition/case-basic/**` | Synthetic `agent.yaml` + `prompt.md` + `expected.json` |
| `EVIDENCE-S1b.md` | This packet |
| `package.json` / lock | dep `yaml` ^2.9.0 |
| `src/index.ts` | Public exports for loader surface |

Domain/port consumed (not rewritten):

- `src/domain/definition.ts` — `AgentRef`, `AgentDefinition`, `ModelSpec`, `ToolPolicy`
- `src/ports/definition-loader.ts` — `DefinitionLoader.load(ref)`
- `src/domain/errors.ts` — `DEFINITION_NOT_FOUND` / `DEFINITION_INVALID`

---

## 2. Mapping (harness snake_case → domain camelCase)

| agent.yaml | AgentDefinition |
|------------|-----------------|
| `name` | `id`, `name` |
| `model` string or `{provider,id}` | `model: ModelSpec` |
| `thinking` | `thinking` |
| `extensions[]` | `extensions` (declared; not resolved) |
| `skills[]` | `skills` |
| `prompt` path or inline | `prompt` (file contents loaded when path-like) |
| `tools.builtin` / `tools.custom` | `tools.builtin` / `tools.custom` |
| `agent_mode` | `agentMode` + mirrored on `tools.agentMode` |
| `active_tools` | `activeTools` + mirrored on `tools.activeTools` |
| `no_core_skills` | `noCoreSkills` |
| `memory` | `memory` |
| `max_tokens` | `maxTokens` |
| `max_cost_per_day_usd` | `maxCostPerDayUsd` |
| `max_concurrency` | `maxConcurrency` |
| `task_timeout_minutes` | `taskTimeoutMinutes` |
| `extends` | `extends` |
| unknown keys (e.g. `tracing`) | `meta` residual |

`rootDir` comes from `AgentRef.rootDir` (resolved absolute). Definition stays inert — no session, no Pi, no pack resolve.

### Intentional diffs vs harness

| Aspect | Harness | S1b YamlDefinitionLoader |
|--------|---------|--------------------------|
| Missing `agent.yaml` | throw Error | `MediationError` **DEFINITION_NOT_FOUND** |
| Invalid yaml / schema | may throw late | **DEFINITION_INVALID** fail-closed |
| Missing prompt file (`.md`/`.txt`) | WARN + treat as inline | **DEFINITION_INVALID** fail-closed |
| Default prompt when omitted | `spec.md` body or "helpful assistant" | leave `prompt` **undefined** (engine concern) |
| Model | string only in types | string **or** structured `{provider,id}` |

---

## 3. Fixture + optional real agent

### Fixture: `fixtures/definition/case-basic/`

```
agent.yaml     full field surface (dynamic mode, tools, memory, residual tracing)
prompt.md      system prompt body
expected.json  oracle for golden assert
```

Golden asserts field map + `prompt` contains `"case-basic fixture agent"`.

### Optional real agent

When `company/agents/coding-agent/agent.yaml` exists relative to package (path injectable via `AgentRef.rootDir`), test loads it and asserts name, extensions, and non-empty loaded prompt.

---

## 4. Fail-closed matrix

| Input | Code |
|-------|------|
| missing `agent.yaml` | `DEFINITION_NOT_FOUND` |
| unreadable / empty / invalid YAML | `DEFINITION_NOT_FOUND` or `DEFINITION_INVALID` |
| missing `name` or `model` | `DEFINITION_INVALID` |
| bad `thinking` / `agent_mode` / types | `DEFINITION_INVALID` |
| `prompt: prompt.md` but file absent | `DEFINITION_INVALID` |

---

## 5. Test / typecheck / gauges

```bash
cd company/product/mediation-engine/mediation-wt-s1b
npm run check
```

Observed:

```
tsc --noEmit: exit 0
tests 52, pass 52, fail 0
  (incl. 10 S1b definition tests; optional coding-agent path ran)
layer_import_violations=0
second_door_count=0
pack_parity_delta=0
public_export_surface=84
gauges: OK
```

S1b-specific exports: `YamlDefinitionLoader`, `createYamlDefinitionLoader`, `mapYamlToDefinition`, `loadPromptField`, `YamlDefinitionLoaderOptions`.

---

## 6. Port surface

```ts
interface DefinitionLoader {
  load(ref: AgentRef): Promise<AgentDefinition>;
}

class YamlDefinitionLoader implements DefinitionLoader {
  constructor(options?: { configFileName?: string });
  load(ref: AgentRef): Promise<AgentDefinition>;
}
```

No Pi / OpenWorkflow / createAgentSession in this slice. Ownership limited to definition adapter, tests, fixtures, evidence, yaml dep, and index export.

---

## 7. Done criteria checklist

| Criterion | Status |
|-----------|--------|
| `YamlDefinitionLoader` implements `DefinitionLoader` | yes |
| Map harness-compatible fields | yes (table §2) |
| prompt path load relative to agent root | yes |
| Fail-closed missing/invalid | DEFINITION_NOT_FOUND / INVALID |
| Fixture golden + optional real agent | yes |
| `npm run check` green | yes |
| No pi/openworkflow ownership edits | yes |
| Commits on this branch only | yes |

---

## 8. Git (post-commit)

```
5ba27e3 S1b: YamlDefinitionLoader maps agent.yaml into inert AgentDefinition.
7a47e1c Fix second_door gauge false positive on comments after merge.
681be9b Merge branch 'slice/S5a-ow-runtime-port'.
```

Branch: `slice/S1b-yaml-definition-loader`  
Tip (implementation): `5ba27e3f65e48f1c387ff2727063d02757316924`  
`npm run check` at tip: green (52 pass, gauges OK).