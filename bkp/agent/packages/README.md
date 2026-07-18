# Pi packages in this repo

This folder contains package-ready Pi resources extracted from your local setup.

Each subfolder is an independent Pi package with its own `package.json` and either:
- `extensions/` for extension packages, or
- `skills/` for skill packages

Pi does **not** auto-load `~/ .pi/agent/packages` by convention. A package is only used if you:
- add its path to `~/.pi/agent/settings.json`,
- install it with `pi install <path-or-git-source>`, or
- run Pi with `-e` for temporary use.

## Recommended setup

For the leanest setup, keep only runtime-integrated behavior always on, and keep prompt-heavy modes as skills.

### Recommended always-on packages

These are useful without adding much prompt bloat:

- `~/.pi/agent/packages/git-hud`
- `git:github.com/stnly/pi-grok` *(optional; remove if you do not want it)*

### Recommended on-demand skill packages

These are better as skills than extensions because they are mostly prompt presets and do not need always-on hooks:

- `~/.pi/agent/packages/architect-skill`
- `~/.pi/agent/packages/code-archaeologist-skill`
- `~/.pi/agent/packages/explain-skill`
- `~/.pi/agent/packages/kaban-worker-skill`
- `~/.pi/agent/packages/ops-center-skill`
- `~/.pi/agent/packages/security-auditor-skill`
- `~/.pi/agent/packages/dummy-skill`
- `~/.pi/agent/packages/testit-skill`

## Package types in this folder

### Best kept as extensions

These have runtime hooks, tools, providers, status UI, or integrations:

- `git-hud`
- `gitnexus-mcp`
- `fun-status`
- `herdr-agent-state`
- `dgx-chris`

### Best kept as skills

These are prompt/mode packages and are more efficient as on-demand skills:

- `architect-skill`
- `code-archaeologist-skill`
- `explain-skill`
- `kaban-worker-skill`
- `ops-center-skill`
- `security-auditor-skill`
- `dummy-skill`
- `testit-skill`

## Recommended `~/.pi/agent/settings.json`

Example minimal setup:

```json
{
  "lastChangelogVersion": "0.79.1",
  "defaultProvider": "openai-codex",
  "defaultModel": "gpt-5.4",
  "defaultThinkingLevel": "medium",
  "packages": [
    "git:github.com/stnly/pi-grok",
    "~/.pi/agent/packages/git-hud",
    "~/.pi/agent/packages/architect-skill",
    "~/.pi/agent/packages/code-archaeologist-skill",
    "~/.pi/agent/packages/explain-skill",
    "~/.pi/agent/packages/kaban-worker-skill",
    "~/.pi/agent/packages/ops-center-skill",
    "~/.pi/agent/packages/security-auditor-skill",
    "~/.pi/agent/packages/dummy-skill",
    "~/.pi/agent/packages/testit-skill"
  ]
}
```

If you want the leanest setup possible, remove `pi-grok` too.

## How to use the skills

After the skill packages are added to settings, invoke them on demand:

```text
/skill:architect
/skill:code-archaeologist
/skill:explain
/skill:kaban-worker
/skill:ops-center
/skill:security-auditor
/skill:dummy
/skill:testit
```

Examples:

```text
/skill:architect Design a multi-tenant billing platform.
/skill:code-archaeologist Map this repo and propose modernization phases.
/skill:explain Explain event sourcing in practical terms.
/skill:kaban-worker Implement ticket ABC-123 safely.
/skill:ops-center Diagnose why Docker containers cannot reach Postgres.
/skill:security-auditor Audit auth and RBAC boundaries.
/skill:dummy Generate a standalone HTML explainer for this repo.
/skill:testit Build a full independent .testit harness for this project.
```

## Opt-in extensions

These were moved out of `~/.pi/agent/extensions/` to avoid always-on loading and are now stored in:

- `~/.pi/agent/extensions-disabled/`

Use them only when you actually need them.

### Temporary one-run usage

```bash
pi -e ~/.pi/agent/extensions-disabled/gitnexus-mcp
pi -e ~/.pi/agent/extensions-disabled/fun-status
pi -e ~/.pi/agent/extensions-disabled/herdr-agent-state.ts
pi -e ~/.pi/agent/extensions-disabled/trident/dgx-chris.ts
```

### When to use each opt-in extension

- `gitnexus-mcp` — when you want GitNexus graph/code-flow tools available inside Pi
- `fun-status` — when you want humorous status text
- `herdr-agent-state.ts` — only when using Herdr integration
- `trident/dgx-chris.ts` — only when using your DGX SSH tunnel/custom providers

### Re-enable permanently

Either:
- move the extension back into `~/.pi/agent/extensions/`, or
- add its package/path to `~/.pi/agent/settings.json`

Examples:

```json
{
  "packages": [
    "~/.pi/agent/packages/git-hud",
    "~/.pi/agent/packages/gitnexus-mcp"
  ]
}
```

Or restore the raw extension file/folder to auto-discovery:

```bash
mv ~/.pi/agent/extensions-disabled/gitnexus-mcp ~/.pi/agent/extensions/
mv ~/.pi/agent/extensions-disabled/trident ~/.pi/agent/extensions/
```

## Install packages from this folder

You can reference a local package path directly in settings, or install it explicitly.

Examples:

```bash
pi install ~/.pi/agent/packages/git-hud
pi install ~/.pi/agent/packages/architect-skill
pi install ~/.pi/agent/packages/testit-skill
```

You can also use the shared git repo later:

```bash
pi install git:github.com/vcsoc/pi-packages
```

However, this repo contains many subpackages, so for efficiency it is better to reference only the specific local package directories you want.

## Remove or uninstall a package

To remove a package from Pi, use `pi remove <source>` or delete the entry from `~/.pi/agent/settings.json`.

Examples:

```bash
pi remove git:github.com/stnly/pi-grok
pi remove ~/.pi/agent/packages/git-hud
```

If the package source string in settings matches exactly, `pi remove` is the cleanest option.

## How to remove `pi-grok`

Your current settings include:

```json
"git:github.com/stnly/pi-grok"
```

To remove it:

```bash
pi remove git:github.com/stnly/pi-grok
```

Or manually edit `~/.pi/agent/settings.json` and delete that line from the `packages` array.

After removing it, restart Pi or reload the session/runtime.

## Share these packages with others

Shared repo:

- `git@github.com:vcsoc/pi-packages.git`

This repo currently stores the package content in one place for backup/sharing.

If you later want each package as its own standalone public repo, you can split any subfolder out into a dedicated GitHub repository.

## Notes

- Local path packages are not copied; Pi reads them from disk.
- Skills are usually better than extensions for prompt presets because they avoid always-on runtime overhead.
- Tool-heavy extensions can increase prompt/tool surface, so keep them opt-in unless they are genuinely part of your daily workflow.
- For temporary experimentation, prefer `pi -e <path>`.
