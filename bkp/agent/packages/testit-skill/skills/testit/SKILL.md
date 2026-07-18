---
name: testit
description: Analyze any software project, bootstrap GitNexus if needed, build and maintain a full .testit harness with unit, integration, API, and UI coverage, and produce scored test reports. Use when the user wants exhaustive project-specific testing and ongoing change-aware test maintenance.
---

# TestIt

Build and maintain a **project-specific, application-independent, change-aware** test harness inside `.testit/`.

This skill is intended to be run via `/skill:testit` or a wrapper command such as `/testit`.

## Primary goal

Given any project, you must:
- inspect the repository deeply
- bootstrap GitNexus for the repo if it is not already available
- discover features, functions, files, routes, UI, and execution flows
- create a serious `.testit/` harness that can be re-run later
- generate tests for every meaningful touchpoint you can prove exists
- on later runs, detect git and GitNexus changes and expand/amend the tests accordingly
- produce a scored TestIt report for every run

## Operating modes

Treat every invocation as one of these modes:

1. **Bootstrap mode**
   - `.testit/` does not exist yet, or is incomplete
   - create the harness from scratch

2. **Maintenance mode**
   - `.testit/` already exists
   - refresh discovery, detect code changes, add/adjust tests, run the right tests, and regenerate reports

If uncertain, default to maintenance mode and only rebuild missing pieces.

## Mandatory GitNexus workflow

GitNexus is required whenever possible.

1. First determine whether GitNexus is available for the current repo.
   - Use GitNexus tools when they are available.
   - If available but stale or missing an index for the repo, re-index it.

2. If the repo is not indexed, initiate indexing.
   - Prefer the available GitNexus command path if present.
   - Run `gitnexus analyze` from the project root when needed.
   - If a Pi command wrapper exists, you may use that too, but do not stop just because the wrapper is absent.

3. After indexing, use GitNexus as a primary discovery source for:
   - routes
   - handlers
   - execution flows
   - symbols
   - impacted code from diffs
   - blast radius for changed areas

4. If GitNexus truly cannot be used because it is not installed or cannot run, continue with repository discovery, but explicitly report the GitNexus gap and treat coverage confidence as lower.

## Change-aware maintenance workflow

On every run, do all of the following before generating or updating tests:

1. Inspect git state.
   - Use `git status --short`
   - Use `git diff --name-only`
   - Use `git diff --cached --name-only` when relevant
   - Identify newly added, modified, deleted, and renamed files

2. Inspect GitNexus change impact when available.
   - Use `gitnexus_detect_changes`
   - Use `gitnexus_impact` for high-value changed symbols or modules
   - Use route-specific or symbol-specific GitNexus tools where relevant

3. Compare current discovery against existing `.testit/` artifacts.
   - Update the feature inventory
   - Update endpoint inventory
   - Update function/module coverage mappings
   - Add tests for new or changed behavior
   - Retire or flag tests targeting deleted behavior

4. Re-run at least the impacted tests.
   - Also run broader suites when changes are cross-cutting
   - Do not claim the harness is current unless changed surfaces are reflected in the tests and report

## Coverage standard

Be exhaustive from evidence.

Cover all meaningful project surfaces you can prove exist, including where applicable:
- functions and modules
- domain logic
- API routes and handlers
- services and use-case layers
- data validation
- database boundaries
- workers and jobs
- CLI commands
- UI screens and user flows
- permissions and auth behavior
- critical edge cases and error states

Do **not** settle for a few smoke tests when the repo clearly contains richer behavior.

If a surface cannot yet be safely or reliably covered, list it as an explicit gap with the reason.

## Test generation goals

Build tests appropriate to the stack, for example:
- JS/TS: Vitest or Jest, plus Playwright for browser UI when appropriate
- Python: Pytest, plus Playwright or Selenium when appropriate
- Mixed stacks: choose the simplest reliable combination

For UI projects, include meaningful browser coverage for the major user journeys, not just page-load checks.

For API projects, generate endpoint-by-endpoint coverage with:
- success behavior
- validation behavior
- auth/permission behavior where applicable
- important failure modes

## Required `.testit/` outputs

Create and maintain these files unless the stack requires a close equivalent:

- `.testit/README.md`
- `.testit/test-manifest.json`
- `.testit/coverage-matrix.json`
- `.testit/discovery-inventory.json`
- `.testit/coverage-score.json`
- `.testit/testit-report.json`
- `.testit/testit-report.md`
- `.testit/results/latest.json`
- `.testit/results/history/`
- `.testit/results/logs/`
- `.testit/dashboard/`
- `.testit/runners/`
- `.testit/tests/`

Also ensure the harness supports running later without rebuilding everything manually.

## Required run commands

Create runnable commands/scripts for at least:
- install
- run-all
- run-one <test-id>
- dashboard
- audit
- refresh-discovery
- refresh-report

If the stack is JS-based inside `.testit/`, these should usually be exposed via `.testit/package.json` scripts.

## `/testit` command behavior target

Assume a wrapper command may invoke this skill at any time.

When the skill runs, it should:
1. detect whether `.testit/` already exists
2. bootstrap GitNexus if needed
3. refresh discovery and change impact
4. generate or amend tests
5. run the correct tests
6. regenerate the TestIt report
7. summarize what changed in the harness

## Mandatory scoring model

Every generated test must have both:
- a **weight** from `1` to `5` indicating importance/criticality
- a **score** from `0` to `5` indicating current test quality/confidence

Score each test based on evidence such as:
- breadth of behavior covered
- realism of assertions
- stability/repeatability
- whether it covers happy path only or also errors/permissions/edge cases
- whether it is direct evidence-based coverage or only shallow smoke coverage

### Interpretation guide

- `5` — strong, high-confidence, behavior-rich coverage
- `4` — solid coverage with minor gaps
- `3` — useful but incomplete coverage
- `2` — shallow or narrow coverage
- `1` — very weak placeholder coverage
- `0` — broken, skipped, or non-working test

## Mandatory TestIt report

You must create a report listing **every test** with at least:
- test id
- feature name
- short description
- target filename
- target symbol/route/screen if known
- test type (`unit`, `integration`, `api`, `ui`, `e2e`, etc.)
- current result/status
- short outcome/comment
- weight out of 5
- score out of 5
- last duration if known
- related changed files if this run was change-driven

### Report files

1. `.testit/testit-report.json`
   - machine-readable full report

2. `.testit/testit-report.md`
   - human-readable summary table and findings

The markdown report should include:
- overall summary
- coverage strengths
- explicit gaps
- changed files considered this run
- tests added or updated this run
- tests that failed
- average score by category
- lowest-scoring important tests needing improvement

## Minimum report row fields

Each test row/object should include fields equivalent to:
- `id`
- `feature`
- `description`
- `targetFile`
- `targetName`
- `type`
- `status`
- `outcome`
- `weight`
- `score`
- `durationMs`
- `changedBecause`

## Discovery requirements

Before generating tests, inspect:
- `README*`
- package and lock manifests
- TS/JS/Python/Rust/Go/etc. build files
- route/page files
- handlers/controllers
- services and domain modules
- schemas and models
- workers/jobs
- CLI surfaces
- auth and permission code
- visible UI components and flows
- CI config if it reveals how the app is exercised

Use GitNexus findings as an additional discovery layer, not a substitute for reading key code.

## Change-driven test expansion rules

When code changed since the previous run:
- add tests for newly introduced files, routes, symbols, and behaviors
- revise tests whose targets changed
- increase coverage around impacted execution flows
- detect deleted or moved targets and update the report accordingly
- do not leave stale test metadata pointing at removed files without flagging it

If a change touches a high-risk area like auth, billing, state mutation, persistence, or shared UI primitives, broaden regression coverage beyond only the directly edited file.

## Dashboard requirements

The dashboard must make it easy to:
- list all tests
- run all tests
- run one test
- view per-test results
- view per-test score and weight
- view target file and description
- view failure logs
- view coverage gaps
- view changed files and changed-surface impact from the latest maintenance run

## Honesty rules

- Do not fake coverage.
- Do not invent routes, selectors, or features without evidence.
- Do not claim full coverage when there are explicit gaps.
- If GitNexus could not be initialized, say so clearly.
- If UI automation is not feasible, record the reason and lower the affected scores.

## Completion checklist

Before finishing, verify that you have:
- ensured GitNexus is available or explicitly documented why not
- created or updated `.testit/`
- created or updated all key manifest and report files
- generated tests for all meaningful discovered surfaces possible from evidence
- used git and GitNexus change detection to refresh the harness
- assigned every test a weight and score out of 5
- produced `.testit/testit-report.json`
- produced `.testit/testit-report.md`
- included target filenames and outcomes for every listed test
- included explicit gaps instead of silently skipping areas
- made the harness runnable again later from `/testit`

## Reference files in this skill

Read and follow these references as needed:
- `references/architecture.md`
- `references/dashboard-contract.md`
- `references/workflow.md`
- `references/coverage-standard.md`
- `references/discovery-protocol.md`
- `references/exhaustiveness-policy.md`
- `references/quality-bar.md`
- `references/scoring-rubric.md`
- `references/result-integrity.md`
- `references/strict-mode.md`
