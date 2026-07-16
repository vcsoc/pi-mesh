# Pi Agent Mesh

Global Pi extension for named, observable communication between independent agents and sub-agents.

## Activation

The canonical installation is:

```text
C:\Users\vcsoc\.pi\agent\extensions\agent-mesh\
```

`C:\Users\vcsoc\.pi\agent\extensions` is linked to the active synchronized harness configuration, so this is one global installation.

Run `/reload` in already-open Pi sessions, then assign names:

```text
/mesh-name Cubed
/mesh-name Haven
```

Open the browser dashboard with `/mesh`, or open the complete dark-theme browser documentation with `/mesh help`. Other commands:

```text
/mesh help
/mesh-name Haven
/mesh-agents
/mesh-send Haven :: Coordinate the telemetry API contract with Cubed.
```

The help page documents every slash command, dashboard feature, agent tool, delivery rule, environment variable, security boundary, and common workflow with copyable examples. The dashboard also links back to the documentation.

Agent tools:

- `agent_mesh_send`
- `agent_mesh_agents`
- `agent_mesh_history`

Set `PI_AGENT_NAME` before launching Pi to name a session or sub-agent immediately. Otherwise a unique `<project>-<session>` name is assigned. Restrictive sub-agents receive the mesh tools additively when addressed so they can reply.

## Behavior

- Dashboard interventions use `pi.sendUserMessage` and are true user steering messages.
- Agent messages use visible custom context and trigger the addressed agent.
- Messages are acknowledged only after injection; unread messages survive restarts.
- New agents do not receive broadcasts sent before they existed.
- The browser UI shows agent presence, color-linked threaded messages, participant/thread filters, fixed flat timeline, light/dark themes, message-panel-only text scaling, intervention controls, and complete JSONL export.
- In the intervention textarea, Enter sends; Shift+Enter or Ctrl+Enter inserts a new line.
- Click a dashboard message and use Left/Right Arrow to navigate its thread; with a participant selected, the same keys navigate only that participant’s messages.

The transcript contains every message exchanged through Agent Mesh. It does not expose private model reasoning or unrelated private Pi session messages.

## Security and storage

- Broker binds only to `127.0.0.1`.
- APIs require a random token; the dashboard uses an HttpOnly, SameSite=Strict cookie.
- Foreign origins and non-JSON mutations are rejected.
- UI renders messages with `textContent` under a restrictive Content Security Policy.

Shared state:

```text
C:\Users\vcsoc\.pi\agent-mesh\config.json
C:\Users\vcsoc\.pi\agent-mesh\data\agents.json
C:\Users\vcsoc\.pi\agent-mesh\data\messages.jsonl
```

Use `PI_AGENT_MESH_HOME` only for isolated tests. Default dashboard URL: `http://127.0.0.1:47831` (open it through `/mesh` for authentication).

## Verification

```bash
npm run check
pi --no-extensions -e ./index.ts --list-models
```

Tests cover two-agent direct delivery, user intervention, acknowledgement, auth/origin rejection, transcript export/restart persistence, actual Pi RPC loading, command discovery, tool discovery, and named registration.
