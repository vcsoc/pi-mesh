# Multi-Agent Configuration

This folder contains project-agnostic specialist agents. The orchestrator supplies each role with a clear task packet, while every agent discovers project-specific rules from the active repository's root instructions and referenced specifications.

## Agents

- `orchestrator` — coordinates specialist handoffs and gates.
- `senior-architect` — architecture, impacts, acceptance criteria, testing strategy.
- `senior-ui-ux-designer` — journeys, flows, components, accessibility, responsive states.
- `senior-backend-developer` — APIs, services, database, auth, tenant isolation, integrations.
- `senior-frontend-developer` — UI routes, components, state, forms, accessibility.
- `senior-test-engineer` — test plans, execution, evidence, final recommendation.
- `senior-code-reviewer` — strict quality gate and scorecard.

Each agent has:

- `AGENTS.md` — role-specific system instructions.
- `agent.config.json` — provider/model/tool/session configuration.

## Provider and Model Defaults

Set an agent-specific provider/model in its `agent.config.json`:

```json
{
  "provider": "openai",
  "model": "gpt-4o"
}
```

Leave either value as `null` to inherit the current/default Pi provider or model. The launcher enforces this by omitting `--provider` and/or `--model` when the field is `null`.

Do not store API keys in these files. Use Pi `/login`, environment variables, or `~/.pi/agent/models.json`.

## Spawning a Sub-Agent

From the project root:

```bash
node scripts/run-agent.mjs senior-architect "Create the architecture plan for the next task"
node scripts/run-agent.mjs senior-code-reviewer --print "Review the unstaged changes"
```

The launcher:

1. Reads `agents/defaults.json`.
2. Reads `agents/<agent>/agent.config.json`.
3. Merges agent config over defaults.
4. Reads `agents/<agent>/AGENTS.md`.
5. Starts `pi` from the project root with the role prompt appended.
6. Omits provider/model flags when they are `null`, causing Pi to use the current/default model selection.

## Required Workflow

Use `agents/agent-registry.json` for the default sequence:

1. Senior Architect
2. Senior UI/UX Designer
3. Senior Backend Developer
4. Senior Frontend Developer
5. Senior Architect verification
6. Senior Test Engineer
7. Senior Code Reviewer

Not every task needs every implementation role. The orchestrator selects applicable roles and provides their scope; all agents must avoid assumptions inherited from another project. Every meaningful feature must still pass the gates required by the active project.
