# Pi Usage

Global Pi extension that reports recorded token usage and cost per provider/model across session JSONL files.

```text
/usage                         # today
/usage models                  # all used and currently available models
/usage today
/usage week                    # current calendar week, Monday through now
/usage month                   # current calendar month through now
/usage @gpt-5.6-sol today
/usage 260701 260717
/usage 2607171200 2607171430
/usage @openai-codex/gpt-5.6-sol 260701 260717 --md
/usage month --html
```

Date ranges use local time and include both boundaries. Six-digit dates cover the full ending day; ten-digit timestamps cover the full ending minute.

The TUI table supports Up/Down, Page Up/Page Down, Home/End, and Enter/Escape to close. `--md` and `--html` must be the final argument and export to `<cwd>/.pi-reports/usage/`.

The scanner includes assistant usage, nested tool-result usage, and summary usage when present. It deduplicates copied/forked entries by response or entry identity. Usage without model metadata is reported under an explicit `unknown` model rather than silently discarded.
