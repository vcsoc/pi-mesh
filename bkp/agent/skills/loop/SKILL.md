---
name: loop
description: Re-run a prompt or check on a schedule and compare each run against prior results. Use for recurring monitoring, repeated testing, and periodic inspection while the session stays active.
---

# Loop

Use this skill when the user wants a prompt or inspection to run repeatedly on an interval.

## Purpose

`/loop` acts like an in-session recurring monitor.

Typical uses:
- run tests every N minutes
- watch logs for new errors
- periodically inspect service state
- re-run a review/check command on a schedule

## Expected input styles

Examples:

```text
/loop 10m run npm test and explain any new failures
/loop 5m check if the dev server has any new errors in the log
/loop "Review PR 412 for new comments" --interval 1h --expires 8h
```

The extension wrapper may handle scheduling. This skill defines how each run should behave.

## Behavior per run

Every loop iteration should:

1. Restate the scheduled objective briefly.
2. Inspect the current project/runtime state relevant to the loop.
3. Compare against prior loop findings when available.
4. Highlight only meaningful deltas when possible:
   - new failures
   - resolved failures
   - new errors in logs
   - changed counts/status
   - regressions
5. Keep the response concise unless the user asked for depth.

## Comparison guidance

Prefer change-aware reporting, not repetitive summaries.

Good examples:
- “No new test failures since the last loop run.”
- “Two new server errors appeared in the log since the prior run.”
- “Build is still failing on the same type error in src/foo.ts:18.”

## Escalation rules

If a recurring loop detects a significant regression:
- call it out clearly
- identify the likely target file/system if evidence supports it
- suggest the next action

If everything is stable:
- say so briefly
- avoid noisy repetition

## Safety rules

- Do not run destructive commands unless explicitly requested.
- Prefer read-only checks for recurring loops.
- If the looped task includes expensive checks, mention likely cost/time.

## Completion semantics

This skill does not decide scheduling. It handles the logic of one recurring run.
The loop continues until canceled, expires, or the session ends.
