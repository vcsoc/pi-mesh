# goal extension

This extension turns `/goal` into a persistent execution mode built on top of the existing `goal` skill.

## What it does

- registers `/goal` as an extension command
- keeps the active goal contract in session state
- injects the `goal` skill workflow into the system prompt on every turn while active
- shows lightweight goal status in the UI
- keeps the raw skill available as `/skill:goal`

## Commands

- `/goal <task and success contract>` — activate or replace goal mode
- `/goal status` — show the current active goal
- `/goal clear` — stop persistent goal mode

## Architecture sketch

Use a skill for the reasoning contract and an extension for runtime mechanics:

1. **Skill**: defines the autonomous verification-first workflow.
2. **Extension command**: captures `/goal ...` before skill expansion.
3. **Persistent state**: stores the active goal in session custom entries.
4. **Prompt injection**: re-applies the skill instructions each turn while the goal is active.
5. **UI affordances**: status + widget remind the user and model that goal mode is still active.

This keeps both forms:

- `/goal` → enforced persistent mode
- `/skill:goal` → raw skill text/workflow only
