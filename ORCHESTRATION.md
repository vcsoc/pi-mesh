# Mesh orchestration

## Continuation and priority interventions

New native team drafts remain bounded: audit-only tokens, $5 estimated cost, review-only current-folder inspection or isolated builds. Advanced settings can explicitly select automatic continuation (`untilComplete: true`); new automatic plans require configured gateway routing and interactive approval. This is not an execution grant from installing Mesh.

The runtime preserves historical approved continuation semantics. Legacy plans without `tokenLimitMode` keep token checkpoints; new explicit numeric token ceilings are hard stops even in automatic mode. Automatic runtime/spawn checkpoints resume retained sessions, and three failed acceptance attempts pause for input. A numeric spending ceiling pauses; ordinary Continue cannot extend it. Stop and approve a new resume/spending tranche instead. `maxCost: null` means no total spending ceiling and is allowed only with explicit automatic approval. Old grants are never rewritten.

Pause and steering request cancellation of active SDK work; controls are checked every 100 ms independently of heartbeat requests, with 250 ms child inbox polling. After cancellation acknowledgement, steering is processed in the retained session before original work continues. Pause waits for Continue. Unacknowledged cancellation requires human recovery; completed side effects are not rolled back. Interrupted host gates are rechecked after handling the intervention. Receipts distinguish requested interruption from successful completion. Untransferred steering survives an explicitly approved resume.

Explicit dashboard user interventions to a supervisor pause its owned workflows. Ordinary native Pi input does not abort or pause anything: Enter steers after the current response/tool batch, and Alt+Enter queues follow-up work after the task. Escape/explicit abort and Mesh controls remain separate. Peer messages remain coordination context. Child status/results appear in dashboard-only #user, not peer inboxes. New runs/resumes still require interactive approval, and old terminal runs are never automatically replayed.

## Quick start

For a read-only reviewer or scout, use a plain command from the project directory:

```
/mesh doctor
/mesh jobs review Check this diff for correctness and missing tests.
/mesh jobs scout Identify the entry points for the login flow.
```

`/mesh doctor` checks the local configuration, broker version/availability, model, registration and run records without starting work or restarting the broker. The review/scout commands build a one-task workflow and show exact task, model, tool and budget scope for interactive approval; canceling does not launch a worker. If you prefer to ask in natural language, ask Pi to preview a Mesh reviewer workflow first. Use `/model` in the parent session if no model is selected.

Advanced commands:

```
/mesh role orchestrator
/mesh jobs profiles
/mesh jobs models
/mesh jobs workflows
/mesh jobs list
/mesh jobs help
```

Preview without launching:

```json
{"action":"preview","definition":{"tasks":[{"profile":"scout","task":"Map the affected execution paths"}]}}
```

Pass that JSON after `/mesh jobs`. Replace `preview` with `run` to request execution. Every run and resume requires an interactive confirmation listing the project, exact models, tools, tasks, command gates, schedule and limits. `background:true` returns a run ID immediately; the detached runner survives Pi exit. Foreground runs wait and are stopped on parent shutdown. `agent_mesh_work` exposes the same operations to the model. Complexity alone does not authorize delegation.

## Multi-agent smoke test

```text
/mesh demo 3
/mesh demo 22
/mesh demo help
```

Request1–64 total agents; at most four run concurrently, in batches. Interactive approval shows exact tasks/models/permissions/limits; cancel/reject starts none. The selected parent model is frozen at approval. Demo scope is immutable and ignores profile overrides: no built-in workspace tools, child extensions, command gates, model fallback or delegation. Workers only calculate a sum, reverse a string or sort a tiny list into a comma-separated result, then return strict JSON. One spawn per task, no retries/schedules/automatic continuation, minimal fresh prompts without parent conversation/project role memory, shared directory, 60 seconds per child and `max($1, count × $0.25)` estimated-cost ceiling; token usage is audited without a token ceiling.

The background run is visible in Work fleet/topology while children are registered. The parent receives a deterministic report with every task, agent identity, result, runtime and expected-value check. PASS requires all requested tasks and gates to pass; partial/failed/cancelled runs are not accepted. Use `/mesh stop <full-run-id>` or inspect retained evidence with `/mesh jobs {"action":"inspect","id":"<run-id>"}`. Normal provider inference costs, SDK sessions, Mesh metadata and vault handoffs still occur; no project work is requested, but this is not a zero-cost/no-filesystem dry run or an OS sandbox. Shared workspace exclusion remains unchanged. Reopening Pi never replays old demos; if the parent closes before the report, inspect the retained run. `/mesh jobs review-demo` remains the separate no-execution UI sample.

## Project channels

Project sessions share a readable channel such as `#mypi`, based on canonical Git root (otherwise folder). Different roots with the same folder name get a discriminator to preserve isolation. Existing generated `project-<name>-<hash>` references remain aliases to the readable channel, including scoped historical queries; transcript records themselves are unchanged. Explicit closure revokes membership and keeps history; aliases cannot reopen a closed channel. A later new registration may create a fresh numbered channel, rather than resurrecting the closed scope. Custom channels and deliberate selections are preserved.

## Names and roles

New sessions default to `<project>-orc`. Set `PI_AGENT_ROLE` before launching Pi or use `/mesh role developer`. Built-in suffixes include:

| Role | Name example |
| --- | --- |
| orchestrator | mypi-orc |
| developer / worker | mypi-dev, mypi-dev1, mypi-dev2 |
| tester | mypi-test |
| reviewer | mypi-rev |
| architect | mypi-arch |
| scout | mypi-scout |
| researcher | mypi-res |
| advisor | mypi-adv |
| auditor | mypi-audit |

For an existing main Pi session, `/mesh role` changes its name and memory namespace, not its active tool permissions. SDK child profiles separately enforce the approved tool ceilings.

The broker allocates names atomically. An online holder is never automatically displaced. An offline holder (explicit shutdown or 20-second heartbeat expiry) can be archived and its name reclaimed. The old ID is revoked; message history and handoffs remain. Replacement instances share durable role knowledge, not session identity. Deliberate custom names remain supported through `PI_AGENT_NAME` and `/mesh name`. Recognizable historical hash-based defaults migrate on re-registration. Explicit operator `--force` rename remains a separate administrative action.

SDK children register in Mesh with their role, exact model and session path. Their actual worktree location appears in the fleet inspector. While running, they consume their normal Mesh inbox: user interventions become scoped steering and peer messages remain coordination context. Delivery acknowledgements and user-instruction handoffs are persisted. Children that receive user interventions publish their final task outcome to dashboard-only `#user`, never to peer inboxes. They otherwise return results through the workflow; they do not impersonate the parent or acquire its peer tools. Finished SDK jobs are not automatic responders: use explicit resume for further work.

## Durable context

Use Markdown for knowledge, JSONL for exact conversations, and JSON for machine state:

```
<project>/vault/
  20-projects/agent-mesh-context/
    index.md
    project.md                      # shared, human-maintained project brief
    developer/
      context.md                    # stable role scope, decisions, conventions
      handoffs/<timestamp>-<id>.md   # immutable outcomes and evidence
    reviewer/...
    orchestrator/...
  30-systems/memory-index.md         # links and timestamped updates

<Mesh data>/runs/<run-id>/
  spec.json                         # immutable approved execution snapshot
  state.json / summary.json         # lifecycle, budgets, steps, schedule
  sessions/<step>/...jsonl          # exact retained SDK conversation
  events.jsonl / runner.log         # bounded event stream / diagnostics
  controls/ / receipts/              # queued control requests and acknowledgements
```

All roles read the shared project brief, their role note, and bounded recent handoffs. Stable notes take priority over recent output. Human notes are never automatically rewritten or consolidated. Main Pi turns, child steps and run-completion receipts append handoffs; thinking blocks are not exported to Markdown or fork context. Handoffs are historical evidence, not authority to expand the next task. Session JSONL remains the authoritative recovery record and may contain sensitive tool output; keep it private. Raw handoffs are Git-ignored by default because task text and model output can contain sensitive material. Review before sharing; ignoring them does not delete them or prevent Obsidian vault backup. Do not put credentials in curated role notes.

`{"action":"context","role":"developer"}` shows the loaded memory and paths. Own source-vault context paths are preserved and excluded from worktree cleanliness checks; other source changes still block isolation/integration. Mesh never commits the vault automatically.

## Profiles and models

Existing main Pi sessions can be configured from another Pi session with `/mesh configure <agent>` or from the dashboard Configure agent tab (right-click the agent in the topology or Participants). This queues a specific `provider/model-id` and/or thinking level for the target session. The target validates available/authenticated models and model-supported thinking levels, waits until idle, applies through Pi's `setModel` and `setThinkingLevel`, and reports an applied or failed receipt. It changes that session only, **not** the startup default, and no model generation is launched just by selecting settings. A queued request is not an applied setting. Offline, pre-reload and immutable child-job identities reject configuration. Previously approved workflow models remain fixed; set the child profile or task model before approval, or explicitly approve a new run.

Built-ins include orchestrator, developer, tester, reviewer, architect, scout, researcher, advisor, auditor, worker and delegate. User overrides live in `<Pi agent dir>/mesh/profiles.json`; project overrides live in `.pi/mesh/profiles.json` in the project root. Example:

```json
{"reviewer":{"write":false,"tools":["read","grep","find","ls"],"prompt":"Review security and correctness. Cite evidence."}}
```

Profiles can specify a `model` as `provider/model-id`. A task can select another currently available model explicitly. No fallback or automatic escalation occurs. Detached execution uses persisted Pi authentication and model configuration, not extracted credentials from a parent session. Runtime-only provider extensions are not inherited; an unavailable exact model fails closed.

`tools` are capped by the parent's active built-in capabilities. A parent with bash can also grant strictly read-only grep/find/ls tools, so scouts can search without receiving a shell; the approval lists the exact built-in child tools. Read-only profiles cannot acquire built-in bash/edit/write. These are tool-availability limits, **not an OS sandbox**. Shell-capable workers can access the same OS resources as the current user. Mesh nested delegation is disabled. Provider retries are disabled. Bounded workflows disable automatic compaction; explicitly approved automatic workflows enable it to retain long-running sessions, so compaction can consume additional model usage. Plan retries/continuation must be explicit.

Child extensions are **opt-in per task** and default to none. At most one previously installed extension can be selected for each task. Add `"extensions":["extensions/my-reviewed-helper.ts"]` to a task to select an already installed entry point under the Pi agent directory. To activate tools from it, also list their exact names, e.g. `"extensionTools":["review_helper"]`; unlisted extension tools stay inactive, although its event handlers and module code still execute. Existing file/directory entry points under `extensions/`, `git/`, or `npm/` can be selected by their relative paths; directories require an `index.ts`, `index.js` or `index.mjs`. Approval lists each path and SHA-256 content snapshot. The runner rechecks the snapshot before loading and fails closed if it changed or disappeared. Symlinked/oversize trees and Mesh itself are rejected; there is no fallback and Mesh never installs or downloads an extension. Other installed/project extensions are not inherited, and package settings are not used for child discovery.

**Security caveat:** an installed extension runs executable code with the worker's OS permissions and may add its own tools regardless of a read-only built-in profile. Hashing its selected files does not pin all transitive dependencies or sandbox runtime behavior. An extension or shell-capable agent could still write files or run an installer with the account's permissions; the no-agent-install rule is an operating policy, not an enforceable OS boundary without a sandbox. Inspect extension source/dependencies and approve its exact selection before use. No external CLI runner or remote-host execution is supported.

## Workflows, lanes, conditions and bounded repair

Save declarative JSON in `<Pi agent dir>/mesh/workflows/<name>.json` or `<project>/.pi/mesh/workflows/<name>.json`. Use `{"action":"run","workflow":"name","background":true}`. Definitions are snapshotted at approval; editing a file does not change an existing grant.

Simple `tasks` default to a sequence. `mode:"parallel"` runs bounded groups and preserves input result order. Advanced definitions use `stages`:

```json
{
  "isolation":"worktree",
  "concurrency":2,
  "stages":[
    {"tasks":[{"id":"plan","profile":"architect","task":"Assess the change. Return JSON with a boolean proceed."}]},
    {"when":{"step":"plan","field":"proceed","equals":true},
     "retries":1,
     "tasks":[
       {"id":"build","profile":"developer","lane":"main","task":"Implement the approved scope"},
       {"id":"check","profile":"reviewer","lane":"main","task":"Review the code. Return JSON verdict and findings.",
        "acceptance":[{"type":"json","required":["verdict","findings"],"types":{"verdict":"string","findings":"array"},"equals":{"verdict":"pass"}}]}
     ]}
  ]
}
```

Stages are sequential. Within a stage, `parallel:true` enables fan-out; otherwise tasks run sequentially. `retries` is 0–2 and repeats the whole stage with prior failure evidence, allowing bounded implement/review repair loops. Conditions reference a preceding step's strict JSON output and one flat field. Malformed predecessor JSON fails rather than guessing. False conditions skip the stage and are recorded in events.

Named lanes reuse an owned worktree across stages. Sequential tasks default to `main`; parallel tasks default to distinct lanes. Parallel writers must use distinct worktree lanes. An advisor council is a parallel stage of advisor/reviewer tasks followed by a synthesis step. `refinement` adds a task-specific prompt overlay without changing tools or model ceilings. `context:"fork"` supplies bounded finalized parent user/assistant text, never private thinking or parent tool privileges.

`watchdog:true` adds an explicitly approved read-only auditor gate after writing stages. It is off by default; there is no automatic per-edit reviewer or duplicate lint runner.

## Acceptance and integration

Runtime completion alone does not prove task success. Foreground results and `wait`/`inspect` report `verification: {runtime, verified, issues}` separately; `verified:false` identifies steps without passing explicit gates, even when runtime says `completed`. **Integrating writing runs requires explicit passing acceptance gates for every writing step**,  in addition to completed runtime and interactive merge approval. Ungated runs can still be inspected, but their workspaces require manual validation/integration rather than the automated merge command. Budget-cancelled or failed steps retain available partial text as *unaccepted evidence*; they never pass gates solely because text exists. Each task may require:

- `{"type":"json","required":["verdict"],"types":{"verdict":"string"},"equals":{"verdict":"pass"}}`: strict JSON object with required fields, optional flat field types and primitive equality checks. No prose-based inference.
- `{"type":"command","command":"npm","args":["test"],"timeoutMs":60000}`: host-owned argv execution in the task workspace, bounded output and timeout, success only on exit zero. Requires the parent's bash capability and explicit command approval. No implicit shell interpolation.

Writing tasks use clean-source detached Git worktrees by default. Dirty source repositories fail preflight before model work; Mesh never silently stashes, commits or switches the source branch. Explicit `isolation:"shared"` permits serial work in the existing folder, with no overlapping Mesh workflow in that project. External editors are outside this coordination lock.

After successful gates:

```json
{"action":"merge","id":"<run-id>"}
{"action":"cleanup","id":"<run-id>","lane":"main"}
```

Merge requires approval, matching source HEAD, and no unrelated source changes. Non-overlapping lanes can be applied together after one combined preflight, preserving binary changes and whitespace. Overlapping lanes require manual reconciliation. Changes are applied to the source index and working tree, **never committed or pushed**. Integration receipts record hashes and diff statistics. Cleanup refuses unintegrated changes or ignored artifacts without explicit `discard:true` approval. Active or ambiguously owned worktrees cannot be removed.

## Scheduling, missions and recovery

Example bounded schedule:

```json
{"action":"run","background":true,"definition":{"tasks":[{"profile":"scout","task":"Check the documented release criteria"}],"schedule":{"at":"<ISO timestamp within seven days>","everyMs":3600000,"maxRuns":3}}}
```

Replace the date with a time within seven days. One-shot schedules use `maxRuns:1`. Recurrences require at least 60 seconds, at most 16 occurrences, and the whole approved schedule must fit the spawn budget. Missed occurrences are not replayed in a catch-up burst. Schedules run while the machine/runner is alive; this is not a system boot service. Explicitly resume interrupted work after a reboot or crash.

Missions store durable objectives, decisions, status and linked evidence:

```json
{"action":"mission","definition":{"objective":"Deliver a tested implementation"}}
{"action":"run","missionId":"<mission-id>","definition":{"tasks":[...]}}
{"action":"mission","definition":{"id":"<mission-id>","decision":"Keep the public API unchanged"}}
{"action":"mission","definition":{"id":"<mission-id>","status":"accepted"}}
```

Mission acceptance requires completed effective runs and explicit passing gates; a successful resumed run can supersede its failed predecessor while retaining the audit trail. It does not imply changes were merged or deployed.

A runner claims its directory once. A stale heartbeat marks it interrupted without automatic replay or unsafe PID killing. `{"action":"resume","id":"..."}` creates a new approved run, restores retained sessions/workspaces, carries budgets forward and skips verified completed steps. Add `message` for an explicit continuation of the final step. Interrupted tool side effects may be uncertain: inspect evidence before resuming. If the old PID still exists, resolve ownership first. Launch/storage locks fail busy rather than race; stale global `.locks/` directories require ownership verification before manual removal. Never remove a run's `owner.lock` to replay it; use a new approved resume.

Offline **name reclamation** alone does not revoke an already approved background grant. Explicit agent/project/global disable or removal does revoke execution. Workers continue to obey their immutable approved scope after the parent exits.

## Fleet controls and limits

The dashboard's **Work fleet** tab lists runs by project, live steps, usage estimates, schedules, output, workspaces, events and receipts. Stop, pause, continue and steering are authenticated and CSRF-checked. Pause requests cancellation of active work and waits for acknowledgement, without rolling back tool side effects. Steering interrupts active children or is persisted for the next step. A queued receipt is not proof the model followed the instruction.

Tool/command operations: `list`, `inspect`, `wait`, `stop`, `steer`, `pause`, `continue`, `receipt`, `profiles`, `models`, `workflows`, `context`, `preview`, `run`, `resume`, `missions`, `mission`, `merge`, `cleanup`, `enable`. Enable/discovery/preview never launch work. Wait can be bounded using `waitMs`.

Generic defaults: 3 concurrent children (maximum 4), 64 total child launches, ten-minute model execution deadline per child, no default token ceiling (metadata audit), estimated cost ceiling 10. Native team UI defaults to bounded $5 estimated cost. Explicit automatic mode treats runtime/spawn values as checkpoints; new numeric token ceilings stay hard and numeric cost ceilings require fresh spending approval when exhausted. At most 4 live runners per project and 8 globally. SDK setup and command gates have separate deadlines. Usage is accumulated across assistant responses and checked between responses; a single response can exceed a ceiling. Estimates are **not a provider billing hard cap**, especially for subscription models or missing usage reports.

Event logs cap at 5 MiB; captured child output at 32,000 characters; queue depth, gate output and model-visible tool reports are bounded. Exact session files and Markdown handoffs are retained, not silently pruned. The local token is shared administrative authority, not a confidentiality boundary between projects.

This implementation is local and declarative. It does not execute arbitrary JavaScript workflow text, provide remote hosts/external model CLI adapters, create terminal panes, automatically inherit parent extensions, or promise OS-level sandboxing. Live provider generation and billing behavior require opt-in acceptance; automated tests use fake model sessions plus real SDK construction, process, Git, broker and browser boundaries.
