# TestIt architecture reference

Use this as the default design for generated `.testit/` harnesses.

## Design goals

1. **Independent**
   - `.testit/` should have its own install/run scripts
   - avoid coupling to the app's existing test layout

2. **Feature-first**
   - tests should map to product/system features
   - the dashboard should explain what each test validates

3. **Single execution contract**
   - CLI and dashboard should call the same runner layer
   - avoid separate logic for UI button runs vs CLI runs

4. **Persisted results**
   - last run and history should be stored under `.testit/results/`

## Recommended layers

### 1. Manifest
`test-manifest.json`

Contains:
- detected technologies
- detected features
- evidence for detected features
- test metadata
- categories
- runner ids
- explicit declared gaps

### 1b. Coverage matrix
`coverage-matrix.json`

Contains:
- feature-to-test mapping
- surface-to-test mapping
- uncovered areas
- reasons for uncovered areas
- confidence/evidence notes

### 1c. Discovery inventory
`discovery-inventory.json`

Contains:
- discovered routes/pages/screens
- discovered APIs
- discovered services/use-cases
- discovered schemas/models
- discovered workers/jobs
- discovered forms/actions
- discovered integrations
- discovered auth/permission surfaces
- discovered admin/operational surfaces
- discovered CLI commands

### 2. Runner layer
A small execution layer that:
- discovers tests
- executes one or all
- captures start/end times
- captures stdout/stderr
- normalizes status
- writes results json + logs
- computes per-test and run-level checksums
- exposes an audit path for discovery-vs-coverage validation

### 3. Test implementations
Organize by feature and type:

```text
tests/
  code/
    auth/
    billing/
  ui/
    auth/
    billing/
```

### 4. Dashboard backend
A very small local server should expose endpoints such as:
- `GET /api/manifest`
- `GET /api/results/latest`
- `POST /api/run-all`
- `POST /api/run-one/:id`
- `GET /api/log/:runId/:testId`

### 5. Dashboard frontend
Should show:
- technologies detected
- feature list
- test list
- per-test status
- duration
- explanation
- logs/error details
- actions to run one or all

## Tooling suggestions by stack

### JavaScript / TypeScript
- code tests: Vitest or Jest
- UI tests: Playwright
- dashboard backend: Node + built-in http or Express

### Python
- code tests: Pytest
- UI tests: Playwright or Selenium
- dashboard backend: Flask, FastAPI, or a tiny built-in server

### Polyglot repos
- keep one orchestration layer in the simplest dominant runtime
- shell out to language-specific runners where needed

## Practical advice

- Do not confuse “meaningful” with “minimal”
- The harness should be broad where the project is broad
- Tag tests by feature and type
- Make all scripts callable from project root
- Write setup instructions in `.testit/README.md`
- If you cannot automate an area safely, record it explicitly as a gap
