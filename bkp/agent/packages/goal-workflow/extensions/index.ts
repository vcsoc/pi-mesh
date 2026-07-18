import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("goal", {
    description: "Run the goal skill with an autonomous completion contract.",
    handler: async (args, ctx) => {
      const request = args?.trim();
      if (!request) {
        ctx.ui.notify("Usage: /goal <completion contract>", "warning");
        return;
      }

      const message = `/skill:goal ${request}`;
      if (ctx.isIdle()) {
        pi.sendUserMessage(message);
      } else {
        pi.sendUserMessage(message, { deliverAs: "followUp" });
        ctx.ui.notify("Queued /goal as a follow-up", "info");
      }
    },
  });
}
