# schedule-workflow

Persistent Pi scheduler package.

Provides a `/schedule` command with:
- interactive create/edit/delete flows
- recurring schedules via `once`, `interval`, or `cron`
- automatic dispatch while Pi is running
- overdue catch-up on the next startup
- execution history
- local standalone HTML reporting via `/schedule report`

## Commands

```text
/schedule
/schedule create
/schedule list
/schedule report
```

## Notes

- Scheduled actions run while Pi is open.
- If Pi was closed when a run became due, the extension catches it up on the next startup.
- Schedule state and reports are stored under `~/.pi/agent/schedule-data/` by default.
