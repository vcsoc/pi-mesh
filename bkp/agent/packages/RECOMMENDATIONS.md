# Pi package recommendations

## Keep as extensions

Always-on or runtime-integrated:
- `git-hud`
- `gitnexus-mcp` (enable only when you want GitNexus tools available)
- `fun-status` (optional)
- `herdr-agent-state` (only if using Herdr)
- `dgx-chris` (only if using those custom providers)

## Prefer as skills

Prompt-heavy, on-demand behavior:
- `architect-skill`
- `code-archaeologist-skill`
- `explain-skill`
- `kaban-worker-skill`
- `ops-center-skill`
- `security-auditor-skill`
- `dummy-skill`
- `testit-skill`

## Why

Skills are loaded on demand and are better for prompt presets.
Extensions are better when they register tools, providers, commands with runtime side effects, UI hooks, or background integrations.
