# Recorded daily usage

Open **Daily usage** in the workspace tabs. Choose **Single date** or **Date range (inclusive)**, then **Refresh usage**. Reports group project/channel → logical agent (role/name) → date → exact provider/model and show `INPUT`, `OUTPUT`, `CACHE_CR` (Pi `cacheWrite`), `CACHE_RD`, estimated USD `COST`, `MODELS`, daily model subtotals and per-agent `TOTAL`. Project/channel selectors filter locally; heartbeat polling never rescans usage. Dates use the browser's displayed time zone, including daylight-saving boundaries.

## API

The authenticated, read-only API supports:

- `/api/usage?date=2026-10-14&timezone=Europe/London`
- `/api/usage?start=2026-10-01&end=2026-10-14&timezone=Europe/London`

Omitting dates returns all recorded dates; API time zone defaults to UTC. Mixed date/range filters, invalid calendar dates/time zones and reversed/incomplete ranges return 400.

## Accounting and coverage

Only session files explicitly recorded in Mesh registrations are read, including retained offline/retired agents and SDK workers. Accounting includes assistant responses, recorded cache-warming/other usage entries, nested tool usage, compaction and branch-summary usage. Reasoning tokens are already included in output; one-hour cache writes are already included in cache creation. Summary/tool records without exact model attribution appear under `unknown/unknown`, not an inferred current model.

Registered sessions are cached incrementally; copied resume/branch entries with the same entry ID/timestamp/provider/model/usage are counted once and retain their first registered owner. Prompts, credentials, transcript content and session paths are not exported. Missing/unreadable sessions and incomplete records are disclosed; `—` means unavailable metadata rather than fabricated zero cost. Costs are reported estimates, not subscription invoices or guaranteed charges.

**Historical attribution limits:** project identity owns usage; channel filters use known registrations/memberships and project channel mappings, not a historical destination for every model turn. Multiple memberships do not multiply totals. Unregistered/deleted sessions cannot be recovered, and old records without entry IDs cannot be reliably deduplicated across copied files. Changing an agent's role mid-session does not split old usage by historical role.

## Activation

The Usage API needs the updated broker, not just updated browser assets. Update through Pi's Git package manager and activate only with an authorized, quiescent broker restart. Do not restart active jobs or replay historical work. Preserve configuration, credentials and historical approvals. Afterwards refresh the browser and run `/reload` in existing Pi sessions after current work to load updated handlers.
