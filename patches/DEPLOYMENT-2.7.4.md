# Mesh 2.7.4 — deployed 2026-10-06

This release supersedes the earlier source-only 2.7.4 and scoped installed-2.7.3 patch status. Historical patch files/receipts are retained for their original baselines; do not reapply them to 2.7.4.

## Reconciled release

- New web Agent settings/autocomplete and confirmed, revisioned Security policies **draft** forms.
- Installed continuation/checkpoint runtime, urgent pause/steering, retained resume interventions and supervisor input-priority behavior incorporated into source, not overwritten.
- Simplified native TUI, conservative read-only review scope, exact-plan-bound approval, native footer and completion/blocker reports preserved.
- Default null token ceilings and metadata audits preserved. Explicit new token ceilings stay hard; historical already-approved checkpoint grants retain their semantics.
- New team drafts stay bounded with $5 estimated cost in the native UI, no default token ceiling and worktree isolation for builds. Automatic continuation requires explicit selection/approval and configured gateway routing. Existing grants are not expanded.
- Gateway adapter modules independently vendored; no new global gateway/Guild installation, proxy activation or OS-confinement claim.

## Deployment and recovery evidence

- Full source and installed backups outside extension discovery: `/Users/chris/.pi/disabled-extensions/agent-mesh-before-2.7.4-20261006-172147/{source,installed}`. Private same-home state backup in `state-before/` under the same directory (contains sensitive runtime data; do not publish).
- Acquired the existing filesystem launch lock; fresh raw state and process-ownership checks found no active/ambiguously owned runs. Verified broker PID/command and credential fingerprint, temporarily froze the old broker for the state snapshot, rechecked quiescence, deployed byte-verified release files, then gracefully replaced only that broker.
- Live broker PID `19589` (2.7.3) → `83702` (2.7.4), same loopback port/home/credentials. Version and served management asset hashes verified via fresh HTTP reads.
- All 13 historical run trees byte-identical after activation; original transcript bytes preserved as an append-only prefix; configuration and operational policy unchanged; existing agent IDs retained. Obsolete installed test snapshots replaced from the qualified source suite; originals remain in the full backup.
- Runtime/controller files `runner.mjs`, `workflow.mjs`, `fleet.mjs` and `work.ts` remain byte-identical to the previously installed patched runtime. `index.ts` preserves its intervention behavior and changes its version to 2.7.4. No run replay/resume, worker/provider launch or new approval grant.
- Private deployment manifest/receipt: `/tmp/mesh-274-deployment.json`; contains file hashes and deployment metadata, not credential contents. Do not restore state blindly over newly received messages/operator actions. Any rollback must first verify quiescence/process ownership and preserve post-deployment state. The launch lock is temporary and released after activation.

## Qualification

- Source and actual installed `npm run check`: **88/88 PASS**, serially, including 11 continuation/interrupt/legacy-grant tests and 8 policy compiler tests. Updated fake SDK resets cancellation per prompt and records retained prompt text, reflecting real retained-session behavior.
- Actual source and installed Pi PTY: native task entry, review scope, model/cost editing, advanced permissions, resize/cancel and synthetic paused→finished footer updates PASS, with no worker specification or real inference.
- Actual installed Pi RPC/SDK tests included in the 88-test suite PASS: command discovery, exact fixture model/thinking changes, isolated coordination and SDK construction; terminal-only team approval refuses RPC.
- Source and installed `npm run test:browser`: 110-node topology/workbench regression and standalone real-HTTP Mesh management suite PASS. Covers authenticated revisioned drafts, stale-save rejection, shared validation, keyboard catalogs, import/export, XSS/dirty guards, narrow layouts and exact queued settings. All mutations target isolated fixtures, not production policies/agents.
- Additional staged/installed gateway compatibility probes: 4/4 PASS (three Mesh legacy/null/hard token cases and one independent Guild sanity check), fake transports only. Guild production files/service unchanged.
- Live read-only doctor passes setup/broker/model/session and truthfully warns about four older failed/cancelled project runs; none was replayed.

Logs: `/tmp/mesh-274-final-check.log`, `/tmp/mesh-274-source-pty.log`, `/tmp/mesh-274-browser.log`, `/tmp/mesh-274-management-browser.log`, `/tmp/mesh-274-installed-check.log`, `/tmp/mesh-274-installed-pty.log`, `/tmp/mesh-274-installed-browser.log`, `/tmp/mesh-274-installed-compat.log`.

## Activation and boundaries

The broker is active at 2.7.4. Existing Pi sessions still require **`/reload`** to replace their loaded extension modules; refresh the web dashboard to load new assets. Older 2.7.3 clients accept a same-minor newer broker but are not automatically upgraded.

Security forms remain `draftOnly: true`, `canApply: false`, `enforcement: not-integrated`. Host agents are unconfined and required whole-process no-bypass security is not ready. Successful non-inference qualification/deployment does not establish reliable unattended live-provider completion or compliance certification.
