import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("batch", {
    description: "Run the batch skill for large multi-target changes.",
    handler: async (args, ctx) => {
      const request = args?.trim();
      if (!request) {
        ctx.ui.notify("Usage: /batch <targets> <change instruction>", "warning");
        return;
      }

      const message = `/skill:batch ${request}`;
      if (ctx.isIdle()) {
        pi.sendUserMessage(message);
      } else {
        pi.sendUserMessage(message, { deliverAs: "followUp" });
        ctx.ui.notify("Queued /batch as a follow-up", "info");
      }
    },
  });
}
