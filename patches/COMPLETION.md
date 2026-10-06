# Request-completion interface — installed 2026-10-02

This narrowly scoped patch changes completion.mjs, index.ts, run-status.mjs, simple-team.ts, team-scope.mjs, work.ts only. Installed runtime remains 2.7.3; it is NOT a full canonical upgrade. All other installed files/state/history were preserved.

Full byte-verified backup: `/Users/chris/.pi/disabled-extensions/agent-mesh-before-completion-20261002-153006`. Do not apply `installed-completion.patch` twice or to canonical source; it targets this exact installed baseline. The patch carries installed-specific entry/controller changes; copy the accompanying changed helpers from qualified source when reproducing on that baseline. Verify every precondition before altering an installation.

New requests use current exact Pi provider/model settings, visible finite reported-token budgets, scoped verification, explicit execution approval, live status, terminal outcome/blockers and full-run-ID steering. Neither parent Pi queued input nor a starting receipt proves team completion. Credentials for generated apps are separate from Pi login credentials. No old budgets were expanded, Arena work replayed, paid inference performed, production service restarted, commit/push or unrelated management upgrade done.

Mesh build drafts now use 1,000,000 reported tokens; review drafts 200,000, both $5 estimated cost. Newly observed launches emit terminal reports while Pi is connected; history/footer survive separately. Tool run/resume retains explicit approval.

## Evidence

- Both canonical suites: **68/68 each**, serial execution. Concurrent full-suite attempts timed out and are not counted as passing.
- Actual Pi terminal checks passed against both staged installed-runtime candidates AND actual installed extensions, using isolated homes/dead fixture provider endpoints and cancellation; no execution spec/run created. Mesh also passed actual installed RPC refusal.
- Mesh terminal-report and targeted-control tests cover budget cancellation, partial evidence, terminal notification once and no history replay. Guild plan/composer tests cover exact model/thinking, checks, review-only scope and token choices.
- Guild actual editor/select Escape checks assert return to the main screen/no run files, not a reliably rendered cancellation notification on every path.
- No end-to-end live-provider completion or Arena application acceptance is claimed.

Logs: `/tmp/mesh-completion-serial-check.log`, `/tmp/guild-completion-serial-check.log`, `/tmp/mesh-completion-installed-pty.log`, `/tmp/mesh-completion-installed-rpc.log`, `/tmp/guild-request-installed-pty.log`.

## Installed SHA-256

- `completion.mjs`: `9add3a1ec2b81d53b61df00ac445ff03f9f6e0e2afae202e0dcec3a4b18673b2`
- `index.ts`: `2a715e96db094ab7fb87754ea6c0704ff695ebc44d2bf253e674753b575891bb`
- `run-status.mjs`: `cf348a4344f9af568de7f2330837ea7721965bebe151ea1b36f84494a8b1e08b`
- `simple-team.ts`: `05c12e5ea8981a541bee97d1c21484f0785c00bef106b63fd5c7cb0df60d1a71`
- `team-scope.mjs`: `b279b5a626b7a45cba2a3b6b2f87d62eec2bd66bcc40c7e98e883f36d157d8bc`
- `work.ts`: `909c444f374a9e1569ddedcd433a3a5c8569bf51523accaae90901f000d2d77d`
