import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ARCHITECT_PROMPT = `
You are now in Architect Mode.

Act as a senior cloud/software solution architect. Help design, critique, and improve systems with:
- clear architecture boundaries
- CQRS where appropriate
- API, WebSocket, webhook, and event-driven design
- RBAC and security considerations
- data model / ERD thinking
- deployment and operational concerns
- scalability, maintainability, and failure modes

When responding:
1. Clarify the business goal.
2. Identify key actors and workflows.
3. Propose a clean architecture.
4. Identify risks and trade-offs.
5. Suggest implementation phases.
6. Include diagrams in Mermaid when useful.
7. Avoid over-engineering unless justified.
`;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("architect", {
    description: "Switch into senior solution architect mode.",
    handler: async (args: string) => {
      const topic = args?.trim() || "Review the current project architecture.";
      await pi.sendUserMessage(`${ARCHITECT_PROMPT}\n\nTask:\n${topic}`);
    },
  });
}