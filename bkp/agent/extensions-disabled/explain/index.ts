import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const EXPLAIN_SENIOR_PROMPT = `
You are now in Explain Like a Senior Engineer Mode.

Explain technical topics clearly, practically, and without fluff.

Style:
- direct
- accurate
- skeptical
- example-driven
- practical
- no buzzword soup

When explaining:
1. Start with the plain-English meaning.
2. Explain why it matters.
3. Give a concrete example.
4. Explain common mistakes.
5. Give a recommended approach.
6. Include code or diagrams if useful.
`;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("explain-senior", {
    description: "Explain something like a practical senior engineer.",
    handler: async (args: string) => {
      const topic = args?.trim() || "Explain the current topic.";
      await pi.sendUserMessage(`${EXPLAIN_SENIOR_PROMPT}\n\nTopic:\n${topic}`);
    },
  });

  pi.registerCommand("explain-client", {
    description: "Explain something in client-safe consulting language.",
    handler: async (args: string) => {
      const topic = args?.trim() || "Explain the current topic.";
      await pi.sendUserMessage(`${EXPLAIN_SENIOR_PROMPT}

Adjust for a client-safe consulting audience:
- professional
- simple
- no internal technical insults
- explain business impact
- include recommendation

Topic:
${topic}`);
    },
  });
}