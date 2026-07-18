import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type GoalState = {
  active: boolean;
  request: string;
  task: string;
  tokenBudget?: string;
  startedAt: number;
  updatedAt: number;
};

type GoalSnapshot = {
  goal: GoalState | null;
};

const GOAL_STATE_TYPE = "goal-state";
const STATUS_ID = "goal";
const WIDGET_ID = "goal";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_PATH = resolve(__dirname, "../../skills/goal/SKILL.md");

let cachedSkillBody: string | undefined;

function stripFrontmatter(markdown: string) {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

async function loadSkillBody() {
  if (cachedSkillBody) return cachedSkillBody;
  const raw = await readFile(SKILL_PATH, "utf8");
  cachedSkillBody = stripFrontmatter(raw);
  return cachedSkillBody;
}

function parseGoalRequest(input: string) {
  const trimmed = input.trim();
  const tokenMatch = trimmed.match(/(?:^|\s)--tokens\s+([^\s]+)/i);
  const tokenBudget = tokenMatch?.[1]?.trim();
  const task = trimmed.replace(/(?:^|\s)--tokens\s+([^\s]+)/gi, " ").trim();
  return { task, tokenBudget };
}

function preview(text: string, max = 88) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1).trimEnd()}…` : compact;
}

function formatGoal(goal: GoalState | null) {
  if (!goal?.active) {
    return [
      "Goal mode is inactive.",
      "",
      "Usage:",
      "/goal <task plus success contract>",
      "/goal status",
      "/goal clear",
      "",
      "Raw skill remains available via /skill:goal.",
    ].join("\n");
  }

  return [
    "Goal mode is active.",
    "",
    `Task: ${goal.task}`,
    goal.tokenBudget ? `Token budget: ${goal.tokenBudget}` : undefined,
    `Started: ${new Date(goal.startedAt).toLocaleString()}`,
    `Updated: ${new Date(goal.updatedAt).toLocaleString()}`,
    "",
    "This extension keeps the /skill:goal contract persistently injected until you run /goal clear.",
    "Raw skill remains available via /skill:goal.",
  ]
    .filter(Boolean)
    .join("\n");
}

function persistGoal(pi: ExtensionAPI, goal: GoalState | null) {
  const snapshot: GoalSnapshot = { goal };
  pi.appendEntry(GOAL_STATE_TYPE, snapshot);
}

function restoreGoal(entries: Array<{ type: string; customType?: string; data?: GoalSnapshot }>) {
  const saved = entries
    .filter((entry) => entry.type === "custom" && entry.customType === GOAL_STATE_TYPE)
    .pop();
  return saved?.data?.goal ?? null;
}

function updateGoalUi(ctx: any, goal: GoalState | null) {
  if (!ctx.hasUI) return;

  if (!goal?.active) {
    ctx.ui.setStatus(STATUS_ID, undefined);
    ctx.ui.setWidget(WIDGET_ID, undefined);
    return;
  }

  ctx.ui.setStatus(STATUS_ID, "active");
  ctx.ui.setWidget(
    WIDGET_ID,
    [
      `goal: ${preview(goal.task, 96)}`,
      goal.tokenBudget ? `tokens: ${goal.tokenBudget}` : "proof required before completion",
    ],
    { placement: "belowEditor" },
  );
}

function buildGoalPrompt(skillBody: string, goal: GoalState) {
  return [
    "An active /goal session contract is in force.",
    "Treat it as persistent across turns until it is verified, blocked, or the user runs /goal clear.",
    "",
    `Active goal request: ${goal.task}`,
    goal.tokenBudget ? `Token budget: ${goal.tokenBudget}` : undefined,
    `Goal started at: ${new Date(goal.startedAt).toISOString()}`,
    "",
    "Follow this goal workflow on every turn:",
    skillBody,
    "",
    "Extension addendum:",
    "- The goal contract remains active even if later user prompts are short follow-ups.",
    "- Before ending a turn, explicitly identify what part of the contract is still unverified.",
    "- If you believe the goal is complete, show concrete proof in the response.",
    "- If the contract is not yet verified, continue working or explain the exact blocker.",
  ]
    .filter(Boolean)
    .join("\n");
}

export default function goalExtension(pi: ExtensionAPI) {
  const state: { goal: GoalState | null } = { goal: null };

  pi.on("session_start", async (_event, ctx) => {
    state.goal = restoreGoal(ctx.sessionManager.getEntries() as Array<{ type: string; customType?: string; data?: GoalSnapshot }>);
    updateGoalUi(ctx, state.goal);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_ID, undefined);
    ctx.ui.setWidget(WIDGET_ID, undefined);
  });

  pi.on("before_agent_start", async (event) => {
    if (!state.goal?.active) return;

    const skillBody = await loadSkillBody();
    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildGoalPrompt(skillBody, state.goal)}`,
    };
  });

  pi.registerCommand("goal", {
    description: "Persistent goal mode built on top of /skill:goal. Use /goal <contract>, /goal status, or /goal clear.",
    handler: async (args, ctx) => {
      const raw = args.trim();
      const lowered = raw.toLowerCase();

      if (!raw || lowered === "status") {
        if (ctx.hasUI) ctx.ui.setEditorText(formatGoal(state.goal));
        ctx.ui.notify(state.goal?.active ? "Loaded active goal details into the editor." : "Goal mode is inactive.", "info");
        return;
      }

      if (["clear", "stop", "done", "cancel"].includes(lowered)) {
        state.goal = null;
        persistGoal(pi, state.goal);
        updateGoalUi(ctx, state.goal);
        ctx.ui.notify("Cleared active goal mode. Raw skill is still available via /skill:goal.", "info");
        return;
      }

      const parsed = parseGoalRequest(raw);
      if (!parsed.task) {
        ctx.ui.notify("Usage: /goal <task plus verifiable success contract>", "warning");
        return;
      }

      const now = Date.now();
      state.goal = {
        active: true,
        request: raw,
        task: parsed.task,
        tokenBudget: parsed.tokenBudget,
        startedAt: state.goal?.active ? state.goal.startedAt : now,
        updatedAt: now,
      };

      persistGoal(pi, state.goal);
      updateGoalUi(ctx, state.goal);

      const kickoff = [
        "Goal mode activated.",
        `Task: ${parsed.task}`,
        parsed.tokenBudget ? `Token budget: ${parsed.tokenBudget}` : undefined,
        "Work until the contract is verified with proof, blocked with evidence, or the user changes the goal.",
      ]
        .filter(Boolean)
        .join("\n");

      ctx.ui.notify("Activated persistent /goal mode. Raw skill remains available via /skill:goal.", "info");
      pi.sendUserMessage(kickoff);
    },
  });
}
