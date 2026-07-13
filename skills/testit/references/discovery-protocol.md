# Discovery protocol

This skill must remain project-agnostic.

That means it must not assume any specific stack, framework, router, database, test runner, or UI technology up front.
Instead, it must discover the project shape first, then generate the harness from evidence.

## Universal discovery order

1. Read human docs
   - README files
   - architecture docs
   - contributor docs
   - product docs
   - runbooks

2. Read machine manifests
   - package manifests
   - lockfiles
   - language/tool configs
   - CI configs
   - Docker/compose files
   - env examples

3. Discover runtime surfaces
   - app entry points
   - routes/pages/screens
   - API endpoints
   - services/use-cases
   - schemas/models/types
   - workers/queues/cron jobs
   - CLI commands
   - integration/webhook boundaries
   - auth/permissions
   - persistence boundaries
   - CQRS command/control actions, especially destructive ones where present

4. Discover feature evidence
   Evidence may be inferred only from concrete project artifacts such as:
   - route definitions
   - navigation items
   - page names
   - form flows
   - API handlers
   - domain services
   - schemas and models
   - existing tests
   - event names
   - documentation

5. If GitNexus is available, use it as an additional discovery source
   - inspect indexed routes/endpoints
   - inspect route handlers
   - inspect execution flows and related symbols
   - check whether relevant API endpoints are still left uncovered after the first coverage pass
   - use these findings to strengthen endpoint and behavior coverage

6. Build the coverage matrix before generating tests

## Agnostic strategy selection

After discovery, choose the simplest reliable stack for `.testit/` based on the dominant runtime.

Examples:
- JS/TS app -> Node-based harness
- Python app -> Python-based harness
- Polyglot app -> one orchestration layer plus language-specific subprocess runners

## Forbidden behavior

- Do not pre-assume Playwright unless browser UI evidence exists
- Do not pre-assume Vitest/Jest unless JS/TS is present
- Do not pre-assume pytest unless Python is present
- Do not invent features from generic SaaS expectations
- Do not reuse project-local tests blindly and call coverage complete
- Do not ignore relevant GitNexus endpoint/flow information when GitNexus is available for the project
