#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const agentsRoot = resolve(projectRoot, "agents");

function usage() {
  console.error(`Usage:
  node scripts/run-agent.mjs <agent-id> [--print] [--no-session] [--continue] [prompt...]

Examples:
  node scripts/run-agent.mjs senior-architect "Plan identity MVP"
  node scripts/run-agent.mjs senior-code-reviewer --print "Review unstaged changes"

Provider/model policy:
  If provider/model is null in agent.config.json, this launcher omits the flag so Pi uses the current/default provider/model.`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const argv = process.argv.slice(2);
const agentId = argv.shift();
if (!agentId || agentId === "-h" || agentId === "--help") {
  usage();
  process.exit(agentId ? 0 : 1);
}

let printMode = false;
let noSession = false;
let continueSession = false;
const promptParts = [];
for (const arg of argv) {
  if (arg === "--print" || arg === "-p") printMode = true;
  else if (arg === "--no-session") noSession = true;
  else if (arg === "--continue" || arg === "-c") continueSession = true;
  else promptParts.push(arg);
}

const defaultsPath = resolve(agentsRoot, "defaults.json");
const configPath = resolve(agentsRoot, agentId, "agent.config.json");
const promptPath = resolve(agentsRoot, agentId, "AGENTS.md");

if (!existsSync(configPath) || !existsSync(promptPath)) {
  console.error(`Unknown or incomplete agent '${agentId}'. Expected:`);
  console.error(`  ${configPath}`);
  console.error(`  ${promptPath}`);
  process.exit(1);
}

const defaults = existsSync(defaultsPath) ? readJson(defaultsPath) : {};
const config = { ...defaults, ...readJson(configPath) };
const rolePrompt = readFileSync(promptPath, "utf8");
const suppliedPrompt = promptParts.join(" ").trim();
const defaultPrompts = {
  "senior-test-engineer": "Run a generic, independent test and scoring pass for the current repository changes. Infer scope from git status and git diff, use AGENTS.md plus relevant available specifications as acceptance context, run the broadest safe relevant automated checks, inspect edge cases and regression risk, and return the required evidence, scores, defects, and recommendation. Do not ask which developer discipline applies and do not ask for missing parameters; default to a full-stack change review.",
  "senior-code-reviewer": "Review and score the current repository changes using AGENTS.md, relevant available specifications, git status, git diff, and available test evidence. Do not ask for missing parameters; default to a full-stack pre-merge review."
};
const userPrompt = suppliedPrompt || defaultPrompts[agentId] || `Complete the ${config.displayName ?? agentId} responsibilities for the current repository changes. Infer missing scope from AGENTS.md, git status, git diff, and relevant available specifications; do not ask for parameters that can be safely defaulted.`;

const args = [];

// Omit provider/model when null/empty so Pi inherits the current/default model selection.
if (config.provider) args.push("--provider", config.provider);
if (config.model) args.push("--model", config.model);
if (config.thinking) args.push("--thinking", config.thinking);
if (Array.isArray(config.tools) && config.tools.length > 0) args.push("--tools", config.tools.join(","));
if (config.sessionDir && !noSession) args.push("--session-dir", resolve(projectRoot, config.sessionDir));
if (noSession) args.push("--no-session");
if (continueSession) args.push("--continue");

args.push("--name", `agent:${agentId}`);
args.push("--append-system-prompt", rolePrompt);

if (printMode) {
  args.push("--print");
  if (userPrompt) args.push(userPrompt);
} else if (userPrompt) {
  args.push(userPrompt);
}

console.error(`[agent-runner] Starting ${config.displayName ?? agentId}`);
console.error(`[agent-runner] Provider: ${config.provider ?? "<inherit current/default>"}`);
console.error(`[agent-runner] Model: ${config.model ?? "<inherit current/default>"}`);

const globalPiCli = process.env.APPDATA
  ? resolve(process.env.APPDATA, "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js")
  : undefined;
const useDirectNodeCli = process.platform === "win32" && globalPiCli && existsSync(globalPiCli);
const command = useDirectNodeCli ? process.execPath : "pi";
const commandArgs = useDirectNodeCli ? [globalPiCli, ...args] : args;

const child = spawn(command, commandArgs, {
  cwd: projectRoot,
  stdio: "inherit",
  shell: false
});

child.on("error", (error) => {
  console.error(`[agent-runner] Failed to start Pi: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[agent-runner] Exited via signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
