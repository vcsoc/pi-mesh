import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
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

/work inspect [--report]
  Inspect project agents, skills, extensions, and tools, then assess configuration efficiency.
  --report also writes a standalone work-inspect-report.html with light/dark themes.

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

### Inspect project configuration

/work inspect
  Review the current project's agents, sub-agents, skills, extensions, active tools, efficiency score, and recommended improvements.

/work inspect --report
  Run the same inspection and write a standalone work-inspect-report.html with embedded CSS/JavaScript and a light/dark theme toggle.

### Scaffold agent infrastructure

/work scaffold
  Add the default agents/ structure and launcher scripts to the current project.

/work scaffold C:\\projects\\new-app
  Scaffold a specific project directory.

/work scaffold --force
  Replace existing agent infrastructure in the current project. This is destructive and must be explicit.

### Control execution

/work direct 30s Fix this typo and run the smallest relevant check
/work direct unlimited Refactor this module and verify it
/work auto 5m Diagnose and fix the failing integration test
/work team 15m Implement and independently test this feature
/work team unlimited Complete the full delivery workflow

## Work shortcuts

/w1 <request>  = direct, 30 seconds
/w2 <request>  = direct, 2 minutes
/w3 <request>  = auto, 10 minutes
/w4 <request>  = team, unlimited

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

type InspectItem = { name: string; path: string; details?: string };
type InspectResult = {
  generatedAt: string;
  project: string;
  score: number;
  verdict: string;
  agents: InspectItem[];
  skills: InspectItem[];
  extensions: InspectItem[];
  tools: InspectItem[];
  findings: Array<{ level: "critical" | "warning" | "good"; text: string }>;
};

const listDirectories = async (root: string): Promise<string[]> => {
  if (!existsSync(root)) return [];
  return (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
};

const readJson = async (path: string): Promise<Record<string, unknown> | undefined> => {
  try { return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>; } catch { return undefined; }
};

const inspectProject = async (pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<InspectResult> => {
  const agentsRoot = join(ctx.cwd, "agents");
  const agentNames = await listDirectories(agentsRoot);
  const agents: InspectItem[] = [];
  for (const name of agentNames) {
    const root = join(agentsRoot, name);
    const config = await readJson(join(root, "agent.config.json"));
    const details = config
      ? `provider=${String(config.provider ?? "inherit")}, model=${String(config.model ?? "inherit")}, tools=${Array.isArray(config.tools) ? config.tools.join(", ") : "inherit"}`
      : "missing agent.config.json";
    agents.push({ name, path: relative(ctx.cwd, root), details });
  }

  const loadedSkills = ((ctx.getSystemPromptOptions().skills ?? []) as Array<Record<string, unknown>>).map((skill) => ({
    name: String(skill.name ?? "unnamed"),
    path: String(skill.path ?? skill.source ?? "loaded resource"),
    details: typeof skill.description === "string" ? skill.description : undefined,
  }));
  const projectSkillRoots = [join(ctx.cwd, ".pi", "skills"), join(ctx.cwd, ".agents", "skills")];
  const discoveredSkills: InspectItem[] = [];
  for (const root of projectSkillRoots) {
    for (const name of await listDirectories(root)) discoveredSkills.push({ name, path: relative(ctx.cwd, join(root, name)), details: "project-local" });
  }
  const skills = [...loadedSkills, ...discoveredSkills].filter((item, index, all) => all.findIndex((other) => other.name === item.name && other.path === item.path) === index);

  const extensionRoots = [join(ctx.cwd, ".pi", "extensions"), join(homedir(), ".pi", "agent", "extensions")];
  const extensions: InspectItem[] = [];
  for (const root of extensionRoots) {
    if (!existsSync(root)) continue;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() && !/\.[cm]?[jt]s$/.test(entry.name)) continue;
      extensions.push({ name: entry.name.replace(/\.[^.]+$/, ""), path: join(root, entry.name), details: root.startsWith(ctx.cwd) ? "project-local" : "global" });
    }
  }

  const tools: InspectItem[] = pi.getAllTools().map((tool) => ({
    name: tool.name,
    path: String(tool.sourceInfo?.path ?? tool.sourceInfo?.source ?? "unknown"),
    details: pi.getActiveTools().includes(tool.name) ? "active" : "inactive",
  }));
  const findings: InspectResult["findings"] = [];
  const hasLauncher = existsSync(join(ctx.cwd, "scripts", "run-agent.mjs"));
  const hasRegistry = existsSync(join(agentsRoot, "agent-registry.json"));
  const configuredAgents = agents.filter((agent) => !agent.details?.startsWith("missing")).length;
  if (!agentNames.length) findings.push({ level: "warning", text: "No project sub-agent infrastructure is configured; auto/team modes cannot delegate." });
  else {
    if (!hasLauncher) findings.push({ level: "critical", text: "Agents exist but scripts/run-agent.mjs is missing, so sub-agents cannot be launched consistently." });
    if (!hasRegistry) findings.push({ level: "warning", text: "agents/agent-registry.json is missing; orchestration order and role selection are not explicit." });
    if (configuredAgents !== agents.length) findings.push({ level: "warning", text: `${agents.length - configuredAgents} agent(s) lack a readable agent.config.json.` });
    if (hasLauncher && hasRegistry && configuredAgents === agents.length) findings.push({ level: "good", text: "Agent infrastructure has a launcher, registry, and readable role configs." });
  }
  const activeTools = tools.filter((tool) => tool.details === "active").length;
  if (activeTools > 20) findings.push({ level: "warning", text: `${activeTools} tools are active. Reduce the default tool surface to improve selection accuracy and prompt efficiency.` });
  else findings.push({ level: "good", text: `${activeTools} active tools is a manageable tool surface.` });
  if (skills.length > 25) findings.push({ level: "warning", text: `${skills.length} skills are loaded/discovered. Remove duplicates and keep specialized workflows on demand.` });
  else findings.push({ level: "good", text: `${skills.length} skills are available without excessive catalog size.` });
  const duplicateTools = tools.filter((tool, index, all) => all.findIndex((other) => other.name === tool.name) !== index);
  if (duplicateTools.length) findings.push({ level: "critical", text: `Duplicate tool names detected: ${[...new Set(duplicateTools.map((tool) => tool.name))].join(", ")}.` });
  const score = Math.max(0, 100 - findings.reduce((sum, finding) => sum + (finding.level === "critical" ? 25 : finding.level === "warning" ? 8 : 0), 0));
  return { generatedAt: new Date().toISOString(), project: ctx.cwd, score, verdict: score >= 90 ? "agent-efficient" : score >= 70 ? "usable with improvements" : "needs critical improvement", agents, skills, extensions, tools, findings };
};

const markdownReport = (result: InspectResult): string => {
  const section = (title: string, items: InspectItem[]) => `## ${title} (${items.length})\n${items.length ? items.map((item) => `- **${item.name}** — ${item.details ?? "configured"} \`${item.path}\``).join("\n") : "- None found"}`;
  return `# /work inspect\n\n**Project:** \`${result.project}\`  \n**Efficiency:** ${result.score}/100 — **${result.verdict}**\n\n## Findings\n${result.findings.map((finding) => `- **${finding.level.toUpperCase()}** — ${finding.text}`).join("\n")}\n\n${section("Agents / sub-agents", result.agents)}\n\n${section("Skills", result.skills)}\n\n${section("Extensions", result.extensions)}\n\n${section("Tools", result.tools)}`;
};

const htmlReport = (result: InspectResult): string => {
  const data = JSON.stringify(result).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Work Inspect Report</title><style>:root{color-scheme:light dark;--bg:#f7f7f5;--panel:#fff;--text:#171717;--muted:#666;--line:#ddd;--accent:#2563eb}body.dark{--bg:#111;--panel:#191919;--text:#eee;--muted:#aaa;--line:#333;--accent:#60a5fa}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,sans-serif}main{max-width:1040px;margin:auto;padding:32px 20px}header{display:flex;justify-content:space-between;gap:20px;align-items:start}.score{font-size:2.5rem;font-weight:700}button{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:8px 12px;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:24px 0}.card,section{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px}section{margin:12px 0}h1,h2{margin:0 0 10px}h2{font-size:1rem}.muted,small{color:var(--muted)}ul{margin:0;padding-left:20px}.critical{color:#dc2626}.warning{color:#d97706}.good{color:#16a34a}details{border-top:1px solid var(--line);padding:9px 0}details:first-of-type{border:0}code{font-size:12px;overflow-wrap:anywhere}</style></head><body><main><header><div><h1>Project configuration</h1><div class="muted" id="project"></div></div><button id="theme">Toggle theme</button></header><div class="grid" id="summary"></div><section><h2>Findings</h2><ul id="findings"></ul></section><div id="sections"></div></main><script>const d=${data};const q=s=>document.querySelector(s),esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));q('#project').textContent=d.project+' · '+d.generatedAt;q('#summary').innerHTML='<div class="card"><div class="score">'+d.score+'</div><div>'+esc(d.verdict)+'</div></div>'+['agents','skills','extensions','tools'].map(k=>'<div class="card"><div class="score">'+d[k].length+'</div><div>'+k+'</div></div>').join('');q('#findings').innerHTML=d.findings.map(x=>'<li class="'+x.level+'"><b>'+x.level.toUpperCase()+'</b> — '+esc(x.text)+'</li>').join('');q('#sections').innerHTML=['agents','skills','extensions','tools'].map(k=>'<section><h2>'+k[0].toUpperCase()+k.slice(1)+' ('+d[k].length+')</h2>'+d[k].map(x=>'<details><summary>'+esc(x.name)+' <small>'+esc(x.details||'')+'</small></summary><code>'+esc(x.path)+'</code></details>').join('')+'</section>').join('');const saved=localStorage.getItem('work-theme');if(saved==='dark')document.body.classList.add('dark');q('#theme').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem('work-theme',document.body.classList.contains('dark')?'dark':'light')};</script></body></html>`;
};

const inspect = async (args: string, pi: ExtensionAPI, ctx: ExtensionCommandContext) => {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.some((token) => token !== "--report")) {
    ctx.ui.notify("Usage: /work inspect [--report]", "error");
    return;
  }
  const result = await inspectProject(pi, ctx);
  let content = markdownReport(result);
  if (tokens.includes("--report")) {
    const output = join(ctx.cwd, "work-inspect-report.html");
    await writeFile(output, htmlReport(result), "utf8");
    content += `\n\nHTML report: \`${output}\``;
  }
  pi.sendMessage({ customType: "work-controller-inspect", content, display: true }, { triggerTurn: false });
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
      const values = ["help", "inspect", "inspect --report", "scaffold", "direct", "auto", "team"];
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
      if (command.toLowerCase() === "inspect") {
        await inspect(rest.join(" "), pi, ctx);
        return;
      }
      await startWork(trimmed, ctx);
    },
  });

  const shortcuts: Array<[string, WorkMode, string, number | undefined]> = [
    ["w1", "direct", "30s", 30_000],
    ["w2", "direct", "2m", 120_000],
    ["w3", "auto", "10m", 600_000],
    ["w4", "team", "unlimited", undefined],
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
