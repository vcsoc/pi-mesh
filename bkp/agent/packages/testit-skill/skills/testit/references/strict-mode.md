# Strict mode

`/skill:testit` should behave as if strict mode is always enabled.

## Purpose

Strict mode exists to stop shallow harness generation.
A harness should fail its own audit if discovery is broad but the generated test set is narrow.

## Mandatory artifacts

A serious `.testit/` output must include all of these:
- `.testit/test-manifest.json`
- `.testit/coverage-matrix.json`
- `.testit/coverage-score.json`
- `.testit/discovery-inventory.json`
- `.testit/results/latest.json`

## Mandatory gates

The skill must not claim completion unless:
1. discovery inventory exists
2. coverage matrix exists
3. every important discovered surface maps to tests or explicit gaps
4. coverage score exists
5. audit output does not report critical failures
6. when APIs exist, the endpoint inventory is detailed enough to show covered, partially covered, and uncovered endpoints rather than hiding behind a few broad feature labels

## Discovery inventory requirements

`discovery-inventory.json` should capture what was found, not just what was tested.
At minimum include counts and entries for:
- routes/pages/screens
- API endpoints
- services/use-cases
- schemas/models
- workers/jobs/queues
- forms/actions
- integrations/webhooks
- auth/permission surfaces
- admin/operational surfaces
- CLI commands

## Audit failure examples

The harness should fail audit if any of these are true:
- the project clearly contains many meaningful surfaces but only a few tests were generated
- multiple major features have no tests and no explicit gaps
- UI exists but no explanation is given for missing UI coverage
- APIs exist but no API/integration coverage or gap explanation exists
- APIs exist but the endpoint reporting is too shallow to explain which endpoints are actually covered
- workers/integrations exist but are silently ignored
- the score claims high completeness while the matrix shows large uncovered areas

## Expected behavior on failure

If strict audit fails, the harness must clearly report:
- incomplete
- not safe to trust as exhaustive
- which areas remain under-covered
- which artifacts need to be expanded
- for API projects, which endpoints or endpoint groups remain uncovered or only partially covered
