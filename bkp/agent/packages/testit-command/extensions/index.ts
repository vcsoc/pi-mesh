import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_REQUEST =
  "Bootstrap or maintain the .testit harness for this project, ensure GitNexus is available or initialized, detect git/code changes, expand or amend tests accordingly, run the right tests, and regenerate the scored TestIt report.";

const REPORT_REQUEST =
  "Inspect the current .testit harness, refresh the scored TestIt report if needed, and summarize the latest report including lowest-scoring important tests, failed tests, and major coverage gaps.";

const AUDIT_REQUEST =
  "Audit the current .testit harness against the latest repository and git/GitNexus changes, identify missing or stale coverage, update the harness if needed, run the audit flow, and regenerate the scored TestIt report.";

const DASHBOARD_REQUEST =
  "Inspect the current .testit dashboard, ensure it can run and display the latest tests and scores, repair or generate missing dashboard pieces if needed, and explain exactly how to launch and use it from this project.";

function queueSkill(pi: ExtensionAPI, ctx: any, request: string, label: string) {
  const message = `/skill:testit ${request}`;

  if (ctx.isIdle()) {
    pi.sendUserMessage(message);
  } else {
    pi.sendUserMessage(message, { deliverAs: "followUp" });
    ctx.ui.notify(`Queued ${label} as a follow-up`, "info");
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("testit", {
    description: "Run the TestIt skill against the current project.",
    handler: async (args, ctx) => {
      queueSkill(pi, ctx, args?.trim() || DEFAULT_REQUEST, "/testit");
    },
  });

  pi.registerCommand("testit-report", {
    description: "Refresh and summarize the current TestIt report.",
    handler: async (args, ctx) => {
      queueSkill(pi, ctx, args?.trim() || REPORT_REQUEST, "/testit-report");
    },
  });

  pi.registerCommand("testit-audit", {
    description: "Audit and refresh TestIt coverage against current code changes.",
    handler: async (args, ctx) => {
      queueSkill(pi, ctx, args?.trim() || AUDIT_REQUEST, "/testit-audit");
    },
  });

  pi.registerCommand("testit-dashboard", {
    description: "Validate or repair the TestIt dashboard and explain how to run it.",
    handler: async (args, ctx) => {
      queueSkill(pi, ctx, args?.trim() || DASHBOARD_REQUEST, "/testit-dashboard");
    },
  });
}
