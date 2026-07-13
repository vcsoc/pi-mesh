# Opt-in extensions

These were moved out of `~/.pi/agent/extensions/` to avoid always-on loading.

Archived location:
- `~/.pi/agent/extensions-disabled/`

## Re-enable temporarily

Examples:

```bash
pi -e ~/.pi/agent/extensions-disabled/gitnexus-mcp
pi -e ~/.pi/agent/extensions-disabled/fun-status
pi -e ~/.pi/agent/extensions-disabled/herdr-agent-state.ts
pi -e ~/.pi/agent/extensions-disabled/trident/dgx-chris.ts
```

## Re-enable permanently

Either:
- move the extension back into `~/.pi/agent/extensions/`, or
- add its package/path to `~/.pi/agent/settings.json`

## Recommended always-on set

- `~/.pi/agent/packages/git-hud`
- on-demand skills from `~/.pi/agent/packages/*-skill`
