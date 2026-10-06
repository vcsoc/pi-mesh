# Installed Mesh team UI patch

Applied locally on 2026-10-01 after explicit user approval. Only `work.ts` and the two UI helpers changed; installed runtime and history were preserved. User `/reload` is still required. The procedure below describes the original installation—do not apply twice. Deployment evidence and backup location are recorded in `vault/20-projects/agent-mesh.md` in the parent repository.

The independent installed Mesh 2.7.3 contains completion-driven execution code that is absent from the canonical checkout. Do not replace its runtime with the canonical source tree just to change the team UI.

`installed-team-ui.patch` changes only that installed version's `work.ts`. It imports the new native composer/readable approval, preserves the existing team builder and continuation summary, and rechecks model/tool availability before launch. It requires the canonical `work-tui.ts` and `work-review.mjs` beside `work.ts`.

Expected unmodified installed `work.ts` SHA-256:

```text
1fd3b4b90daa339012ea842683c8a14f8cf5965222de6f8d5f0ed2cdaa16628c
```

After explicit deployment approval:

1. Re-read installed state and verify this hash. Stop for reconciliation if it differs; do not force/fuzz the patch.
2. Back up the installed extension outside Pi's extension discovery directory.
3. Apply the patch to `work.ts` and copy only `work-tui.ts` and `work-review.mjs`. Do not replace `index.ts`, broker, runner, fleet, workflow, team builder, dashboard, package version, state or history.
4. Verify byte equality against the qualified candidate. The user reloads Pi to load the new UI. No deliberate production broker restart or worker replay is part of this UI patch.

Qualification: a temporary copy of the actual installed runtime plus these UI changes passed `test/team-tui-smoke.py`. It opened the native editor, selected an exact synthetic model, reviewed the compiled plan, returned with Back, resized and cancelled. No worker or live provider was started. The canonical source also passes this smoke and the automated Mesh suite. The installed files were read-only inspected and their original hashes verified unchanged.

Installed defaults remain automatic continuation/shared workspace/unlimited cost until the user changes them in the composer. The UI prominently warns about the absence of a spending ceiling; selecting Bounded supplies a visible $10 estimated-cost ceiling. This patch does not enable OpenShell enforcement. Canonical source defaults remain bounded and worktree-based; runtime reconciliation is a separate task.
