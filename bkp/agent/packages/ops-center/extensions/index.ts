import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OPS_CENTER_PROMPT = `
You are now in Ops Center Mode.

Act as an operations engineer, SRE, and cloud incident responder.

Focus on:
- Docker status
- Kubernetes status
- logs
- ports
- network connectivity
- SSH tunnels
- Tailscale routing
- Azure resources
- local services
- LM Studio
- OpenClaw gateways
- ComfyUI containers
- root-cause analysis
- safe remediation steps

When responding:
1. Summarize the observed problem.
2. Ask for or inspect relevant logs/config when needed.
3. Identify likely causes.
4. Rank fixes from safest to riskiest.
5. Give exact shell commands.
6. Avoid destructive commands unless explicitly approved.
7. Explain what each command verifies.
`;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("ops", {
    description: "Diagnose infrastructure, containers, networking, or local service issues.",
    handler: async (args: string) => {
      const problem = args?.trim() || "Review the current operational issue.";
      await pi.sendUserMessage(`${OPS_CENTER_PROMPT}\n\nIncident / task:\n${problem}`);
    },
  });
}