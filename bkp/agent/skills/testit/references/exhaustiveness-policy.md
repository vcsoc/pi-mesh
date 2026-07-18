# Exhaustiveness policy

This skill should aim for the strongest honest form of exhaustiveness possible on any project.

## Definition

Exhaustive means:
- every meaningful feature found from evidence is represented
- every meaningful technical surface is represented
- each representation results in either:
  - one or more generated tests, or
  - an explicit gap entry with a reason
- coverage includes happy path, failure path, validation path, permission path, and integration path where applicable

## Minimum dimensions to consider

For each feature or surface, evaluate whether tests are needed for:
- startup / load
- success path
- failure path
- validation
- permissions / authz
- empty state
- retry / resilience
- persistence side effects
- integration boundaries
- user-visible regressions
- endpoint-specific coverage
- destructive-control safety coverage where applicable

## Layering policy

Prefer multi-layer coverage when justified:
- unit tests for logic
- integration tests for service/data boundaries
- API tests for contracts
- UI tests for user journeys
- end-to-end tests for critical cross-system flows
- full Playwright tests for major browser product areas where Playwright is appropriate

## Anti-shallow rule

The skill fails its purpose if it only emits a small smoke suite while the repository clearly contains:
- multiple features
- multiple routes/pages
- multiple services
- background jobs
- admin surfaces
- permissions logic
- external integrations

## Honest ceiling rule

If full automation is blocked, the skill must still be exhaustive in identification.
That means uncovered areas must still appear in:
- `test-manifest.json`
- `coverage-matrix.json`
- `coverage-score.json`
- dashboard gap views
- `.testit/README.md`

This is especially important for:
- large product areas
- uncovered API endpoint sets
- destructive CQRS control actions that are unsafe to automate directly

A blocked area must reduce the score unless it is both low-impact and clearly justified.

## Prioritization order

1. Critical user journeys
2. Data integrity and core business logic
3. Auth/authz/security-sensitive flows
4. API and integration contracts
5. Background jobs and asynchronous workflows
6. Admin/operational features
7. Error handling and resilience paths
8. Remaining medium-value surfaces
