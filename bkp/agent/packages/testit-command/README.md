# testit-command

Provides command wrappers for the `testit` skill.

## Commands

- `/testit`
- `/testit-report`
- `/testit-audit`
- `/testit-dashboard`

## What they do

- `/testit` bootstraps or maintains the `.testit` harness, updates tests, runs relevant coverage, and regenerates the scored report
- `/testit-report` refreshes and summarizes the current TestIt report
- `/testit-audit` audits the harness against current repo changes and coverage gaps
- `/testit-dashboard` validates or repairs the dashboard and explains how to run it

## Examples

```text
/testit
/testit Add coverage for the new billing flows and refresh the report.
/testit-report
/testit-audit
/testit-dashboard
```
