# Result integrity

Test results must be auditable and tamper-evident.

## Requirements

Every test result entry must include a checksum derived from the result payload.

Recommended approach:
- canonicalize the result object fields in a stable order
- hash with SHA-256
- store the hex digest as `checksum`

## Per-test checksum fields

Each test result entry in `.testit/results/latest.json` and history files should include:
- `id`
- `status`
- `durationMs`
- `startedAt`
- `finishedAt`
- `error`
- `logPath`
- `command`
- `checksum`

The checksum should be computed from the normalized values above, excluding the checksum field itself.

## Canonical checksum recipe

Use the same canonicalization rules across all generated `.testit/` harnesses.

### 1. Canonical object rules
- Use UTF-8 text
- Use JSON serialization with no whitespace beyond required separators
- Sort object keys lexicographically at every level
- Preserve array order exactly as used in the result payload
- Represent booleans and numbers using normal JSON encoding
- Use `null` for missing optional values instead of omitting fields when a field is part of the checksum contract
- Normalize line endings in strings to `\n`
- Do not include the `checksum` field itself when computing a per-test checksum
- Do not include the `runChecksum` field itself when computing a run checksum

### 2. Per-test canonical payload
Canonicalize exactly this object shape before hashing:

```json
{
  "command": "string-or-null",
  "durationMs": 123,
  "error": "string-or-null",
  "finishedAt": "ISO-8601-or-null",
  "id": "string",
  "logPath": "string-or-null",
  "startedAt": "ISO-8601-or-null",
  "status": "passed|failed|running|idle|skipped"
}
```

### 3. Run-level canonical payload
Canonicalize exactly this object shape before hashing:

```json
{
  "checksumAlgorithm": "sha256",
  "finishedAt": "ISO-8601-or-null",
  "runId": "string",
  "startedAt": "ISO-8601",
  "summary": {
    "durationMs": 123,
    "failed": 0,
    "passed": 0,
    "skipped": 0,
    "total": 0
  },
  "tests": [
    {
      "checksum": "hex-string",
      "id": "string"
    }
  ]
}
```

The `tests` array must be sorted by `id` before canonicalization.

### 4. Hashing
- Hash the canonical UTF-8 bytes with SHA-256
- Store lowercase hex output

### 5. Verification
A generated `.testit/` harness should include runner logic that can:
- recompute a per-test checksum
- recompute a run checksum
- flag mismatches clearly in the dashboard and logs

## Pseudocode example

```text
normalize(value):
  if value is string:
    return value with CRLF/CR replaced by LF
  if value is array:
    return [normalize(v) for v in value]
  if value is object:
    return object with keys sorted lexicographically and values normalized recursively
  else:
    return value

canonical_json(value):
  normalized = normalize(value)
  return json_serialize(normalized, separators=(",", ":"), ensure_ascii=false)

per_test_payload(result):
  return {
    "command": result.command ?? null,
    "durationMs": result.durationMs ?? null,
    "error": result.error ?? null,
    "finishedAt": result.finishedAt ?? null,
    "id": result.id,
    "logPath": result.logPath ?? null,
    "startedAt": result.startedAt ?? null,
    "status": result.status
  }

per_test_checksum(result):
  return sha256_hex(utf8(canonical_json(per_test_payload(result))))
```

## Run-level checksum

Each run file should also include a run-level checksum covering:
- run metadata
- summary
- ordered per-test result entries with their checksums

Suggested fields:
- `runChecksum`
- `checksumAlgorithm`: `sha256`

## Dashboard expectations

The dashboard should show:
- checksum for each test result
- run checksum for the latest run
- checksum algorithm used
- a visible indication if integrity metadata is missing

## Strictness

- Do not invent or backfill checksums without computing them from the actual result payload.
- Do not mark a run as fully trustworthy if integrity data is missing.
- If a test could not actually be executed, its result must not pretend success.

## Optional strengthening

Where practical, also persist:
- stdout/stderr digests
- artifact digests for screenshots/videos/traces
- environment fingerprint summary
