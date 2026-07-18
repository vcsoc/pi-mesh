#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const registry = JSON.parse(readFileSync(resolve(projectRoot, "agents", "agent-registry.json"), "utf8"));

const argv = process.argv.slice(2);
const filtered = argv.filter((arg) => arg !== "--print");
const task = filtered.join(" ").trim();

if (!task) {
  console.error("Usage: node scripts/run-workflow.mjs [--print] <task description>");
  process.exit(1);
}

const workflowPrompt = (agent, index, handoffs) => `Project workflow step ${index + 1}/${registry.workflow.length}: ${agent}.\n\nOrchestrator task packet:\n${task}\n\nPrior specialist handoff evidence:\n${handoffs || "No prior handoff; this is the first workflow stage."}\n\nDiscover the active project from its root instructions and current repository. Produce only this role's required deliverables. Use the prior evidence as input, use safe project-agnostic defaults for optional missing context, and stop only when a hard blocker prevents meaningful work.`;

let handoffs = "";
for (let i = 0; i < registry.workflow.length; i += 1) {
  const agent = registry.workflow[i];
  const args = [resolve(projectRoot, "scripts", "run-agent.mjs"), agent, "--print", "--no-session", workflowPrompt(agent, i, handoffs)];
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false
  });

  if (result.stderr) process.stderr.write(result.stderr);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.error) {
    console.error(`[agent-workflow] Failed to start ${agent}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[agent-workflow] Stopped at ${agent} with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }

  const output = String(result.stdout ?? "").trim();
  if (!output) {
    console.error(`[agent-workflow] Stopped at ${agent}: no handoff output was produced`);
    process.exit(1);
  }
  handoffs += `\n\n--- ${agent} (step ${i + 1}) ---\n${output}`;
}
