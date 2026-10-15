# Project work and decisions — Mesh2.8.1

## Throughput and dependencies

New approvals use a work-conserving dependency scheduler, not four-agent batches. Default `concurrency: "auto"` admits every ready task within the approved plan (up to the existing **64-spawn** grant). Explicit concurrency1–64 remains available. Finished tasks immediately free slots; there is no slowest-member batch barrier. Stage/sequence dependencies remain the default. Set `dependsOn: []` for independent tasks or `dependsOn: ["task-id"]` for explicit dependencies. Unknown references, cycles (including implicit stage dependencies) and duplicate IDs are rejected before approval.

Capacity does not override dependencies, budgets or isolation. Readers run concurrently even with the same profile/lane when no writer uses that lane. Tasks sharing a writable managed lane serialize; shared-directory writers serialize with every task using that shared directory. A blocked writer retains its lane reservation until an explicit decision. Other lanes continue. Worktree creation and transitions occur only after exclusive ownership. Existing fleet limits (eight live runners overall/four per project) and shared-project launch exclusion remain separate from **child concurrency**. Tool/extension restrictions are not OS confinement; code that escapes approved workspace scope cannot be made safe by a lane lock alone.

No automatic new calls, extension changes, model fallback, approval bypass or historical replay. A `retries` allowance reserves budget but new-policy retries need a decision. Historical immutable grants without `failurePolicy: "escalate"` retain their original settlement/continuation behavior.

## Project configuration

`/mesh config` opens an inline, native Pi JSON editor with visible **Cancel / Save** actions, matching the review-panel presentation. Tab cycles editor→Cancel→Save; Enter chooses an action (in the editor it inserts text); Escape cancels. Invalid JSON/schema keeps the draft open. Save is atomic and refuses a stale revision, so two sessions cannot silently overwrite each other.

It edits only `<canonical-project>/.pi/mesh/config.json`, never the global broker token, auth or production defaults:

```json
{
  "version": 1,
  "defaults": {
    "concurrency": "auto",
    "failurePolicy": "escalate",
    "maxCalls": 64,
    "maxCost": 10,
    "timeoutMs": 600000
  },
  "profiles": {}
}
```

New approvals use these defaults; explicitly specified workflow values win. Demo scope stays immutable. Existing approved/running grants never change. Embedded project profiles override built-ins/user profiles; an existing project `profiles.json` still overrides the embedded values. The editor is TUI-only and does not silently save in RPC/print mode.

## Kanban

The default right-hand work view is a **project-scoped Kanban**: Backlog → To Do → In Progress → Testing → Done. The left map is one expandable radial aggregation of projects/channels/agent families, without structured/orbital selectors. Double-click a parent to fold/unfold descendants, with collision-aware motion and group framing. Project context menus offer Kanban and project-only focus; choosing a project in the board also drills down, and All projects restores the full map. See [Expandable topology](TOPOLOGY.md) for hierarchy, local folds, curved membership summaries, type-specific/keyboard menus and reduced motion. Messages, Usage, Fleet, inspector controls, Sigma/WebGL2 and accessible fallback remain available.

Orchestrators use `agent_mesh_tasks` to create/refine tasks, inspect comments, answer questions or escalate. Board creation/refinement alone **does not authorize inference or writes**. For executable work, preview/approve a workflow as usual. Approved task definitions are seeded into To Do and their runner claims/moves cards **on behalf of each child**, using an exclusive owner/lease. Done requires passing acceptance evidence and successful child cleanup/context settlement. Ungated runtime completion stays in Testing, not Done. This is an execution/task lifecycle, not an invented sprint calendar or a substitute for independent review.

An existing unclaimed To Do card can be referenced in an approved workflow task using `boardTaskId`. Its exact `description` and `profile` must match the approved task; duplicate/cross-project/already-bound cards are refused. A separately approved resume retains earlier cards/leases as evidence and creates new cards for remaining work, rather than stealing an old lease; uncertain setup/cleanup/authority refuses replay. This connects user/orchestrator-created backlog work to actual agent execution without silently launching whatever somebody types into a board.

Authenticated task endpoints: `GET /api/tasks?projectHash=<hash>` or `?agentId=<id>`; `POST /api/tasks` with project/agent identity, action, task ID/current version. Supported public actions are create/refine/ready/comment/answer/escalate. Refine can update title/description/profile only before a card is claimed or bound into an approved run; otherwise use comments and fresh approval. Execution transitions are supervisor-owned, not arbitrary browser lane moves. Authentication, existing origin protection and project/role checks apply. The local bearer token remains an administrator credential, not per-process security isolation.

Comments use compare-and-swap versions; conflicts ask for refresh rather than overwrite. Claim/transitions are serialized across broker/runner processes under a filesystem lock and checked owner/lease. No lease timeout auto-steals uncertain work. Active children receive comments through native SDK steering at the next boundary, scoped to that task; comments do not pause other jobs. Queued comments are included at task start. Saved/queued is not proof the model followed a comment; no automatic reopening of a Done card. Oversized comment backlogs block for an explicit summary rather than silently dropping direction.

## Blockers and escalation

A new-policy task encountering provider/runtime/acceptance trouble becomes **blocked**, retaining its evidence and question. It stays in its current lane with a blocker badge. Its supervisor reports to the approving orchestrator; unresolved questions escalate to the user after30 seconds. Independent ready tasks continue; dependencies on the blocked task wait. With no active work, the run stays `waiting` with a live heartbeat, not falsely completed or terminally failed.

The orchestrator can make an explicit within-grant decision or escalate:

```text
/mesh jobs {"action":"decide","id":"<run-id>","taskId":"<step-id>","decision":"retry","message":"Inspected retained evidence; safe directive within the existing scope"}
/mesh jobs {"action":"decide","id":"<run-id>","taskId":"<step-id>","decision":"escalate"}
```

The card also offers Record answer, Retry within grant, and Escalate to user. Recording an answer is not an implicit retry. A retry consumes remaining approved calls/cost; an exhausted grant needs fresh, interactively approved work—this change does not silently top up a run. Unacknowledged cancellation, setup/cleanup ambiguity, revoked authority and persistence failures cannot be blindly retried. Read control receipts: queued ≠ applied. Stop, policy revocation and hard budgets remain real stops. Crashes, unavailable storage/audit and other unrecoverable infrastructure can still fail or interrupt a runner; these conditions cannot honestly be promised away.

## Demo deadline and diagnosis

`/mesh demo N` now proposes **N concurrent independent agents**, not batches of four. Each child has a15-second monotonic deadline including setup, a minimal fresh prompt and the lowest supported thinking level (off when supported). Cancellation starts at the deadline; cleanup acknowledgment can take additional time. A missed deadline or wrong result becomes a decision blocker, never fabricated PASS. Provider latency/availability cannot be guaranteed, and shortening a deadline cannot guarantee success. The immutable demo grant still allows only one spawn per requested task; more attempts require fresh approval if its budget is exhausted.

Requested historical run `71c5bd66-bccc-494b-a2e2-65cd24661c49` was a41-agent demo in mesh-sample-1:20 children started,19 passed; demo-019 returned no text before60-second cancellation. The old fail-fast batch loop left21 unstarted and settled the run failed. The recorded child assistant event is aborted/“Request was aborted”, not a confirmed429, authentication error or incorrect arithmetic. The original provider stall is unknown. No production run was retried or modified while diagnosing it.

## Activation and evidence

Install updates through Pi's Git package manager, not by copying runtime files. Package publication does not activate an already-running broker or refresh a loaded native session. Finish current work and restart Pi normally after installing an update (`pi --continue`/`pi --resume` from the same project). `/reload` can leave native `.mjs` helpers cached and mix versions. Do not restart active brokers or overwrite managed installations. Private state is not synchronized or replayed.

Qualification uses isolated synthetic SDK/provider fixtures, temporary brokers/projects and real browser/TUI components—never paid inference or production workers. See `test/project-flow.test.mjs`, `test/project-kanban-browser.mjs`, the22-child local-SSE RPC demo test and the existing queue/approval/UI suites.
