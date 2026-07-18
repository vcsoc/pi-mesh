# Quality bar

A generated `.testit/` harness is acceptable only if it meets all of the following:

## 1. Evidence integrity
- no invented tests
- no invented features
- no invented selectors/routes/commands
- every feature and test has traceable evidence

## 2. Coverage integrity
- feature inventory exists
- surface inventory exists
- coverage matrix exists
- explicit gaps exist where automation is blocked
- when APIs exist, endpoint-by-endpoint coverage detail exists and is not reduced to only a few representative examples

## 3. Execution integrity
- dashboard can run all tests
- dashboard can run individual tests
- results persist with timing and logs
- per-test checksums are computed from actual result payloads
- run-level checksums are computed and exposed
- failures are inspectable by humans and agents

## 4. Project agnosticism
- harness decisions are made from discovered evidence
- no framework-specific assumptions without evidence
- generated stack fits the actual repository

## 5. Depth
- not just smoke tests
- includes critical paths, negative paths, and edge cases where applicable
- includes UI tests only when UI exists
- includes API/integration tests when those surfaces exist
- includes background/worker tests when those surfaces exist

## 6. Transparency
- claims of completeness are proportional to evidence
- partial coverage is clearly labeled
- all blockers are recorded

## 7. Scoring integrity
- `.testit/coverage-score.json` exists
- the score reflects reality and documented blockers
- shallow harnesses score poorly
- the score explanation is visible and auditable

## Preferred dashboard additions
The dashboard should ideally show:
- feature inventory
- coverage matrix summary
- uncovered gaps
- evidence links/paths
- last run and historical runs
- per-test and run-level integrity metadata
- score breakdown by dimension
- for API projects, a detailed endpoint coverage report with covered/partial/uncovered status and linked tests
