# Scoring rubric

Every generated `.testit/` harness must include a self-assessment file:
- `.testit/coverage-score.json`

This score is not allowed to hide gaps or overclaim completeness.
It exists to make the harness auditable.

## Required sections

```json
{
  "generatedAt": "ISO-8601 timestamp",
  "overallScore": 0,
  "maxScore": 100,
  "dimensions": {
    "discovery": { "score": 0, "max": 20, "notes": [] },
    "featureCoverage": { "score": 0, "max": 20, "notes": [] },
    "surfaceCoverage": { "score": 0, "max": 15, "notes": [] },
    "testDepth": { "score": 0, "max": 15, "notes": [] },
    "executionIntegrity": { "score": 0, "max": 10, "notes": [] },
    "dashboardIntegrity": { "score": 0, "max": 10, "notes": [] },
    "gapTransparency": { "score": 0, "max": 10, "notes": [] }
  },
  "blockers": [],
  "warnings": [],
  "summary": "string"
}
```

## Scoring intent

### 1. Discovery — 20
How thoroughly the repository was inspected.
Consider:
- docs and manifests read
- runtime surfaces inspected
- routes/APIs/UI/services/workers/auth/integrations discovered

### 2. Feature coverage — 20
How completely meaningful features are covered by tests or explicit gaps.

### 3. Surface coverage — 15
How completely meaningful technical surfaces are covered by tests or explicit gaps.

### 4. Test depth — 15
Whether the harness includes more than smoke tests.
Consider:
- success paths
- failure paths
- validation
- permissions
- edge cases
- integration boundaries

### 5. Execution integrity — 10
Whether tests actually run through the harness and persist trustworthy results.

### 6. Dashboard integrity — 10
Whether the dashboard exposes the real state, logs, durations, gaps, and evidence.

### 7. Gap transparency — 10
Whether uncovered areas and blockers are explicitly reported instead of hidden.

## Scoring rules

- Never give 100 unless the repository has been deeply discovered and coverage is exceptionally strong with minimal justified gaps.
- Missing coverage matrix => automatic severe penalty.
- Missing explicit gap reporting where blockers exist => automatic severe penalty.
- Shallow smoke-test-only harnesses must score poorly.
- If test execution was not actually validated, reduce execution integrity.
- If the dashboard hides or omits uncovered areas, reduce dashboard integrity and gap transparency.

## Required dashboard display

The dashboard should show:
- overall score
- score by dimension
- warnings
- blockers
- short explanation of why the score is not higher
