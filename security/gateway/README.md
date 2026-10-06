# Mesh native gateway/audit adapters

These independently vendored modules support Mesh usage auditing and an optional local native-Pi SDK gateway:

- `audit.mjs`: private metadata-only usage/event audit and explicit accounting gaps. No prompt, response, tool payload or hidden-thinking logging by this adapter.
- `client.mjs`: explicit gateway configuration, authenticated server proof, scoped grants and streaming proxy transport. Required routing never silently falls back to direct providers.
- `native.mjs`: native Pi SDK/provider loading.

Mesh requests default to `maxTokens: null` (audit-only). Positive user-selected ceilings remain approval-bound; old grants are unchanged. Cost reports are provider estimates and returned usage can overshoot a ceiling.

The optional `/ai-gateway` companion manages setup/start/connect and primary-session audit. It is **not installed, started or enabled by copying Mesh**. New automatic continuation requires explicitly configured routing for internal SDK audit coverage; ordinary bounded workflows can use metadata audit without routing. Existing legacy automatic grants retain their original accounting behavior.

## Boundaries

Host SDK sessions and shell-capable tools remain **unconfined**. Whole-process network/credential isolation and required no-bypass enforcement are not qualified. Image/classifier transports deliberately fail closed where unsupported. A proxy, audit log or security-policy draft is not a sandbox or compliance certification.

Qualification uses isolated fake transports and SDK construction. No live-provider completion, paid billing guarantees or production security acceptance are implied. Keep the gateway home, tokens, usage logs and retained SDK sessions private.
