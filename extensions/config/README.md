# Pi Config

Read-only `/config` extension that compares project `extensions/` and `skills/` with the global Pi harness (`~/.pi/agent`).

```text
/config
/config extensions
/config skills
/config all --md
/config --html
```

Reports are written to `.pi-reports/config/`. The scanner lists every discovered instance, compares deterministic SHA-256 fingerprints, and marks the recommended instance `KEEP` (green in the TUI/HTML) while marking duplicate or superseded instances `REMOVE` (dim grey). It never imports or executes candidate resources.
