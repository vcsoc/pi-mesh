---
name: batch
description: Spread one large change across 2-8 parallel worktree-style tracks with a shared contract and consistent merge criteria. Use for large migrations, repetitive structural edits, and codebase-wide standardization.
---

# Batch

Use this skill when the user wants one large change spread across multiple files, modules, or subsystems in parallel or near-parallel tracks.

## Purpose

`/batch` is for large-scale, repeated, pattern-based change.

Typical uses:
- broad migrations
- repeated import replacement
- standardizing config or validation patterns
- applying the same safety pattern across many handlers
- spreading work across worktrees or bounded file groups

## Expected input styles

Examples:

```text
/batch ./services/*/config.ts Update all database configs to use process.env.DB_URI and validate types.
/batch ./src/**/*.tsx Replace LegacyButton with SharedUiButton preserving equivalent props.
/batch ./src/api/*.ts Ensure every route handler uses try/catch and the standard logger.
```

## Required workflow

1. Identify the target set.
   - resolve the file/module scope from the user request
   - confirm whether the task naturally splits by file, feature, or subsystem

2. Define a shared contract.
   - what exact pattern must change
   - what invariants must remain true
   - what validations prove the migration worked

3. Split the work into 2-8 tracks when the scale justifies it.
   - by directory
   - by subsystem
   - by feature area
   - by file clusters

4. Execute each track consistently.
   - inspect local context
   - apply the shared rule
   - avoid accidental semantic drift
   - keep changes scoped

5. Reconcile and validate globally.
   - run lint/tests/builds as appropriate
   - identify any outliers that needed custom handling
   - summarize completed vs partial coverage

## Parallelism guidance

If true parallel worktree orchestration is available, use it carefully.
If not, simulate batch discipline by planning explicit tracks and processing them in structured waves.

The important property is not literal concurrency; it is disciplined decomposition with consistent rules and validation.

## Required output

At minimum provide:
- the target scope
- the track split
- the shared migration contract
- files changed per track
- validation results
- any exceptions or manual follow-up items

## Safety rules

- Do not over-apply regex replacements without inspecting representative cases.
- Preserve semantics, not just syntax.
- Flag files that cannot safely follow the common rule.
- If some targets need bespoke treatment, separate them instead of forcing a broken uniform change.
