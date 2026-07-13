import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type WorkMode = "direct" | "auto" | "team";

type WorkPolicy = {
  mode: WorkMode;
  durationLabel: string;
  durationMs?: number;
  task: string;
  agentInfrastructure: boolean;
};

const extensionRoot = dirname(fileURLToPath(import.meta.url));
const templatesRoot = join(extensionRoot, "templates");

const HELP = `# /work — execution controller

Choose whether the current Pi assistant works directly or coordinates project sub-agents, with an optional strict time budget.

## Commands

/work help
  Show this help at any time.

/work scaffold [path] [--force]
  Create the project-agnostic agents/ structure and launcher scripts in the current project, or in the optional path.
  Existing agent infrastructure is never overwritten unless --force is supplied.

/work direct [duration] <request>
  The current assistant completes the request itself. Sub-agents are prohibited.

/work auto [duration] <request>
  The current assistant decides whether existing project sub-agents materially improve the result.

/work team [duration] <request>
  Use the project's existing agents and launchers. The extension never scaffolds agents implicitly.

## Durations

Use 30s, 2m, 1h, or unlimited. If omitted, duration defaults to unlimited.
A deadline limits execution time; it cannot guarantee that the requested work will be completed in that time.

## Examples

/work direct 30s Fix this typo and run the smallest relevant check
/work direct unlimited Refactor this module and verify it
/work auto 5m Diagnose and fix the failing integration test
/work team 15m Implement and independently test this feature
/work team unlimited Complete the full delivery workflow
/work scaffold
/work scaffold C:\\projects\\new-app
/work scaffold --force

## Numeric shortcuts

/1 <request>  = direct, 30 seconds
/2 <request>  = direct, 2 minutes
/3 <request>  = auto, 10 minutes
/4 <request>  = team, unlimited

## Defaults and safety

- Ordinary prompts that do not use /work follow the active project's instructions.
- /work without an explicit mode defaults to direct and unlimited.
- Existing agents are always used as-is; use scaffold only when a project has no agent structure.
- scaffold refuses partial or destructive overwrites unless --force is explicit.
- direct mode does not bypass security constraints or explicit production/PR delivery gates.
- When a deadline expires, Pi aborts active work and must report completed work, evidence, and unfinished items honestly.`;

const durationPattern = /^(unlimited|\d+(?:\.\d+)?(?:s|m|h))$/i;

const parseDuration = (value: string | undefined): { label: string; ms?: number; consumed: boolean } => {
  if (!value || !durationPattern.test(value)) return { label: "unlimited", consumed: false };
  if (value.toLowerCase() === "unlimited") return { label: "unlimited", consumed: true };
  const amount = Number.parseFloat(value);
  const unit = value.slice(-1).toLowerCase();
  const multiplier = unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : 1_000;
  return { label: value.toLowerCase(), ms: Math.max(1_000, Math.round(amount * multiplier)), consumed: true };
};

const parseWork = (raw: string, fallback?: Omit<WorkPolicy, "task" | "agentInfrastructure">): Omit<WorkPolicy, "agentInfrastructure"> => {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  let mode: WorkMode = fallback?.mode ?? "direct";
  if (["direct", "auto", "team"].includes(tokens[0]?.toLowerCase())) mode = tokens.shift()!.toLowerCase() as WorkMode;
  const duration = fallback
    ? { label: fallback.durationLabel, ms: fallback.durationMs, consumed: false }
    : parseDuration(tokens[0]);
  if (duration.consumed) tokens.shift();
  return { mode, durationLabel: duration.label, durationMs: duration.ms, task: tokens.join(" ").trim() };
};

const hasAgentInfrastructure = (cwd: string): boolean =>
  existsSync(join(cwd, "agents")) || existsSync(join(cwd, "scripts", "run-agent.mjs"));

const policyInstructions = (policy: WorkPolicy): string => {
  const deadline = policy.durationMs
    ? `You have a strict execution budget of ${policy.durationLabel}. Prioritize the smallest complete result, stop starting new work near the deadline, run the fastest relevant verification, and report unfinished work honestly if interrupted.`
    : "There is no execution deadline. Continue until the request is verified or a proven hard blocker remains.";
  const routing = policy.mode === "direct"
    ? "Complete the request yourself. Do not launch, simulate, or delegate to sub-agents."
    : policy.mode === "team"
      ? policy.agentInfrastructure
        ? "Coordinate the existing project agents and launcher scripts. Use their real outputs and required gates; do not replace or scaffold them."
        : "Team mode was requested, but this project has no agent infrastructure. Do not scaffold implicitly. Explain that /work scaffold is required, then continue directly only if the task can safely proceed without violating project rules."
      : policy.agentInfrastructure
        ? "Choose direct execution unless existing project agents materially improve correctness or satisfy a mandatory gate. If used, invoke the existing agents as-is."
        : "No project agent infrastructure exists, so complete the request directly; do not scaffold implicitly.";
  return `WORK EXECUTION CONTRACT\nMode: ${policy.mode}\nBudget: ${policy.durationLabel}\n${routing}\n${deadline}\nThis execution contract controls delegation for this request but never weakens security constraints or explicit production/PR delivery gates.`;
};

const showHelp = (pi: ExtensionAPI) => {
  pi.sendMessage({ customType: "work-controller-help", content: HELP, display: true }, { triggerTurn: false });
};

const scaffold = async (args: string, ctx: ExtensionCommandContext) => {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const force = tokens.includes("--force");
  const unknownFlags = tokens.filter((token) => token.startsWith("--") && token !== "--force");
  if (unknownFlags.length) {
    ctx.ui.notify(`Unknown scaffold option: ${unknownFlags.join(", ")}`, "error");
    return;
  }
  const pathTokens = tokens.filter((token) => token !== "--force");
  if (pathTokens.length > 1) {
    ctx.ui.notify("Usage: /work scaffold [path] [--force]", "error");
    return;
  }
  const targetRoot = resolve(ctx.cwd, pathTokens[0] ?? ".");
  const destinations = [join(targetRoot, "agents"), join(targetRoot, "scripts", "run-agent.mjs"), join(targetRoot, "scripts", "run-workflow.mjs")];
  const collisions = destinations.filter(existsSync);
  if (collisions.length && !force) {
    ctx.ui.notify(`Scaffold refused: existing agent infrastructure found. Use --force to replace it.\n${collisions.join("\n")}`, "error");
    return;
  }
  if (force) {
    await rm(join(targetRoot, "agents"), { recursive: true, force: true });
    await rm(join(targetRoot, "scripts", "run-agent.mjs"), { force: true });
    await rm(join(targetRoot, "scripts", "run-workflow.mjs"), { force: true });
  }
  await mkdir(join(targetRoot, "scripts"), { recursive: true });
  await cp(join(templatesRoot, "agents"), join(targetRoot, "agents"), { recursive: true });
  await cp(join(templatesRoot, "scripts", "run-agent.mjs"), join(targetRoot, "scripts", "run-agent.mjs"));
  await cp(join(templatesRoot, "scripts", "run-workflow.mjs"), join(targetRoot, "scripts", "run-workflow.mjs"));
  ctx.ui.notify(`Agent scaffold created in ${targetRoot}`, "info");
};

export default function workController(pi: ExtensionAPI) {
  let pendingPolicy: WorkPolicy | undefined;
  let activePolicy: WorkPolicy | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

  const clearDeadline = () => {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    deadlineTimer = undefined;
  };

  const startWork = async (raw: string, ctx: ExtensionCommandContext, fallback?: Omit<WorkPolicy, "task" | "agentInfrastructure">) => {
    const parsed = parseWork(raw, fallback);
    if (!parsed.task) {
      ctx.ui.notify("Usage: /work <direct|auto|team> [30s|2m|1h|unlimited] <request>. Use /work help for examples.", "error");
      return;
    }
    await ctx.waitForIdle();
    pendingPolicy = { ...parsed, agentInfrastructure: hasAgentInfrastructure(ctx.cwd) };
    ctx.ui.setStatus("work-controller", `${pendingPolicy.mode} · ${pendingPolicy.durationLabel}`);
    pi.sendUserMessage(parsed.task);
  };

  pi.registerCommand("work", {
    description: "Control direct/team execution and time budgets; use /work help",
    getArgumentCompletions: (prefix) => {
      const values = ["help", "scaffold", "direct", "auto", "team"];
      const matches = values.filter((value) => value.startsWith(prefix.trim().toLowerCase()));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      const [command, ...rest] = trimmed.split(/\s+/);
      if (!trimmed || command.toLowerCase() === "help") {
        showHelp(pi);
        return;
      }
      if (command.toLowerCase() === "scaffold") {
        await scaffold(rest.join(" "), ctx);
        return;
      }
      await startWork(trimmed, ctx);
    },
  });

  const shortcuts: Array<[string, WorkMode, string, number | undefined]> = [
    ["1", "direct", "30s", 30_000],
    ["2", "direct", "2m", 120_000],
    ["3", "auto", "10m", 600_000],
    ["4", "team", "unlimited", undefined],
  ];
  for (const [name, mode, durationLabel, durationMs] of shortcuts) {
    pi.registerCommand(name, {
      description: `Work level ${name}: ${mode}, ${durationLabel}`,
      handler: (args, ctx) => startWork(args, ctx, { mode, durationLabel, durationMs }),
    });
  }

  pi.on("before_agent_start", (event) => {
    if (!pendingPolicy) return;
    activePolicy = pendingPolicy;
    pendingPolicy = undefined;
    return { systemPrompt: `${event.systemPrompt}\n\n${policyInstructions(activePolicy)}` };
  });

  pi.on("agent_start", (_event, ctx) => {
    clearDeadline();
    if (!activePolicy?.durationMs) return;
    deadlineTimer = setTimeout(() => {
      ctx.ui.notify(`/work ${activePolicy?.durationLabel} deadline reached; aborting active work.`, "warning");
      ctx.abort();
    }, activePolicy.durationMs);
  });

  pi.on("agent_settled", (_event, ctx) => {
    clearDeadline();
    activePolicy = undefined;
    ctx.ui.setStatus("work-controller", undefined);
  });

  pi.on("session_shutdown", () => clearDeadline());
}
