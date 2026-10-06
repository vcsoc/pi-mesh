# Token audit / native gateway baseline — INSTALLED

Installed 2026-10-05. Existing native Pi sessions need `/reload`. Runtime version remains 2.7.3 plus scoped patches, NOT a wholesale canonical upgrade.

Exactly changed: runner.mjs, security/gateway/audit.mjs, security/gateway/client.mjs, security/gateway/native.mjs, simple-team.ts, work-review.mjs, work-tui.ts, work.ts, workflow.mjs. Full verified backup: `/Users/chris/.pi/disabled-extensions/agent-mesh-before-token-audit-gateway-20261005-200440`. Every other installed file was preserved. Do not apply the patch twice; it targets this exact backed-up installed baseline. New client/audit/native modules are independently vendored under security/gateway.

Default `maxTokens:null` means metadata audit only, no token hard stop. Optional user ceilings remain enforced and approval-bound; old numeric grants/history are never rewritten or replayed. New Mesh ceilings are hard accounting stops even with automatic continuation; legacy already-approved automatic checkpoint behavior remains intact. New automatic continuation requires proxy routing for internal SDK audit coverage.

Global primary extension: `~/.pi/agent/extensions/ai-gateway`. It defaults to metadata audit. `/ai-gateway setup`, `start`, `connect`, `status` manage explicit local SDK proxy activation; no production proxy was automatically started by installation. Required OS no-bypass confinement is BLOCKED, host sessions remain unconfined, disabled-extension/ad-hoc SDK processes are not automatically managed. This is a technical baseline, not full security/compliance completion.

Guild backend was restarted only after exact identity/quiescence checks, a frozen durable-state recheck and private state backup; no active run was terminated or replayed. Health nullable-token/audit capabilities are active and failed historical review bytes are unchanged. No paid provider inference, commits or pushes.

Evidence: 69 canonical Mesh + 69 canonical Guild + 17 gateway tests pass; 4 installed compatibility cases, actual installed primary RPC, real installed Mesh/Guild SDK fake-gateway transport, native TUI/RPC checks. No live-provider or Arena acceptance claimed. All synthetic inference uses isolated fake local endpoints.

Detailed architecture, privacy, retention and gaps: canonical `security/ai-gateway/README.md`, `vault/30-systems/ai-gateway.md`. Receipts `/tmp/token-audit-gateway-deployment.json`, `/tmp/guild-audit-activation.json`.

## Installed hashes

- `runner.mjs`: `991543777d0c421d7508a3488a3560735e51cabf8642aec7746696b09ef1c148`
- `security/gateway/audit.mjs`: `1dfb8981f5028a63d93fbca3fbda7e0f8db8570d80d953f350916d0663bf2007`
- `security/gateway/client.mjs`: `5651c2ea6a7391a495aed29bc0b83373499c33c9fee718dd8b4f95f227f5b529`
- `security/gateway/native.mjs`: `71b7e7792ba9ed147e45fc87f043f0502784c4f4991299c0bed24409605d21d8`
- `simple-team.ts`: `dbbc97c3c0d53185ab6969c9f6e9b20b001df93b1663ea05f51ccb9e934ef1f6`
- `work-review.mjs`: `6e827eeb7497f8a1e53ed3468dbc7b2381b46c4b2d75a931947a91fea6012d94`
- `work-tui.ts`: `5274cca3bedaf483c507bae64b628b96b5eabae1babc46eedfff8fd1184df7ce`
- `work.ts`: `810effcecf619d21be708669b2c77ddc6e54fb45e4d4d1365b8626a2a132729b`
- `workflow.mjs`: `aa8029dc550cd7e4132f0999b8526e1de27d80412af477e04e92ad852f58d1e8`
