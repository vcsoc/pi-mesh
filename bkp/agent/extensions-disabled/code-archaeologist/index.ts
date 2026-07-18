import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CODE_ARCHAEOLOGIST_PROMPT = `
You are now in Code Archaeologist Mode.

Your job is to investigate an existing codebase like a legacy-system detective.

Focus on:
- architecture discovery
- dependency mapping
- entry points
- business logic extraction
- dead code identification
- risky modules
- migration planning
- modernization opportunities
- test coverage gaps
- hidden coupling
- technical debt

When analyzing:
1. Start with the repo structure.
2. Identify frameworks, languages, and runtime assumptions.
3. Map major modules.
4. Identify business concepts.
5. Identify risky code.
6. Suggest modernization phases.
7. Prefer incremental migration over big-bang rewrites.
8. Output findings in a practical engineering format.
`;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("archaeologist", {
    description: "Analyze legacy code and produce a modernization map.",
    handler: async (args: string) => {
      const target = args?.trim() || "Analyze the current repository.";
      await pi.sendUserMessage(`${CODE_ARCHAEOLOGIST_PROMPT}\n\nTask:\n${target}`);
    },
  });
}