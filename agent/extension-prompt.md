# Build a global Pi Git‑Status‑HUD Extension that adds a visible Git status HUD to the UI.

Goal: Create a Pi Coding Agent extension that installs globally (in `~/.pi/agent/extensions/`) and implements a HUD showing Git repository status, inspired by the existing example. The HUD should show branch name, ahead/behind counts, staged/unstaged/untracked counts, conflicts, file changes, insertions/deletions, stash counts, and refresh warnings — without mutating the Git repo. The extension also needs these commands:

- /git-hud — toggles the HUD
- /git-hud-refresh — forces a Git state refresh
- /git-hud-settings — lets the user set polling interval and whether to include churn and stash info

The HUD should automatically refresh on session start, end of turns, and after certain tools (like `bash`, `edit`, `write`) are executed. Polling should be configurable.

Design the extension with proper event subscriptions (`session_start`, `turn_end`, etc.), debounce/refresh logic, and UI hooks so the HUD renders above the editor. Provide defaults, polling logic, and settings parsing.

The code must use the Pi extension API (`pi.on`, `pi.registerCommand`, `ctx.ui.setWidget`, `pi.exec` for Git commands) and TypeScript. It must handle these gracefully:

- Detect when the current directory is not a Git repo
- Timeouts for Git commands
- Errors from the Git CLI
- Optional stash and churn (insertions/deletions) stats

The extension should:

- Be global (auto‑loaded from `~/.pi/agent/extensions/`)
- Prefer non‑blocking, debounced refreshes
- Include help text for commands
- Render clean, readable HUD lines with branch and counts

Code Quality Requirements:

- Well‑typed TypeScript
- Modular functions for status parsing, Git querying, UI
- Reasonable defaults — e.g., polling every 15 s
- Comments on key logic
- Avoid mutating the repo (use `git status`, `git stash list`, etc.)

Deliverables:

1. index.ts (the extension)
2. A short README snippet with install instructions (global)
3. A brief explanation of how polling and debounce are implemented
4. Include settings with defaults and a `/git-hud-settings` command parser.