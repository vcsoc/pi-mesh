# Pi Mesh

Mesh's **only maintained source** is [vcsoc/pi-mesh](https://github.com/vcsoc/pi-mesh). Pi installs a checkout of this repository; `mypi` no longer contains or supplies its runtime. Settings and history remain private on each machine.

## Install and update

Requires Git and Pi 1.0.4 or newer (Node 22.19+). Run on **each machine**:

```sh
pi install https://github.com/vcsoc/pi-mesh.git
```

After current work finishes, run `/reload` in every open Pi session. For subsequent updates:

```sh
pi update https://github.com/vcsoc/pi-mesh.git
```

Then `/reload` again. `pi list` shows the installed Git checkout. No manual copying, separate TypeScript build or npm publication is needed; Pi supplies its own SDK/TUI dependencies and compiles `index.ts` at load time. The package explicitly loads only that extension, not helper modules or tests.

**Migrating from the old manual installation:** back up `~/.pi/agent/extensions/agent-mesh` and move it **outside** `~/.pi/agent/extensions` after installing the Git package, before reloading. If settings explicitly point to that old folder, remove only that old extension entry. Finish active Mesh jobs before moving/restarting the broker. Do **not** move/delete `~/.pi/agent-mesh`: it contains your settings, history, credentials and approved runs. Install/update does not synchronize or replay that state. Existing broker processes may still be using the old path; perform a verified, quiescent restart rather than killing active work.

Developers clone this repository separately, make changes here and push to `main`; machines update their Pi-managed Git checkout with the command above. Do not edit installed checkouts or reintroduce a runtime copy in `mypi`.

## New in 2.7.6 — Sigma.js topology

The topology now uses **[Sigma.js 4.0.2](https://github.com/jacomyal/sigma.js)** (WebGL2) and **Graphology 0.26.0**, not custom SVG drawing. Project hubs contain channel hubs; unique agent points are spaced on deterministic satellite rings around their joined active channel, or their project if no local channel applies. Extra memberships and registered parent/child links add edges, not duplicate agent points. Identically named projects remain separate by project hash/path. Structured overview also includes every project; scoped orbital view retains its channel and all recorded members.

Click a project hub to focus its neighbourhood. Click an agent/channel to read its conversation; right-click for existing actions. Pan, mouse/trackpad/Safari zoom, Fit, search, live status/lineage, theme, workspace shortcuts and orbital controls are retained. Sigma draws the actual nodes, readable labels and solid/dashed relationships; safe HTML controls provide keyboard accessibility. Unavailable WebGL2 produces an explicit accessible-list fallback, never a fake Sigma graph. One renderer/context is updated incrementally; heartbeat-only refreshes do not reconstruct the graph or history.

Assets are self-hosted and authenticated under the existing CSP: no CDN, external graph service or runtime package build. The pinned browser bundle and license notices live in `vendor/`. Maintainers regenerate it with `npm ci --legacy-peer-deps --ignore-scripts && npm run build:topology`; host-provided Pi packages remain peers, never bundled. Layout/model/renderer sources are `topology-layout.mjs`, `topology-structured.mjs`, `topology-model.mjs` and `topology-renderer.mjs`.

**Activation:** update with `pi update https://github.com/vcsoc/pi-mesh.git`. Activate the new authenticated assets only with an authorized, quiescent broker restart and private state preserved; package updates never authorize work/history replay. Refresh the dashboard afterwards; run `/reload` in open Pi sessions after current work to load 2.7.6 handlers.

## New in 2.7.5 — responsive dashboard and daily usage

Unchanged heartbeats no longer rebuild message history, controls or tabs. Message rows are reconciled by identity; live-event bursts are coalesced, hidden dashboard/fleet polling stops, and scroll/focus/selection are preserved. Existing project neighbourhoods, parent/worker lineage, reviews and native Pi queuing are retained.

Open **Daily usage** for project/channel → agent → date → exact provider/model reports, INPUT/OUTPUT/CACHE_CR/CACHE_RD/estimated COST/MODELS and day/agent totals. Choose a single date or an **inclusive** start/end range; the browser's time zone is displayed. Missing history/metadata is disclosed rather than fabricated as zero. [Accounting, historical attribution limits and API reference](USAGE.md).

Update with `pi update https://github.com/vcsoc/pi-mesh.git`. Activate the new broker only when workflows are quiescent; preserve private state and never replay history. Refresh the dashboard afterwards. Run `/reload` in existing Pi sessions after current work to load the updated extension/reviews.

## Compiled Pi and background runners

Background runners use Node, not the compiled Pi executable. When Pi's bundled SDK has no physical `dist/index.js`, install the matching SDK in its private versioned cache:

```sh
PI_VERSION="$(pi --version)"
SDK_PREFIX="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/sdk/$PI_VERSION"
npm install --prefix "$SDK_PREFIX" --ignore-scripts --no-audit --no-fund "@earendil-works/pi-coding-agent@$PI_VERSION"
```

The cache must match the installed Pi version exactly. Reload after installing or updating the extension. Installation does not resume interrupted runs or expand existing approvals

## Work approval

Tool-driven work approvals open the half-height MESH EXECUTION REVIEW panel above the input editor. Exact plan details scroll while Cancel, Reject and Accept stay at the bottom. Use arrows or Page Up/Page Down to scroll, Left/Right or Tab to select an action, and Enter to choose it. Cancel is the default. A terminal too small to review safely cannot approve work.

The collapsed tool transcript stays short; expand it for the full result. Runtime completion remains separate from acceptance evidence

## Version 2.7.6

## Token audit and AI gateway baseline

New requests default to **no token ceiling** (`maxTokens: null`), with metadata audit on. Existing numeric grants retain their limits. Optional ceilings are selected in Advanced → Token budget; `unlimited` restores audit-only mode. New explicit limits are accounting hard stops, including automatic mode, while historic automatic grants retain their checkpoint semantics. Responses/in-flight calls can overshoot before usage is reported.

If installed, the optional global `/ai-gateway` companion extension audits future standard Pi sessions and provides confirmed setup/start/connect/status/grant controls. SDK proxy routing is opt-in; required OS no-bypass enforcement is **blocked**, not falsely enabled. Whole-process confinement and additional provider operations remain unqualified. See `security/gateway/README.md` and `patches/TOKEN-AUDIT.md` for coverage, privacy, backups and tests. New automatic continuation requires proxy routing to audit internal SDK calls.

## Request completion

New `/mesh team` requests start with the selected Pi provider/model. Build/review drafts default to **audit only, no token ceiling**, and a separate $5 estimated-cost ceiling. Repeated/cached prompt input counts each turn, so low cost does not imply remaining tokens. Limits stay finite and approval-bound; old runs are never expanded/replayed automatically.

Launch receipts mean **launched, not completed**. While this Pi session stays connected, newly launched background runs produce a terminal evidence/blocker message; partial edits may remain after failure. Footer/history inspection is still available after reload; a lost observer does not authorize replay. Completion requires workflow gates, not just a starting receipt.

Target live runs explicitly: `/mesh steer <full-run-id> <instruction>` (also `/mesh jobs steer ...`). Pause/continue/stop take the same full ID. Parent Pi queued steering is not a run-control receipt; terminal runs reject steering. App credentials are separate from worker Pi provider settings: never export subscription OAuth/login tokens into a scaffold.

See `patches/COMPLETION.md` for the six-file installed update, preserved runtime/history and test evidence. `/reload` activates this session's changes.

## Project neighbourhoods and live workers

Spatial topology groups agents by canonical project identity into separate outlined neighbourhoods. Orchestrators sit inside their own worker clusters; registered child agents link to their actual parent. Same-named projects with different identities stay separate. Shared/user channels have a separate area. Other layouts, membership links, search, zoom and channel focus remain available.

The dashboard preserves unchanged message/graph DOM during heartbeat polling, indexes channel aliases and message counts, and coalesces live notifications. The broker emits presence notifications only when displayed activity changes, not for every unchanged heartbeat or acknowledgment.

The timeline footer reports live child agents and links to Work fleet. Participants and topology tooltips include recorded role, parent and run identity. Ordinary messages and existing orchestrator sessions do not automatically create workers: use `/mesh team <request>` (or preview a workflow), review its scope/models/budget, then explicitly Accept. Parallel stages run only inside those approved limits. Historical workers without parent metadata remain visible without invented parent links; new workers record their parent/run/task when registered.

Validation includes deterministic 500-agent layout tests, parent/project registration checks, unchanged-heartbeat SSE tests, and browser fixtures with 65 agents/217 messages plus 110-node layout, navigation and mobile checks. Performance measurements are fixture evidence, not a guarantee for every browser or machine.

## Simple Mesh — history-style Pi TUI

Run `/mesh` and enter your task, or `/mesh team <request>` directly. The main view is one compact rounded panel, like prompt-history:

```text
Task        Your request
Team        Review only: Scout → Reviewer (or explicit Build / fix)
Model       Current model (Change sets it for the whole team)
Spending    $5 estimated
Files       Current project, inspect only (worktree for builds)
Run         In background
Advanced    Optional worker/context/limit controls
Permissions Inspect full execution details

[ Change ]    Cancel    Accept
```

**Up/Down** chooses a field. **Enter** changes it. **Tab** selects Change/Cancel/Accept; Enter performs that action. **Escape** cancels. Changing rows resets the action to Change; Accept is never the default.

Run `/mesh jobs review-demo` to test a long sample review using the actual panel. All three actions only close the demo and report the choice; no worker, run or model request is created.

The **MESH EXECUTION REVIEW** panel follows the history browser layout: directly above the input editor, occupying half the terminal height on normal-sized terminals. Its body scrolls with **Up/Down** or **PageUp/PageDown**; the actions stay at the bottom. **Left/Right** (or Tab/Shift+Tab) cycles **Cancel / Reject / Accept**, and **Enter** chooses the selected action. Cancel is selected initially; Escape cancels. Reject returns to editing when available, otherwise refuses the launch. Read-only reviews offer only Cancel. No scrolling or action cycling starts work.

**Accept starts the displayed team**, without a second approval maze. The panel compiles a preview before rendering; acceptance is bound privately to that exact normalized scope, role instructions, model/tool set, limits and parent-context fingerprint. The controller compiles again before launching and requires fresh acceptance if anything changed. Public tool parameters cannot manufacture this UI grant. Existing tool run/resume approval remains interactive.

New UI proposals are **bounded** and use a **$5 estimated-cost ceiling**. Review/analysis/ambiguous requests default to read-only scout → reviewer inspection of current files; explicit build requests prefer separate worktrees. **Team → Build / fix** explicitly changes scope. Review scope strips writer/shell tools even from overridden profiles, rejects extensions and command gates, and does not execute tests or fixes. Runtime logs/handoffs are still recorded. These are new-draft defaults, not edits to old grants/runs or the installed runtime factory. Shared workspace remains an explicit choice for direct edits; dirty worktree preflight never automatically stashes, cleans or switches scope. Model costs depend on provider reports, not a guaranteed billing cap. Host tools remain **unconfined**.

Most users only need Task, Model, Spending and Files. Team chooses Review only, Build / fix, or Customize workers. Team/Advanced expose existing per-worker roles/models/instructions/retries, ordering, context and advanced budgets/continuation. Advanced editing returns to the simple panel, not execution. Permissions opens read-only full details, with no separate approval action. Thinking inherits the parent. These are new SDK workers, not reassignment of existing peers.

The native Pi footer shows the latest same-project run's ID, state, worker/activity, reported tokens and estimated cost, including background work and restored history. It uses a separate `setStatus` entry, not a replacement footer. Paused/failed/interrupted states stay explicit; FINISHED means runtime completion, not acceptance. Polling never resumes or launches work.

`/mesh dashboard` still opens the web dashboard; `/mesh jobs list` inspects runs. Bare `/mesh` no longer opens a browser. Empty command completion shows only the main commands; all existing expert subcommands remain available when typed. TUI-only entry points refuse RPC/print mode without launching anything.

Validation: `npm run check`, `uv run --no-project --with pyte==0.8.2 python test/team-tui-smoke.py`. Native smoke uses isolated state/synthetic models and cancels. Actual launch approval is exercised only against a verified mocked launch boundary; no live worker/model was started. See `patches/SIMPLE-UI.md` for the separately qualified installed-runtime patch.

## Advanced and installed-runtime compatibility

Advanced retains the searchable per-worker editor. Choose **Return to simple view** to retain edits, or cancel it to discard those advanced edits. Removing a worker also removes its gates and requires confirmation. Unsupported models, invalid budgets and failed preflight cannot be accepted.

The 2.7.4 release reconciles the installed 2.7.3 continuation/checkpoint runtime, urgent pause/steering, resume-intervention retention, supervisor input priority, simplified UI, completion reports and default token auditing with the new management forms. New native team drafts remain bounded and conservative; explicit automatic mode, including its spending and gateway requirements, remains available in Advanced. Existing immutable grants/history are preserved. Run `/reload` in each Pi session to activate its commands and refresh the web dashboard. Historical patch receipts remain in `patches/`; see `patches/DEPLOYMENT-2.7.4.md` for this release. No real team is launched by deployment. OpenShell confinement remains unimplemented.

## New in 2.7.4 — management forms

- **Agent settings** in the header opens a target/provider/model/thinking form. Search exact target-advertised models and levels with keyboard autocomplete; unavailable choices fail inline and at the broker. Review the target and check the confirmation box before submitting. Requests bind the observed target generation; reload the catalog after a target restart. Existing queued/applied/failed receipts remain separate. Polling does not overwrite unsaved model choices.
- **Security policies** opens a responsive management dialog: default/project draft scopes, read-only/read-write proposal, up to 16 exact HTTPS REST rules, methods, paths, field errors, compiled preview and comparison against the loaded document. Host/path suggestions are examples, not approvals or evidence of provider availability.
- Import/export Markdown, validate against the same browser/server schema, save confirmed private draft revisions and inspect/restore retained versions. Last 20 revisions per scope are kept under `<mesh-data>/security-drafts/`; restored content becomes a new proposal only after a separate Save. A stale revision is rejected rather than overwriting another editor. On uncertain save/network failure, reload to inspect before retrying. Invalid or unloaded Markdown cannot be saved over the structured form.
- Searchable scopes, agents, providers, thinking levels, channels and recipients retain their native selectors. Type several words, use Up/Down and Enter, Escape to dismiss suggestions. Search text never silently becomes a model choice; catalogs remain authoritative.

**These are policy drafts, not active OpenShell enforcement.** Runtime adapters and administrator activation are incomplete, so Apply is disabled and APIs report `draftOnly: true`, `canApply: false`, `enforcement: not-integrated`. Saving a draft does not change Mesh operational enable/suspend policies, touch the gateway, launch jobs or grant workspace writing. Existing host agents remain unconfined. No regulatory compliance claims. Never include credentials in policies; private revision files are not tamper-proof audit storage.

Deployment preserves the existing Mesh home, broker credentials and run/message history. Policy-draft storage is private and independent of active operational policies. Broker activation, per-session reloads and browser refresh are separate steps; consult the release receipt for the verified installation/activation state.

## New in 2.7.2

- Configure a selected **existing Pi session's actual model and thinking level** with `/mesh configure <agent>` or the workspace Configure agent tab, opened from either agent context menu. The target session validates availability, exact model and supported thinking level, waits until idle, applies through Pi's own session API and acknowledges the result. A queued request is not proof of application. Active approved child jobs cannot be reconfigured; choose their model and thinking before launching.
- Topology layout selector: collision-free spatial graph, structured channel/agent columns and animated 3D-style orbital projection with channel suns and orbiting agent planets. Drag to rotate, Shift-drag to pan, wheel/pinch to zoom, arrows on a focused canvas to rotate, double-click a sphere to focus; reduced-motion preferences pause orbital animation. Right-click a project/channel node or Explorer row and choose **Show system** to focus on its sun and all joined agents; **← Overview** returns to the previous spatial or structured layout. Search highlights matches and directly connected spheres while fading others.
- Close × is visually inside its own conversation tab. Collapse or expand the entire right inspector. Alt+T shows topology only, Alt+M messages only and Alt+R restores all three panels; visible toolbar buttons offer an alternative if a browser reserves a shortcut. The guided walkthrough now covers the new views and controls.

## New in 2.7.1

Adds `/mesh doctor` (read-only local diagnostics), `/mesh jobs review [task]` and `/mesh jobs scout [task]` (single-task shortcuts, still requiring interactive approval), partial-output retention on budget cancellation, an acceptance-evidence requirement for automatic integration of writing runs, and opt-in selection of previously installed child extension entry points with approved content hashes and exact tool names. No external CLI runners or remote hosts are supported. Child extensions are executable code with the local user's OS permissions, not a sandbox. Installed runtime changes take effect after `/reload` in each Pi session. Live-model and native Safari acceptance remain separate.

## New in 2.7

- Spatial, force-arranged membership graph with wheel/trackpad zoom, Mac gesture handling, background-drag panning, Fit, hover/click feedback and type-specific node context menus. Reduced-motion preferences are respected.
- Red × on channel tabs closes only the local view. Red × in Channels closes the channel while preserving history and project files. The protected #user inbox cannot be closed.
- Channels use readable project/folder names shared across sessions. Legacy hashed names remain aliases; immutable transcripts are not rewritten. A short discriminator is used only for same-name collisions across different project roots. Explicitly closed names are not reused.
- Channels, Participants, Mesh controls, Intervene and **Agent access** have clickable, keyboard-accessible headings with persistent fold state. Mesh controls and Agent access start collapsed. The tutorial temporarily expands relevant sections and restores their previous state.
- Jump-to-latest and theme switching use icon buttons with tooltips. Action feedback remains visible when management sections are folded.

Reload every Pi session, open `/mesh`, and refresh the dashboard to activate the broker/channel migration. No project files or message history are deleted.

## Dashboard tutorial

Click **Help** for an in-app, 16-step guided walkthrough. Highlighted regions explain topology, channels, participants, membership, messages, interventions, policies and the work fleet. Navigate with **Next / Previous** or **← / →**; **Exit** or **Esc** closes it and restores your previous view. The tutorial previews local views only; it never sends messages or changes policies. `/mesh help` also opens the walkthrough.

## New in 2.6

- Project-role names (`mypi-orc`, `mypi-dev`, `mypi-dev1`, `mypi-test`, `mypi-rev`, `mypi-arch`), broker-owned online collision protection and offline-only automatic reclamation. Use `/mesh role` or `PI_AGENT_ROLE`; custom names remain available.
- Durable detached SDK runners, retained-session resume, sequential/parallel workflows, conditional stages and bounded repair loops, profiles/models/refinement, isolated worktree lanes, deterministic JSON/command acceptance, explicit multi-lane integration and safe cleanup.
- Approved bounded schedules, missions with decisions and evidence, optional watchdog gates, cumulative usage limits, cancellation/steering receipts, and a Work fleet dashboard. No model calls start without interactive approval.
- Shared project Markdown, per-role editable context and immutable handoffs in `vault/20-projects/agent-mesh-context/`. Exact sessions remain private JSONL; runtime state/receipts use JSON. Raw handoffs are Git-ignored by default, not deleted.
- Requires Pi 0.87+ for work orchestration. Read [ORCHESTRATION.md](ORCHESTRATION.md) for commands, examples, limits and security boundaries. Children have approved standalone built-in tools; the opt-in extension selection does not inherit parent hooks and is not an OS sandbox.

## New in 2.5

- Matrix headers pin inside a dedicated scroll area; activity updates preserve scroll position.
- Topology starts fitted to all nodes, with + / Fit / − controls and responsive fitting.
- A dedicated Status column distinguishes Offline, Idle, Thinking, Working, Waiting on agent response and Disabled. “Selected” in a channel cell means routing selection, not agent activity. Status transitions publish immediately over authenticated server-sent events; the 1.5-second poll remains for offline expiry and recovery. Offline means no heartbeat for 20 seconds or explicit shutdown. Older clients report only idle/working until reloaded.
- Waiting means a question/task was sent and the session settled; it clears on the next message from an expected peer. It is a heuristic, not a correlated task-completion receipt.
- New instances share a readable project/folder channel based on canonical project identity (Git root, otherwise folder). The full project hash remains internal; same-name folders at different roots receive distinct channels rather than being silently merged.
- `#user` is reserved for user broadcasts, selected-recipient interventions and dashboard-only agent replies. Use `/mesh #user message` to broadcast or `agent_mesh_send` to `#user` to reply. No peer delivery of replies. The dashboard supports selected-agent multi-selection. Legacy `#general` memberships migrate to project channels while historical messages remain unchanged; deliberate custom selections are preserved.
- Bounded, approved SDK child jobs are available through `/mesh jobs` and `agent_mesh_work`. See [work orchestration](ORCHESTRATION.md) for execution, recovery, scheduling, role memory and integration details.


Global Pi extension for named, observable communication between independent agents and sub-agents through public local channels.

## Native prompt queuing (fix c1415c5)

Ordinary Pi input is left to Pi's native queues: **Enter** steers after the current assistant response/tool batch, **Alt+Enter** follows up after the current task. It must not call `ctx.abort()` or pause owned Mesh workflows. **Escape**, an explicit RPC abort and intentional Mesh dashboard/run interventions remain cancellation controls.

The fix is included in this Git package. Update using `pi update https://github.com/vcsoc/pi-mesh.git`, then run **`/reload` after current work finishes in each Pi session**. Pulling `mypi` or a separate development clone does not update Pi's managed checkout. Same version labels alone do not prove that an already-running session has loaded the fix. `npm run check` validates syntax plus real SDK/RPC and package registration.

Regression coverage: `test/input-queue.test.mjs` checks the actual callback; `test/input-queue-rpc.test.mjs` uses actual Pi with a local fake SSE provider to preserve in-flight work/tool completion, queued steering/follow-up order and explicit abort; `test/input-queue-tui-smoke.py` verifies real Enter/Alt+Enter and old→new `/reload`. These tests do not use paid providers, real workers or production Mesh state.

```sh
npm run check
python3 test/input-queue-tui-smoke.py
# Isolated reload proof against an archived old extension directory:
MESH_QUEUE_OLD_ROOT=/private/backup/installed python3 test/input-queue-tui-smoke.py
```

## Activation

Use the Git package installation above; `pi list` identifies its checkout. Run `/reload` in every open Pi session after current work finishes, then `/mesh` and refresh the dashboard. New sessions receive project-role names and project channels automatically. Optional overrides:

```text
/mesh name Cubed
/mesh name Cubed --force      # disconnect the current name holder
/mesh channels
/mesh join backend testing release
```

Open the dashboard or documentation:

```text
/mesh
/mesh help
```

Other commands:

```text
/mesh version                      # loaded extension semantic version (e.g. Agent Mesh v2.7.4)
/mesh doctor                       # read-only config/broker/session/fleet checks
/mesh configure <agent>           # choose that online Pi session's model and thinking level
/mesh jobs review Check this diff. # approve a single reviewer before any launch
/mesh jobs scout Find entry points. # approve a single scout before any launch
/mesh agents
/mesh channels
/mesh join                         # choose an existing channel or create one
/mesh switch                       # choose the active channel (joins it if needed)
/mesh switch backend               # activate an existing named channel
/mesh leave                        # leave the sole channel, or choose one / All channels
/mesh join channel1 channel2 channel3 # join all; activate the first requested channel
/mesh leave channel2               # leave a named membership
/mesh rejoin                       # reconnect after removal without joining a channel
/mesh on                           # enable the mesh for every agent
/mesh off                          # disable the mesh for every agent
/mesh @Haven Review the API contract.
/mesh #channel1 Coordinate the release.
```

`/mesh version` reports the loaded extension's version without contacting the broker, so it also works when the mesh is disabled or disconnected.

Only the unified `/mesh` command is registered. There are no legacy command aliases.

## Channels

- Channel names are case-insensitively unique, contain no spaces, and use letters, numbers, dots, underscores, or hyphens.
- Joining a new valid name creates the channel.
- One agent can join multiple channels simultaneously.
- Each agent has exactly one **active channel** while it has memberships; new agents start in a project-specific channel. The active channel is persisted by the broker, not just held in Pi UI state.
- `/mesh join` opens Pi's native channel selector, with the active channel first and marked. It lists all open channels and a **Create a new channel…** action. Joining activates the chosen channel. Canceling either dialog changes nothing.
- `/mesh switch` lists all open channels; selecting one makes it active, joining it if necessary. Named `/mesh switch <channel>` requires an existing open channel; use join to create one.
- `/mesh leave` leaves the sole membership immediately. With multiple memberships, it opens a selector containing only joined channels, with the active channel first/preselected and an **All channels** option. With zero memberships, it reports that there is nothing to leave.
- Leaving an inactive membership preserves the active channel. Leaving/kicking/closing the active channel selects the alphabetically first remaining membership, or `null` if none remain. Leaving all channels leaves the agent registered but unable to coordinate until it joins/switches again. Reload preserves an explicit leave-all rather than silently rejoining a channel.
- Agent-to-agent coordination requires **both agents to have the same active channel**. Shared inactive memberships do not authorize discovery, direct sends, broadcasts, or channel sends. An explicit peer `#channel` target must be the sender's active channel. Exception: `#user` sends a dashboard-only reply without peer recipients, regardless of the selected channel.
- Join/switch is prospective: unread peer messages from a previous active scope do not return when switching back. The immutable message `scopeChannel`, current active channels, and activation high-water marks are checked on delivery. Historical messages remain in the dashboard/export.
- Dashboard Kick from channel revokes membership and discards pending unread messages in that channel through the kick point.
- Named join/leave forms remain available in non-interactive mode. Joining several channels activates the first requested channel. The picker requires interactive Pi or an RPC client that handles extension UI requests.
- Dashboard Remove agent from mesh still disconnects the agent durably. `/mesh join` reconnects it only after a channel is selected (cancellation leaves it removed); `/mesh rejoin` reconnects without a membership.
- Empty channels remain listed.
- Right-click Close archives a non-default channel, suppresses pending channel delivery, removes memberships, reserves the name, and preserves transcript history.
- Channels are public routing groups under the shared local broker token, not confidential rooms.

## Agent tools

- `agent_mesh_send` — send to a same-active-channel peer, the active `#channel`, all peers active there, or `#user` for a reply visible only to the user dashboard.
- `agent_mesh_work` — approved durable workflows, isolated parallel writers, profiles/models, schedules, missions, context, inspection, wait/stop/steer, resume, acceptance, integration and cleanup. Watchdog reviews are opt-in.
- `agent_mesh_agents` — list only peers with the same active channel, including presence, projects, models, and memberships.
- `agent_mesh_channels` — list, join, leave, or switch channels. Switch takes exactly one existing channel: `{"action":"switch","channels":["backend"]}`. Agents are instructed not to change the user's chosen channel unless explicitly requested.
- `agent_mesh_history` — read active-channel messages and own direct/all messages stamped with that scope, plus own direct administrator interventions.

Restrictive agents receive all four tools additively when addressed.

## Dashboard

The authenticated browser UI uses a full-viewport Workbench layout, dark by default, with a darker VS Code-inspired background. It provides:

- a resizable, collapsible left Membership topology pane, a central tabbed workspace, and a right inspector with Explorer and Intervene & manage tabs;
- topology channel nodes and agent nodes connected by current memberships; working agents have green backgrounds, idle agents orange, and offline agents grey (status is also labeled); spatial/structured layouts show all channels, while right-click **Show system** on a channel node or Explorer row opens a single channel sun with all its joined agent planets (active or inactive membership). Use **← Overview** to return to the previous overview layout; viewing a system does not change membership or the message filter;
- node-driven transcript filtering: agent selection shows messages sent by or addressed to that agent, including immutable recipient snapshots; channel selection shows that channel's messages. Selecting the same topology node again clears the filter and returns to All messages;
- channel tabs opened or activated from either the topology, Explorer, or matrix; an existing channel tab is reused rather than duplicated;
- a pinned first Membership matrix tab showing current membership, with ★ marking each agent's active channel, plus clickable channel headings and agent names. Topology and Explorer also display the active channel. Dashboard filtering does **not** switch an agent's active channel;
- pane width and collapsed state persisted in browser storage; drag the divider or use its Left/Right arrows and Home/End keys. Tab lists support arrow-key navigation;
- topology/matrix updates on polling without resetting the active workspace tab; closed channels are removed from the open tabs;
- independently scrolling topology, transcript, matrix, channel and participant lists, and management controls;
- a bottom-pinned status footer with centered [Developed by Chris Visser](https://github.com/vcsoc) attribution;
- channel list, message counts, and members;
- color-coded joined channels for the selected agent;
- a collapsible Agent access section below Intervene, with Join channel, Kick from channel, and Remove agent from mesh controls; Agent access and Mesh controls are initially folded;
- compact action buttons including Send Intervention;
- reliable right-click participant Kick/disconnect and channel Close context menus;
- recipient selection for all agents, channels, or direct agents;
- channel-filtered flat timeline using immutable `scopeChannel` for direct, broadcast, and slash-command messages, plus explicit channel destinations for older channel records. Counts and channel badges use the same rule; current agent memberships never relabel historical messages;
- explicit Active channel matrix column and highlighted active membership cells. Topology uses solid green active-channel links and dashed inactive-membership links;
- participant and presence filters;
- per-participant enabled switches enforced by the broker;
- a global mesh on/off control;
- Kick all by status, defaulting to offline participants;
- project identity hashes with durable project block/unblock controls that apply to every current and future agent in that project;
- channel/destination keyboard navigation;
- light/dark themes and message text scaling;
- complete v2 JSONL export.

## Delivery and authority

- Agent messages use visible custom coordination context.
- Dashboard and slash-command interventions use real Pi user messages.
- Direct, all-agent, and channel destinations store immutable recipient snapshots, then enforce current channel scope again at delivery time.
- Slash-command interventions obey the same active-channel rule as agent messages. Authenticated dashboard interventions retain administrator authority: direct/all interventions may cross active channels, and dashboard channel interventions address current members (including inactive memberships).
- Messages are acknowledged only after injection; delivery remains at-least-once if acknowledgement fails.
- New or explicitly rejoined agents do not receive messages created before registration/rejoin/channel join.
- Administrative removal and membership changes are durable; automatic register/reload cannot bypass them.
- Global, participant, and project blocks are persisted and enforced by the broker for registration, presence, routing, inbox, acknowledgements, and channel mutations.

## Security and storage

- Broker binds only to `127.0.0.1`.
- APIs require a random token; the dashboard uses an HttpOnly, SameSite=Strict cookie.
- Foreign origins and non-JSON mutations are rejected.
- UI renders messages with `textContent` under restrictive CSP.

```text
~/.pi/agent-mesh/config.json
~/.pi/agent-mesh/data/agents.json
~/.pi/agent-mesh/data/channels.json
~/.pi/agent-mesh/data/policy.json
~/.pi/agent-mesh/data/messages.jsonl
```

**2.4.1 channel-filter fix:** direct and broadcast messages retain their original destination but now appear under the channel recorded at send time. The dashboard, `/api/messages?channel=…`, and the agent history tool agree. Older direct/all messages without `scopeChannel` cannot be assigned reliably; they stay in All messages and are labeled “Channel not recorded.” Administrator interventions without a channel also remain in All messages. No stored transcript entries are rewritten.

Topology filtering operates on loaded transcript messages; use Load older messages in Explorer to include earlier history. The graph is a membership view, not traffic telemetry. Presence coloring is independent of participant/project policy switches. At narrow widths the inspector moves below the topology/message split; panels retain their own scrolling and the footer stays visible.

Protocol v2 uses nested `destination`, immutable `recipientAgentIds`, and (since 2.4) immutable `scopeChannel` for agent/scoped-user messages. Public agent records include `activeChannel`; channel listings include `active` for the querying agent. `/api/channels/switch` accepts `{agentId, channel}`. `/api/agent?agentId=…` reads the current agent for pickers.

Upgrade: reload **all** Pi sessions using this extension. Version 2.4 replaces the verified older broker. Existing active selections survive restarts; legacy registrations choose the alphabetically first joined open channel on migration. Old unscoped direct/all agent messages are retained for dashboard/export but are not injected under an ambiguous active scope. No legacy message fields are reintroduced.

## Verification

```bash
npm run check
pi --no-extensions -e ./index.ts --list-models
```

Optional browser regression checks (using an existing Playwright installation):

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

This test uses intercepted fixture responses, not a live broker. It covers graph layout and wheel/gesture handling, typed node menus, local tab closing versus explicit channel closure, protected #user, panel folding, tutorial navigation/restoration, matrix/polling behavior, CSP and desktop/mobile layout. Safari gesture events are simulated; native WebKit/hardware trackpad acceptance is separate.
