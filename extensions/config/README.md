# Pi Config

Read-only `/config` extension that compares project `extensions/` and `skills/` with the global Pi harness (`~/.pi/agent`).

```text
/config
/config extensions
/config skills
/config all --md
/config --html
```

Reports are written to `.pi-reports/config/`. The scanner compares deterministic SHA-256 fingerprints and applies the curated recommendations used by this repository. It never imports or executes candidate resources.
