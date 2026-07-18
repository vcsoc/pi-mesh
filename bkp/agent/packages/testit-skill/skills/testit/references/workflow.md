# TestIt workflow

When using `/skill:testit`, follow this order:

1. Read `coverage-standard.md`, `strict-mode.md`, and `quality-bar.md` first
2. Check whether GitNexus is available for the project
3. Inspect docs and manifests
4. Inspect implementation surfaces: routes, APIs, UI, services, schemas, workers, CLI, integrations
5. If GitNexus is available, inspect relevant indexed routes, handlers, execution flows, and endpoint relationships
6. Detect technologies and architecture shape
7. Create `.testit/discovery-inventory.json`
8. Identify key product and system features
9. Build a feature inventory with evidence
10. Build a coverage matrix mapping features/surfaces to tests or explicit gaps
11. Decide which tests are:
   - code tests
   - UI tests
   - integration/API tests
12. Create `.testit/test-manifest.json`
13. Create `.testit/coverage-matrix.json`
14. Create `.testit/coverage-score.json`
15. Create `.testit/README.md` with setup and usage
16. Create independent runner scripts
17. Create dashboard server + frontend
18. Implement tests by feature
19. If GitNexus is available, ensure relevant indexed endpoints and flows are represented in tests or explicit gaps
20. Run targeted tests and a full run if feasible
21. Run the coverage audit
22. Capture assumptions, setup blockers, and remaining gaps in `.testit/README.md`

## Minimum acceptable output

A valid result must include:
- `.testit/test-manifest.json`
- `.testit/coverage-matrix.json`
- `.testit/discovery-inventory.json`
- `.testit/coverage-score.json`
- runnable scripts
- an audit script/run path
- at least one dashboard page
- feature descriptions
- feature evidence
- test descriptions
- ability to run tests individually and all together
- logs and durations surfaced in the UI
- explicit uncovered gaps instead of silent omissions
