import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_REQUEST =
  "Create or refine a draw.io diagram for this project or topic. Generate editable .drawio output, export requested assets when draw.io CLI is available, and use the bundled references/scripts when shape lookup, autolayout, or browser fallback is needed.";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("drawio", {
    description: "Run the drawio skill for diagrams and draw.io exports.",
    handler: async (args, ctx) => {
      const request = args?.trim() || DEFAULT_REQUEST;
      const message = `/skill:drawio ${request}`;

      if (ctx.isIdle()) {
        pi.sendUserMessage(message);
      } else {
        pi.sendUserMessage(message, { deliverAs: "followUp" });
        ctx.ui.notify("Queued /drawio as a follow-up", "info");
      }
    },
  });
}
