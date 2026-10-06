# Simplified Mesh UI, review scope and native footer — INSTALLED

Installed with explicit user approval on 2026-10-02 at 14:25 UTC. Existing Pi sessions need `/reload`; activation in the user's current session is not independently verified. Do not apply the patch twice.

## Behavior

- `/mesh` asks for a task; `/mesh team <request>` opens the compact history-style panel. Change / Cancel / Accept, with Advanced and read-only Permissions secondary. Accept is never the default.
- Acceptance binds the exact compiled plan and parent-context fingerprints; drift requires fresh approval. Public tool fields cannot forge this private grant.
- New drafts use bounded execution and $5 estimated cost. Explicit build requests prefer worktrees; review/analysis/ambiguous requests suggest scout → reviewer inspection of current files. Team explicitly selects Review only, Build / fix, or Customize workers.
- Review compilation narrows profile tools to read/grep/find/ls, sets writer flags false, and rejects extensions and command gates, even with overridden project profiles. Review findings do not trigger implementation. Tests are not executed in this scope. Quick review/scout commands carry the same enforced scope.
- The controller still records logs/handoffs. Read-only worker tools are NOT filesystem isolation or OpenShell confinement.
- A native `setStatus('agent-mesh-work', ...)` footer entry observes same-project runtime metadata, including background jobs and restored history: ID, state, worker/activity, tokens and estimated cost. Paused/failed/interrupted and unavailable data remain explicit. FINISHED means see results, not acceptance. No conversation text, footer replacement, automatic control or resume.

## Controlled deployment

The installed runtime remains 2.7.3 plus local UI/controller patches. Never overwrite it with canonical 2.7.4: its runner/fleet/compiler/team factory contain installed-only behavior.

Verified full backup outside discovery:
`/Users/chris/.pi/disabled-extensions/agent-mesh-before-simple-scope-footer-20261002-142512`

Deployment applied `installed-simple-team.patch` to installed `index.ts`/`work.ts` with **zero fuzz**, plus these seven qualified helper files:
`mesh-panel.ts`, `simple-team.ts`, `work-tui.ts`, `work-review.mjs`, `team-scope.mjs`, `run-status.mjs`, `quick-work.mjs`.

Complete before/after SHA-256 comparison confirmed **exactly nine files changed**, matching the staged installed-runtime candidate. All 50 other existing files were preserved. No broker/runner/fleet/workflow/team factory/web/package/history/Guild replacement or production service restart. No inference, replay, resume, commit or push.

### Installed hashes

| File | SHA-256 |
|---|---|
| index.ts | `b74f30ad311428002272655fe469472e02665da040ffd070123ece8635e43543` |
| work.ts | `2afdc65e0a7c455ad32c34bb6cd00420d6a5fd4753cb42c35bb7e4cde4810cce` |
| mesh-panel.ts | `466b83cbcd515c1982705af15b064bf05b73782a4b35e5089d3631fd4ddeb9a6` |
| simple-team.ts | `f28512d34fe84e89eca732875930905201b12ff2517539c81dce6fcfa2e1e5e6` |
| work-tui.ts | `e144a28b1d43e3c5a9e426da8e03d16bb3fedc9fa182228cd3abdc49d89824b7` |
| work-review.mjs | `5f372d3b0a9671b2022356734045af87e5d2d8c4e56a8c92d4caba470d9c24a6` |
| team-scope.mjs | `97b76177f294d81641a15537539d55382348331415a5bafe1b27ef70006547b6` |
| run-status.mjs | `273555b9c463b5b11b25d8142ac7441c0e89cdca8f1a941440a8013d10596b0f` |
| quick-work.mjs | `ec092f01fc1d2a8d40fcfd1948f8552cd6566ba3ec387a2332f5c53215f39870` |

Historical preconditions for reproducing against the backed-up menu version: index `8dddfd416f76f20f6da03b31deb0baee05f386d9fca9f78182a78e95c4ea9a61`, work `77029ebf22bcc5b2f3f47228e8c8181c6742851ed21d8b27d2506fe9ab3ba964`, work-tui `703462b8f1a9d4f78372844cf4847cc8577f248d057c26687f5accc20df74eca`, work-review `740bd5fddfd1d514c294be7993f4a42c91c5c2c3e1daab509781215fd1bdcf76`. New helper files were absent; quick-work matched its prior version exactly except for the new scope marker.

## Acceptance evidence and limits

- Canonical `npm run check`: **66/66 tests passed**. Includes read-only scope enforcement, conservative suggestions, safe UI defaults, exact-grant drift/forgery rejection, footer state transitions/error handling/lifecycle/project filtering.
- Build AND review Accept tests reach only a **verified mocked launch boundary**. No real provider generation or worker acceptance is claimed.
- Real Pi PTY passed for canonical, staged installed-runtime candidate AND actual installed extension: task entry, boxed UI, review scope, model/budget changes, Advanced/details, resize/Cancel, and synthetic paused → finished native footer updates. No execution spec or worker created.
- Actual installed RPC test passed: terminal-only team command refuses without confirmation fallback or worker creation.
- Installed-only compiler qualification passed: bounded read-only review plan retaining read/grep/find/ls. An initial fixture expected read alone; corrected to validate the actual read-only set rather than incorrectly requiring the installed compiler to strip its supported search tools.
- This is not a claim that the entire historical installed test suite passes: legacy RPC/quick-request snapshots predate these intentional contracts and were not overwritten by deployment.

Evidence logs: `/tmp/mesh-retry-final-check.log`, `/tmp/mesh-retry-grant.log`, `/tmp/mesh-retry-pty.log`, `/tmp/mesh-retry-candidate-pty.log`, `/tmp/mesh-retry-candidate-scope.log`, `/tmp/mesh-retry-installed-pty.log`, `/tmp/mesh-retry-installed-rpc.log`, `/tmp/mesh-retry-deployment.json`.
