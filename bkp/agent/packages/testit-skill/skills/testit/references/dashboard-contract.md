# Dashboard contract

Use this as the baseline contract for `.testit/test-manifest.json` and result files.

## test-manifest.json

```json
{
  "projectName": "string",
  "generatedAt": "ISO-8601 timestamp",
  "sourcePath": "string",
  "technologies": [
    { "name": "Next.js", "role": "frontend framework" }
  ],
  "features": [
    {
      "id": "auth",
      "name": "Authentication",
      "description": "Login, logout, session handling",
      "evidence": [
        { "type": "route", "path": "src/routes/login.tsx", "note": "Login page" }
      ]
    }
  ],
  "gaps": [
    {
      "id": "gap-auth-sso",
      "featureId": "auth",
      "category": "missing-env",
      "summary": "SSO flow cannot be executed locally without provider credentials"
    }
  ],
  "tests": [
    {
      "id": "auth-login-ui",
      "featureId": "auth",
      "name": "Login page accepts valid credentials",
      "description": "Validates the main login journey in the browser",
      "evidence": [
        { "type": "component", "path": "src/components/LoginForm.tsx", "note": "Credential form" }
      ],
      "type": "ui",
      "runner": "playwright",
      "path": "tests/ui/auth/login.spec.ts",
      "command": "npx playwright test tests/ui/auth/login.spec.ts"
    }
  ],
  "apiCoverage": {
    "summary": {
      "discoveredEndpoints": 12,
      "coveredEndpoints": 9,
      "partiallyCoveredEndpoints": 2,
      "uncoveredEndpoints": 1
    },
    "endpoints": [
      {
        "id": "post-/api/v1/auth/login",
        "method": "POST",
        "path": "/api/v1/auth/login",
        "handler": "AuthController.login",
        "evidence": [
          { "type": "controller", "path": "apps/api/src/modules/auth/auth.controller.ts", "note": "Login endpoint" }
        ],
        "authExpectation": "public",
        "coverageStatus": "covered",
        "tests": ["auth-login-ui", "auth-login-api"],
        "coveredBehaviors": ["valid credentials", "invalid credentials"],
        "uncoveredBehaviors": ["rate limiting"],
        "gaps": []
      }
    ]
  },
  "scoring": {
    "scoreFile": ".testit/coverage-score.json"
  }
}
```

## latest.json

```json
{
  "runId": "string",
  "startedAt": "ISO-8601 timestamp",
  "finishedAt": "ISO-8601 timestamp",
  "checksumAlgorithm": "sha256",
  "runChecksum": "hex-string",
  "summary": {
    "total": 12,
    "passed": 10,
    "failed": 2,
    "skipped": 0,
    "durationMs": 120345
  },
  "tests": [
    {
      "id": "auth-login-ui",
      "status": "passed",
      "durationMs": 5342,
      "startedAt": "ISO-8601 timestamp",
      "finishedAt": "ISO-8601 timestamp",
      "error": null,
      "logPath": ".testit/results/logs/auth-login-ui.log",
      "command": "npx playwright test tests/ui/auth/login.spec.ts",
      "checksum": "hex-string"
    }
  ],
  "integrity": {
    "canonicalization": "sorted-keys-json-no-whitespace",
    "stringNormalization": "lf",
    "testSort": "id-ascending"
  }
}
```

## Status values

Allowed statuses:
- `idle`
- `running`
- `passed`
- `failed`
- `skipped`

## Dashboard expectations

The dashboard should merge manifest metadata with latest execution data so a user can see:
- feature
- feature evidence
- test name
- explanation
- type
- status
- duration
- error/logs
- per-test checksum
- run checksum
- explicit coverage gaps
- coverage score
- for API projects, an endpoint coverage table with endpoint method/path, handler evidence, auth expectation when known, coverage status, linked tests, covered behaviors, uncovered behaviors, and gap reasons

## UX requirements

The dashboard should provide:
- a global summary row
- feature-grouped tests
- run all button
- run individual test button
- expandable logs
- visible running state
- visibility into uncovered gaps
- visibility into why each test exists
- visible integrity metadata
- visible coverage score metadata
- visible checksum verification status
- for API projects, a detailed endpoint coverage section that feels more like a coverage report than a simple checklist
