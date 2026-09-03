# Pi Agent Mesh v2.3

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
/mesh agents
/mesh channels
/mesh join                         # reconnect after /mesh leave
/mesh leave                        # disconnect until /mesh join
/mesh join channel1 channel2 channel3
/mesh leave channel2               # leave a channel
/mesh on                           # enable the mesh for every agent
/mesh off                          # disable the mesh for every agent
/mesh @Haven Review the API contract.
/mesh #channel1 Coordinate the release.
```

Only the unified `/mesh` command is registered. There are no legacy command aliases.

## Channels

- Channel names are case-insensitively unique, contain no spaces, and use letters, numbers, dots, underscores, or hyphens.
- Joining a new valid name creates the channel.
- One agent can join multiple channels simultaneously.
- Agents must join a channel before sending to it.
- Join is prospective: older channel messages are not delivered.
- Agent-to-agent coordination is strictly current-channel scoped: direct peers must share a channel, and “all” means all operational peers sharing at least one channel with the sender.
- Recipient IDs are snapshotted at send time, but delivery is rechecked against current membership. Leaving a channel suppresses unread messages that no longer belong to the recipient’s current scope.
- Dashboard Kick from channel revokes membership and discards pending unread messages in that channel through the kick point.
- `/mesh leave` disconnects the current agent, clears its memberships and pending delivery, and prevents automatic registration until the user runs `/mesh join`.
- `/mesh join <channel...>` and `/mesh leave <channel...>` continue to manage channel membership; the argument-free forms reconnect/disconnect the agent.
- Dashboard Remove agent from mesh clears all memberships and pending delivery. The live session must explicitly run `/mesh join`, then join channels again.
- Empty channels remain listed.
- Right-click Close archives a non-default channel, suppresses pending channel delivery, removes memberships, reserves the name, and preserves transcript history.
- Channels are public routing groups under the shared local broker token, not confidential rooms.

## Agent tools

- `agent_mesh_send` — send to a same-channel agent, a joined `#channel`, or all same-channel peers.
- `agent_mesh_agents` — list only peers who currently share at least one channel, including their presence, projects, models, and memberships.
- `agent_mesh_channels` — list, join, or leave channels.
- `agent_mesh_history` — read recent messages limited to the agent’s current channels and its own direct/all conversations.

Restrictive agents receive all four tools additively when addressed.

## Dashboard

The authenticated browser UI provides:

- independently scrolling channel and participant lists with wrapped, non-overflowing text;
- slightly wider side regions without reducing the desktop timeline;
- channel list, message counts, and members;
- color-coded joined channels for the selected agent;
- a flat, small-type compact Membership section below Intervene with Join channel, Kick from channel, and Remove agent from mesh controls;
- compact action buttons including Send Intervention;
- reliable right-click participant Kick/disconnect and channel Close context menus;
- recipient selection for all agents, channels, or direct agents;
- channel-filtered flat timeline;
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
- Slash-command interventions are scoped to the current agent’s channels. Authenticated dashboard interventions retain administrator authority across channels.
- Messages are acknowledged only after injection; delivery remains at-least-once if acknowledgement fails.
- New or explicitly rejoined agents do not receive messages created before registration/rejoin/channel join.
- Administrative removal and voluntary leave are durable; automatic register/reload cannot bypass them.
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

Protocol v2 exposes only nested `destination` data and `recipientAgentIds`; it does not expose legacy message fields. Existing v1 transcript entries are normalized at broker startup while retaining numeric IDs and acknowledgement cursors.

## Verification

```bash
npm run check
pi --no-extensions -e ./index.ts --list-models
```
