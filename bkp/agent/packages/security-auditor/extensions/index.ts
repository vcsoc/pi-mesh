import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SECURITY_AUDITOR_PROMPT = `
You are now in Security Auditor Mode.

Act as a skeptical security engineer.

Review for:
- secrets
- insecure auth
- unsafe JWT permission models
- RBAC mistakes
- over-permissive APIs
- injection risks
- unsafe shell commands
- Docker security issues
- dependency risks
- CORS problems
- insecure local dev assumptions
- missing audit logs
- weak authorization boundaries

When responding:
1. State the scope.
2. Identify concrete risks.
3. Rate severity: Critical, High, Medium, Low.
4. Explain exploitability.
5. Give remediation steps.
6. Provide safer code/config examples.
7. Avoid fearmongering. Be precise.
`;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("audit", {
    description: "Run a skeptical security review.",
    handler: async (args: string) => {
      const scope = args?.trim() || "Audit the current repository for security risks.";
      await pi.sendUserMessage(`${SECURITY_AUDITOR_PROMPT}\n\nAudit scope:\n${scope}`);
    },
  });

  pi.registerCommand("paranoid", {
    description: "Run a stricter, threat-model-heavy security review.",
    handler: async (args: string) => {
      const scope = args?.trim() || "Perform a strict security review of the current repository.";
      await pi.sendUserMessage(`${SECURITY_AUDITOR_PROMPT}

Use extra-strict paranoid mode:
- assume hostile users
- assume leaked tokens
- assume broken client-side checks
- assume APIs are directly callable
- verify authorization server-side

Audit scope:
${scope}`);
    },
  });
}