# loop-workflow

Provides:
- the `loop` skill
- `/loop`
- `/loop-list`
- `/loop-stop`

## Examples

```text
/loop 10m run npm test and explain any new failures
/loop 5m check if the dev server has any new errors in the log
/loop "Review PR 412 for new comments" --interval 1h --expires 8h
```
