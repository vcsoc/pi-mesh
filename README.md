# Pi Agent Mesh v2.4.1

Global Pi extension for named, observable communication between independent agents and sub-agents through public local channels.

## Activation

Install globally at:

```text
~/.pi/agent/extensions/agent-mesh/
```

Run `/reload` in open Pi sessions, then name and join agents:

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
/mesh version                      # loaded extension semantic version (e.g. Agent Mesh v2.4.1)
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
- Each agent has exactly one **active channel** while it has memberships; new agents start in `#general`. The active channel is persisted by the broker, not just held in Pi UI state.
- `/mesh join` opens Pi's native channel selector, with the active channel first and marked. It lists all open channels and a **Create a new channel…** action. Joining activates the chosen channel. Canceling either dialog changes nothing.
- `/mesh switch` lists all open channels; selecting one makes it active, joining it if necessary. Named `/mesh switch <channel>` requires an existing open channel; use join to create one.
- `/mesh leave` leaves the sole membership immediately. With multiple memberships, it opens a selector containing only joined channels, with the active channel first/preselected and an **All channels** option. With zero memberships, it reports that there is nothing to leave.
- Leaving an inactive membership preserves the active channel. Leaving/kicking/closing the active channel selects the alphabetically first remaining membership, or `null` if none remain. Leaving all channels leaves the agent registered but unable to coordinate until it joins/switches again. Reload does not silently rejoin `#general`.
- Agent-to-agent coordination requires **both agents to have the same active channel**. Shared inactive memberships do not authorize discovery, direct sends, broadcasts, or channel sends. An explicit `#channel` target must be the sender's active channel.
- Join/switch is prospective: unread peer messages from a previous active scope do not return when switching back. The immutable message `scopeChannel`, current active channels, and activation high-water marks are checked on delivery. Historical messages remain in the dashboard/export.
- Dashboard Kick from channel revokes membership and discards pending unread messages in that channel through the kick point.
- Named join/leave forms remain available in non-interactive mode. Joining several channels activates the first requested channel. The picker requires interactive Pi or an RPC client that handles extension UI requests.
- Dashboard Remove agent from mesh still disconnects the agent durably. `/mesh join` reconnects it only after a channel is selected (cancellation leaves it removed); `/mesh rejoin` reconnects without a membership.
- Empty channels remain listed.
- Right-click Close archives a non-default channel, suppresses pending channel delivery, removes memberships, reserves the name, and preserves transcript history.
- Channels are public routing groups under the shared local broker token, not confidential rooms.

## Agent tools

- `agent_mesh_send` — send to a same-active-channel peer, the active `#channel`, or all peers active there.
- `agent_mesh_agents` — list only peers with the same active channel, including presence, projects, models, and memberships.
- `agent_mesh_channels` — list, join, leave, or switch channels. Switch takes exactly one existing channel: `{"action":"switch","channels":["backend"]}`. Agents are instructed not to change the user's chosen channel unless explicitly requested.
- `agent_mesh_history` — read active-channel messages and own direct/all messages stamped with that scope, plus own direct administrator interventions.

Restrictive agents receive all four tools additively when addressed.

## Dashboard

The authenticated browser UI uses a full-viewport Workbench layout, dark by default, with a darker VS Code-inspired background. It provides:

- a resizable, collapsible left Membership topology pane, a central tabbed workspace, and a right inspector with Explorer and Intervene & manage tabs;
- topology channel nodes and agent nodes connected by current memberships; working agents have green backgrounds, idle agents orange, and offline agents grey (status is also labeled);
- node-driven transcript filtering: agent selection shows messages sent by or addressed to that agent, including immutable recipient snapshots; channel selection shows that channel's messages. Selecting the same topology node again clears the filter and returns to All messages;
- channel tabs opened or activated from either the topology, Explorer, or matrix; an existing channel tab is reused rather than duplicated;
- a pinned first Membership matrix tab showing current membership, with ★ marking each agent's active channel, plus clickable channel headings and agent names. Topology and Explorer also display the active channel. Dashboard filtering does **not** switch an agent's active channel;
- pane width and collapsed state persisted in browser storage; drag the divider or use its Left/Right arrows and Home/End keys. Tab lists support arrow-key navigation;
- topology/matrix updates on polling without resetting the active workspace tab; closed channels are removed from the open tabs;
- independently scrolling topology, transcript, matrix, channel and participant lists, and management controls;
- a bottom-pinned status footer with centered [Developed by Chris Visser](https://github.com/vcsoc) attribution;
- channel list, message counts, and members;
- color-coded joined channels for the selected agent;
- a compact Membership section below Intervene in the management tab, with Join channel, Kick from channel, and Remove agent from mesh controls;
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
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node test/workbench-browser.mjs
```

This test uses intercepted fixture responses, not a live broker. It covers topology colors and filtering, channel tabs, matrix updates, polling reconciliation, keyboard/pointer resizing, collapse, inspector tabs, CSP compatibility, and footer positioning at desktop/mobile sizes.
