# Pi Agent Mesh v2

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
/mesh join channel1 channel2 channel3
/mesh leave channel2
/mesh leave                  # leave all channels
/mesh rejoin
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
- Recipient IDs are snapshotted at send time, so voluntary leave does not discard an already-targeted unread message.
- Dashboard Kick from channel revokes membership and discards pending unread messages in that channel through the kick point.
- Dashboard Remove agent from mesh clears all memberships and pending delivery. The live session must explicitly run `/mesh rejoin`, then join channels again.
- Empty channels remain listed.
- Right-click Close archives a non-default channel, suppresses pending channel delivery, removes memberships, reserves the name, and preserves transcript history.
- Channels are public routing groups under the shared local broker token, not confidential rooms.

## Agent tools

- `agent_mesh_send` — send to an agent, `#channel`, or all agents.
- `agent_mesh_agents` — list agents, presence, projects, models, and memberships.
- `agent_mesh_channels` — list, join, or leave channels.
- `agent_mesh_history` — read recent messages filtered by agent or channel.

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
- channel/destination keyboard navigation;
- light/dark themes and message text scaling;
- complete v2 JSONL export.

## Delivery and authority

- Agent messages use visible custom coordination context.
- Dashboard and slash-command interventions use real Pi user messages.
- Direct, all-agent, and channel destinations store immutable recipient snapshots.
- Messages are acknowledged only after injection; delivery remains at-least-once if acknowledgement fails.
- New or explicitly rejoined agents do not receive messages created before registration/rejoin/channel join.
- Administrative removal is durable; automatic register/reload cannot bypass it.

## Security and storage

- Broker binds only to `127.0.0.1`.
- APIs require a random token; the dashboard uses an HttpOnly, SameSite=Strict cookie.
- Foreign origins and non-JSON mutations are rejected.
- UI renders messages with `textContent` under restrictive CSP.

```text
~/.pi/agent-mesh/config.json
~/.pi/agent-mesh/data/agents.json
~/.pi/agent-mesh/data/channels.json
~/.pi/agent-mesh/data/messages.jsonl
```

Protocol v2 exposes only nested `destination` data and `recipientAgentIds`; it does not expose legacy message fields. Existing v1 transcript entries are normalized at broker startup while retaining numeric IDs and acknowledgement cursors.

## Verification

```bash
npm run check
pi --no-extensions -e ./index.ts --list-models
```
