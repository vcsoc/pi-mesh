# Git HUD extension

Global install path:

- `~/.pi/agent/extensions/git-hud/index.ts`

Reload pi resources after installing or editing:

- `/reload`

Commands:

- `/git-hud` — toggle the HUD
- `/git-hud-refresh` — force a refresh
- `/git-hud-settings interval=15s churn=on stash=on enabled=on` — update settings

Defaults:

- enabled: `on`
- polling: `15s`
- churn: `on`
- stash: `on`

Polling and debounce:

- A background poll runs every `pollIntervalMs` while the HUD is enabled.
- Refresh requests from `session_start`, `turn_end`, and watched tools (`bash`, `edit`, `write`) are debounced by `250ms`.
- If a refresh is already running, new requests are coalesced into one queued follow-up refresh.

Notes:

- The HUD only uses read-only git commands (`git status`, `git diff --shortstat`, `git stash list`, `git rev-parse`).
- When the cwd is not a Git repo, the widget shows a non-repo message instead of failing.
