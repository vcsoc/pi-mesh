# Coverage standard

`/skill:testit` must be **evidence-based** and as exhaustive as the available project evidence allows.

## Non-negotiable rules

1. **Do not fake anything**
   - Do not invent features
   - Do not invent routes
   - Do not invent data models
   - Do not invent selectors, APIs, or workflows
   - Do not mark coverage as complete unless you have evidence

2. **Every important test must map to evidence**
   Evidence can come from:
   - README/docs
   - route files
   - UI screens/components
   - API handlers
   - schemas/types
   - service modules
   - database models
   - CLI commands
   - queue/worker definitions
   - existing tests
   - analytics/event definitions
   - config or menu/navigation structures

3. **Every important feature must map to one or more tests**
   If it cannot be tested yet, add a gap entry with the reason.

4. **Every omission must be explicit**
   If something is skipped because of missing secrets, unavailable services, unclear setup, or incomplete understanding, record it in the manifest and README.

## Required coverage process

### 1. Build a feature inventory
For each feature, capture:
- id
- name
- description
- evidence
- user impact
- technical surfaces touched

### 2. Build a surface inventory
At minimum inspect and classify these where applicable:
- UI pages/routes/screens
- reusable UI components with meaningful behavior
- API endpoints
- background jobs/workers
- services/use-cases
- persistence/database boundaries
- auth/permissions
- integrations/webhooks
- CLI commands
- scheduled tasks
- configuration/error handling/empty states
- CQRS command/control actions and destructive operations where present

If APIs exist, the API endpoint inventory must be serious enough to act like an endpoint coverage ledger, not just a short list of examples. Where evidence allows, capture at least:
- method
- path/route
- controller/handler evidence
- auth expectation or permission expectation when discoverable
- tests linked to that endpoint
- covered behaviors for that endpoint
- uncovered behaviors for that endpoint
- explicit gap reason when the endpoint is not fully covered

### 3. Build a coverage matrix
For each feature/surface, track:
- what exists
- what tests cover it
- what test type is used
- what remains uncovered
- why it remains uncovered

For API projects, this matrix must also make it easy to answer:
- which endpoints are fully covered
- which endpoints are partially covered
- which endpoints have no execution coverage yet
- which endpoint behaviors are covered vs still missing

### 4. Generate tests from the matrix
Prefer multiple test layers where justified:
- unit tests for logic
- integration tests for boundaries
- API tests for contracts/handlers
- UI tests for critical user flows
- full Playwright tests for major browser flows where applicable

Also verify whether any important API endpoints remain uncovered after the first pass and add additional coverage where possible.
Do not settle for a handful of representative API tests when the repository exposes many real endpoints.
For destructive CQRS control actions, use safe automation strategies or explicitly gap-report them.

## Exhaustiveness guidance

“Exhaustive” does not mean reckless over-generation. It means:
- find all meaningful features visible from evidence
- cover all high-value and medium-value behaviors
- cover error paths and permissions where applicable
- cover happy path plus important edge cases
- report any remaining gaps honestly

## Required output artifacts

The generated `.testit/` should include:
- `test-manifest.json`
- `coverage-matrix.json`
- `README.md`

## Required gap categories

Use one of:
- `missing-env`
- `missing-fixture`
- `missing-access`
- `ambiguous-behavior`
- `external-dependency`
- `not-yet-implemented`
- `unsafe-to-automate`

## Quality bar

A test harness is not acceptable if it only creates a handful of shallow smoke tests while the project clearly contains more features or subsystems.

If coverage is intentionally partial, the manifest and README must say so clearly and list the missing areas.
For API projects, they must also make the missing endpoint coverage obvious rather than hiding it behind feature-level summaries.
