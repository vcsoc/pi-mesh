# OpenShell technical baseline v1

Standalone, deny-by-default qualification policy. This file is NOT automatically
loaded by Mesh or Guild and does not establish enforcement in either extension.
An agent-writable project file must never authorize its own permission expansion.

```json openshell-policy-v1
{
  "schemaVersion": 1,
  "workspace": "read-only",
  "egress": []
}
```

The compiler fixes non-root UID/GID 1000, hard-required Landlock, no implicit
writable working directory, read-only system/image paths, and writable `/tmp`
and `/state`. All outbound network access is denied by this base policy.

Optional `egress` entries contain exactly `host`, `methods`, and `paths`.
They compile to HTTPS port 443, inspected REST, explicit `enforce`, and the
pinned image's `/usr/local/bin/node` executable. Methods and paths form a cross
product; keep rules narrow. These are HTTP restrictions, not proof of application
intent, data residency or regulatory compliance. DNS classification, provider-
added grants, gateway-global policy and actual loaded policy require independent
runtime verification. Node binary identity does not distinguish individual JS
programs or their authorized descendants.

A read-write workspace also requires an independent caller grant; merely editing
this document is insufficient. There is no audit-only, best-effort, host fallback,
raw credential, arbitrary filesystem path or policy-disable option in this format.
Filesystem/process changes require sandbox recreation, not a false live-update
success. Review the full effective policy and loaded revision, not just this file.
