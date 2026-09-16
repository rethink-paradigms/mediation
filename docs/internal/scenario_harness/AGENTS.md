# Agents - Mediation Runtime Observation Surface

This directory contains the Mediation Substrate for the Runtime Observation Surface. It allows you to run, manage, and experience the lifecycle of mediation objects (Capability Store, Agent Definition, Agent Presence, and Durable Engagement).

## commands
The CLI exposes commands from `@company/test-harness` wired to the mediation runtime.

```bash
# 1. Show available entities
npx tsx harness/cli.ts list-entities

# 2. Describe an entity's state machine & capabilities
npx tsx harness/cli.ts describe-entity presence

# 3. List scenarios
npx tsx harness/cli.ts list-scenarios

# 4. Initialize a session
npx tsx harness/cli.ts init harness/scenarios/02-materialize-engage-settled.yml

# 5. Step through operations
npx tsx harness/cli.ts step
npx tsx harness/cli.ts status
npx tsx harness/cli.ts inspect op-1
npx tsx harness/cli.ts annotate op-1 "materialized successfully"
npx tsx harness/cli.ts step
npx tsx harness/cli.ts status

# 6. Show the entire journal
npx tsx harness/cli.ts journal

# 7. Cleanup session
npx tsx harness/cli.ts cleanup
```

## Adding Scenarios
Scenarios are located in `harness/scenarios/*.yml`.
Add new YAML scenarios specifying desired resources and transitions.

## Adding Entities
Entity lifecycle specifications are defined in `harness/entities/*.lifecycle.yml`.
To add new capabilities or entities:
1. Define states and capabilities in a `.lifecycle.yml` file.
2. Update `harness/runner.ts` to implement the capability execution.
