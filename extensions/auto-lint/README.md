# auto-lint extension

Global install path:

- `~/.pi/agent/extensions/auto-lint/index.ts`

Reload pi resources after installing or editing:

- `/reload`

What it does:

- Watches successful `write` and `edit` tool results
- Debounces checks by `2500ms`
- Detects common project lint/typecheck commands from the current cwd
- Posts pass/fail results back into the session as `auto-lint` messages
- Shows a footer status: `on`, `off`, or `linting…`

Detected commands:

- Node: `npm run lint`, `npm run lint:fix`, `npm run typecheck`, `npm run format`
- Python: `ruff check .`
- Rust: `cargo fmt --check`, `cargo clippy -- -D warnings`
- .NET: `dotnet format --verify-no-changes`

Command order:

- `npm run lint:fix` runs before other npm checks when present
- Remaining detected checks run in discovery order until one fails

Commands:

- `/lint` — run detected checks immediately
- `/lint-on` — enable auto-lint
- `/lint-off` — disable auto-lint
- `/lint-status` — show enabled state and last result

Behavior notes:

- Auto-lint only triggers after `write` and `edit`; it does not watch `bash`
- If a lint run is already in progress, one follow-up run is queued
- Command output is truncated to the last `12000` characters
- If no supported lint command is detected, the extension warns and does not run anything
