# mypi

Portable, credential-free backup of my Pi configuration resources.

## Included

- `extensions/` — global Pi extensions
- `skills/` — global on-demand skills
- `themes/` — custom themes
- `packages/` — standalone Pi packages
- `agent/settings.example.json` — safe settings template
- `AGENTS.md` — agent instructions

Secrets, sessions, history, generated caches, binaries, trust decisions, and machine-local settings are intentionally excluded.

## Install

Clone the repository, then copy the resources into `~/.pi/agent/`:

```bash
cp -R extensions skills themes ~/.pi/agent/
```

Packages can be installed individually:

```bash
pi install ./packages/architect-skill
```

Review resources before installing; Pi extensions and skills can execute commands with your user permissions.
