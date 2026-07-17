import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
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

/work agents
  List project sub-agents available for direct conversation.

/work agent <agent-id> <request or question>
  Talk directly to a persistent sub-agent. The same conversation is resumed for later requests and questions.
  If the agent is busy, the message is queued as a follow-up.

/work agent <agent-id> --steer <message>
  Interrupt a busy sub-agent at its next safe turn with a question or changed instruction.

/work agent <agent-id> --status | --abort | --new
  Show its current/latest work, abort active work, or start a fresh conversation.

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

### Talk directly to sub-agents

/work agents
/work agent senior-architect Review the current authentication design
/work agent senior-architect What tradeoffs led to that recommendation?
/work agent senior-backend-developer --steer Before continuing, check whether this breaks migrations
/work agent senior-backend-developer --status
/work agent senior-backend-developer --abort
/work agent senior-backend-developer --new

Direct sub-agent conversations use isolated persistent Pi sessions under .pi/sessions/agents/<agent-id>. Their completed replies appear in the parent transcript.

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
- Direct agent messages use the selected agent's existing config and AGENTS.md role prompt.
- Messages sent while an agent is busy queue as follow-ups unless --steer is explicit.
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

type InspectScope = "project" | "global" | "builtin" | "unknown";
type InspectItem = { name: string; path: string; details?: string; scope: InspectScope; warnings?: string[] };
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
    agents.push({ name, path: relative(ctx.cwd, root), details, scope: "project" });
  }

  const projectSkillRoots = [join(ctx.cwd, ".pi", "skills"), join(ctx.cwd, ".agents", "skills")];
  const projectSkillNames = new Set((await Promise.all(projectSkillRoots.map(listDirectories))).flat());
  const loadedSkills = ((ctx.getSystemPromptOptions().skills ?? []) as Array<Record<string, unknown>>).map((skill) => {
    const name = String(skill.name ?? "unnamed");
    const sourceInfo = skill.sourceInfo as Record<string, unknown> | undefined;
    const path = String(skill.path ?? skill.filePath ?? sourceInfo?.path ?? skill.source ?? "loaded resource");
    const scope: InspectScope = projectSkillNames.has(name) || (path !== "loaded resource" && resolve(path).startsWith(resolve(ctx.cwd))) ? "project" : "global";
    return { name, path, scope, details: typeof skill.description === "string" ? skill.description : undefined };
  });
  const discoveredSkills: InspectItem[] = [];
  for (const root of projectSkillRoots) {
    for (const name of await listDirectories(root)) discoveredSkills.push({ name, path: relative(ctx.cwd, join(root, name)), details: "project-local", scope: "project" });
  }
  const skills = [...loadedSkills, ...discoveredSkills].filter((item, index, all) => all.findIndex((other) => other.name === item.name && other.path === item.path) === index);

  const extensionRoots = [join(ctx.cwd, ".pi", "extensions"), join(homedir(), ".pi", "agent", "extensions")];
  const extensions: InspectItem[] = [];
  for (const root of extensionRoots) {
    if (!existsSync(root)) continue;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() && !/\.[cm]?[jt]s$/.test(entry.name)) continue;
      const scope: InspectScope = resolve(root).startsWith(resolve(ctx.cwd)) ? "project" : "global";
      extensions.push({ name: entry.name.replace(/\.[^.]+$/, ""), path: join(root, entry.name), details: scope === "project" ? "project-local" : "harness/global", scope });
    }
  }

  const tools: InspectItem[] = pi.getAllTools().map((tool) => {
    const path = String(tool.sourceInfo?.path ?? tool.sourceInfo?.source ?? "unknown");
    const declaredScope = String(tool.sourceInfo?.scope ?? "");
    const scope: InspectScope = tool.sourceInfo?.source === "builtin" ? "builtin" : declaredScope === "project" || resolve(path).startsWith(resolve(ctx.cwd)) ? "project" : path === "unknown" ? "unknown" : "global";
    return { name: tool.name, path, scope, details: pi.getActiveTools().includes(tool.name) ? "active" : "inactive" };
  });
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
  const duplicateToolNames = new Set(duplicateTools.map((tool) => tool.name));
  if (duplicateTools.length) findings.push({ level: "critical", text: `Duplicate tool names detected: ${[...duplicateToolNames].join(", ")}.` });

  const addWarning = (item: InspectItem, warning: string) => { item.warnings = [...(item.warnings ?? []), warning]; };
  for (const agent of agents) {
    if (agent.details?.startsWith("missing")) addWarning(agent, "This agent has no readable agent.config.json.");
    if (!hasLauncher) addWarning(agent, "The project agent launcher scripts/run-agent.mjs is missing.");
    if (!hasRegistry) addWarning(agent, "The project has no agent-registry.json defining orchestration order.");
  }
  if (activeTools > 20) for (const tool of tools.filter((item) => item.details === "active")) addWarning(tool, `${activeTools} tools are active; reduce the active surface to improve tool selection efficiency.`);
  if (skills.length > 25) for (const skill of skills) addWarning(skill, `${skills.length} skills are loaded or discovered; consider removing duplicates or moving specialized skills on demand.`);
  for (const tool of tools.filter((item) => duplicateToolNames.has(item.name))) addWarning(tool, `The tool name “${tool.name}” is registered more than once and may resolve ambiguously.`);

  const score = Math.max(0, 100 - findings.reduce((sum, finding) => sum + (finding.level === "critical" ? 25 : finding.level === "warning" ? 8 : 0), 0));
  return { generatedAt: new Date().toISOString(), project: ctx.cwd, score, verdict: score >= 90 ? "agent-efficient" : score >= 70 ? "usable with improvements" : "needs critical improvement", agents, skills, extensions, tools, findings };
};

const markdownReport = (result: InspectResult): string => {
  const section = (title: string, items: InspectItem[]) => `## ${title} (${items.length})\n${items.length ? items.map((item) => `- **${item.name}** — [${item.scope}] ${item.details ?? "configured"} \`${item.path}\``).join("\n") : "- None found"}`;
  return `# /work inspect\n\n**Project:** \`${result.project}\`  \n**Efficiency:** ${result.score}/100 — **${result.verdict}**\n\n## Findings\n${result.findings.map((finding) => `- **${finding.level.toUpperCase()}** — ${finding.text}`).join("\n")}\n\n${section("Agents / sub-agents", result.agents)}\n\n${section("Skills", result.skills)}\n\n${section("Extensions", result.extensions)}\n\n${section("Tools", result.tools)}`;
};

const htmlReport = (result: InspectResult): string => {
  const data = JSON.stringify(result).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Work Inspect · Project Intelligence</title><style>
:root{color-scheme:light;--bg:#f5f7fb;--surface:rgba(255,255,255,.82);--solid:#fff;--text:#111827;--muted:#667085;--line:#e7eaf0;--accent:#635bff;--accent2:#06b6d4;--shadow:0 16px 45px rgba(27,39,94,.08);--good:#15803d;--warn:#b45309;--bad:#dc2626}body.dark{color-scheme:dark;--bg:#0b0d12;--surface:rgba(20,23,31,.84);--solid:#14171f;--text:#f3f4f6;--muted:#9299a8;--line:#292e39;--accent:#8b83ff;--accent2:#22d3ee;--shadow:0 18px 50px rgba(0,0,0,.28);--good:#4ade80;--warn:#fbbf24;--bad:#fb7185}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 15% -10%,color-mix(in srgb,var(--accent) 14%,transparent),transparent 32rem),var(--bg);color:var(--text);font:14px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;min-height:100vh}main{max-width:1180px;margin:auto;padding:38px 24px 64px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:20px}.eyebrow{color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.title{font-size:clamp(26px,4vw,42px);letter-spacing:-.04em;line-height:1.08;margin:5px 0}.muted{color:var(--muted)}.icon-btn{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;border:1px solid var(--line);background:var(--surface);color:var(--text);box-shadow:var(--shadow);cursor:pointer;transition:.2s}.icon-btn:hover{transform:translateY(-2px);border-color:var(--accent)}.icon-btn svg{width:19px;height:19px}.sun{display:none}.dark .sun{display:block}.dark .moon{display:none}.search-wrap{position:relative;margin:28px 0 18px}.search-wrap svg{position:absolute;left:17px;top:50%;transform:translateY(-50%);width:18px;color:var(--muted)}#search{width:100%;height:52px;padding:0 48px;border:1px solid var(--line);border-radius:16px;background:var(--surface);backdrop-filter:blur(16px);color:var(--text);font:inherit;outline:none;box-shadow:var(--shadow)}#search:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 15%,transparent)}.telemetry{position:relative;z-index:50;overflow:visible;display:grid;grid-template-columns:1.25fr repeat(4,1fr);gap:12px;margin:18px 0 28px}.metric{position:relative;padding:18px;border:1px solid var(--line);border-radius:18px;background:var(--surface);backdrop-filter:blur(16px);box-shadow:var(--shadow)}.metric strong{display:block;font-size:28px;letter-spacing:-.04em}.metric span{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em}.metric.primary{background:linear-gradient(135deg,var(--accent),var(--accent2));color:white;border:0}.metric.primary span{color:rgba(255,255,255,.75)}.metric:hover{z-index:1000}[data-tip]{position:relative;cursor:help}[data-tip]:hover:after{content:attr(data-tip);position:absolute;z-index:9999;left:14px;top:calc(100% + 8px);width:220px;padding:9px 11px;border-radius:10px;background:#111827;color:#fff;font-size:12px;font-weight:400;letter-spacing:0;text-transform:none;box-shadow:var(--shadow)}.layout{position:relative;z-index:1;display:grid;grid-template-columns:320px 1fr;gap:16px}.panel{background:var(--surface);backdrop-filter:blur(16px);border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow);overflow:visible}.panel-head{padding:18px 20px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}.panel-head h2{font-size:14px;margin:0}.findings{padding:12px}.finding{padding:12px;border-radius:12px;margin:5px 0;background:color-mix(in srgb,var(--line) 28%,transparent)}.finding b{font-size:10px;letter-spacing:.1em}.critical{color:var(--bad)}.warning{color:var(--warn)}.good{color:var(--good)}#sections{display:grid;gap:16px}.resource{padding:14px 18px;border-top:1px solid var(--line)}.resource:first-child{border-top:0}.resource-top{display:flex;align-items:center;gap:10px}.resource-name{font-weight:700;flex:1}.badge{border:1px solid var(--line);border-radius:999px;padding:2px 8px;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.badge.project{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}.badge.global{color:var(--accent2)}.badge.builtin{color:var(--muted)}.badge.alert{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 55%,var(--line));background:color-mix(in srgb,var(--warn) 9%,transparent)}.badge.alert:hover{z-index:10000}.panel:has(.badge.alert:hover){z-index:100}.resource p{margin:5px 0 0;color:var(--muted);font-size:12px}.resource code{display:block;margin-top:7px;color:var(--muted);font-size:11px;overflow-wrap:anywhere}.empty{padding:28px;text-align:center;color:var(--muted)}.hidden{display:none!important}.legend{display:flex;gap:8px;flex-wrap:wrap}.result-count{font-size:12px;color:var(--muted)}@media(max-width:820px){.telemetry{grid-template-columns:repeat(2,1fr)}.metric.primary{grid-column:span 2}.layout{grid-template-columns:1fr}}@media(max-width:520px){main{padding:24px 14px}.telemetry{grid-template-columns:1fr}.metric.primary{grid-column:auto}.topbar{align-items:flex-start}}
</style></head><body><main><header class="topbar"><div><div class="eyebrow">Work controller · inspect</div><h1 class="title">Project intelligence</h1><div class="muted" id="project"></div></div><button class="icon-btn" id="theme" aria-label="Toggle color theme" title="Toggle light or dark theme"><svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z"/></svg><svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></button></header><div class="search-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="search" type="search" placeholder="Search agents, skills, extensions, tools, paths…" autocomplete="off" aria-label="Search report"></div><div class="telemetry" id="summary"></div><div class="layout"><aside class="panel"><div class="panel-head"><h2>Configuration signals</h2></div><div class="findings" id="findings"></div></aside><div id="sections"></div></div></main><script>
const d=${data},kinds=['agents','skills','extensions','tools'];const q=s=>document.querySelector(s),esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));q('#project').textContent=d.project+' · Generated '+new Date(d.generatedAt).toLocaleString();const tips={score:'Efficiency score after deductions for missing infrastructure, excessive resource surfaces, and duplicate tools.',agents:'Project-defined agent and sub-agent roles discovered under agents/.',skills:'Skills available to this Pi session from both project and global harness configuration.',extensions:'Pi extensions discovered in project-local and global harness locations.',tools:'Built-in and extension-provided tools, including both active and inactive tools.'};q('#summary').innerHTML='<div class="metric primary" data-tip="'+tips.score+'"><strong>'+d.score+'</strong><span>'+esc(d.verdict)+'</span></div>'+kinds.map(k=>'<div class="metric" data-tip="'+tips[k]+'"><strong>'+d[k].length+'</strong><span>'+k+'</span></div>').join('');q('#findings').innerHTML=d.findings.map(x=>'<div class="finding"><b class="'+x.level+'">'+x.level.toUpperCase()+'</b><div>'+esc(x.text)+'</div></div>').join('');const render=()=>{const term=q('#search').value.trim().toLowerCase();let shown=0;q('#sections').innerHTML=kinds.map(k=>{const items=d[k].filter(x=>!term||[x.name,x.path,x.details,x.scope,k].join(' ').toLowerCase().includes(term));shown+=items.length;return '<section class="panel '+(items.length?'':'hidden')+'"><div class="panel-head"><h2>'+k[0].toUpperCase()+k.slice(1)+'</h2><div class="legend"><span class="badge project">Project</span><span class="badge global">Harness</span><span class="result-count">'+items.length+'</span></div></div><div>'+items.map(x=>'<article class="resource"><div class="resource-top"><span class="resource-name">'+esc(x.name)+'</span>'+((x.warnings||[]).map(w=>'<span class="badge alert" data-tip="'+esc(w)+'" title="'+esc(w)+'">Warning</span>').join(''))+'<span class="badge '+x.scope+'">'+(x.scope==='global'?'harness':esc(x.scope))+'</span></div><p>'+esc(x.details||'Configured resource')+'</p><code>'+esc(x.path)+'</code></article>').join('')+'</div></section>'}).join('')+(shown?'':'<section class="panel empty">No resources match “'+esc(term)+'”.</section>')};q('#search').addEventListener('input',render);render();const saved=localStorage.getItem('work-theme');if(saved==='dark'||(!saved&&matchMedia('(prefers-color-scheme:dark)').matches))document.body.classList.add('dark');q('#theme').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem('work-theme',document.body.classList.contains('dark')?'dark':'light')};
</script></body></html>`;
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

type ProjectAgent = {
  id: string;
  displayName: string;
  config: Record<string, unknown>;
  rolePrompt: string;
};

type AgentRuntime = {
  agent: ProjectAgent;
  child: ChildProcessWithoutNullStreams;
  running: boolean;
  latestText: string;
  stderr: string;
  startedAt: number;
  intentionallyStopped: boolean;
};

const discoverProjectAgents = async (cwd: string): Promise<ProjectAgent[]> => {
  const root = join(cwd, "agents");
  const agents: ProjectAgent[] = [];
  for (const id of await listDirectories(root)) {
    const config = await readJson(join(root, id, "agent.config.json"));
    const promptPath = join(root, id, "AGENTS.md");
    if (!config || !existsSync(promptPath)) continue;
    agents.push({
      id,
      displayName: String(config.displayName ?? id),
      config,
      rolePrompt: await readFile(promptPath, "utf8"),
    });
  }
  return agents;
};

const assistantText = (message: Record<string, unknown> | undefined): string => {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return "";
  return message.content
    .filter((part): part is Record<string, unknown> => Boolean(part && typeof part === "object"))
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text))
    .join("\n")
    .trim();
};

const piInvocation = (args: string[]): { command: string; args: string[] } => {
  const globalCli = process.env.APPDATA
    ? resolve(process.env.APPDATA, "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js")
    : undefined;
  if (process.platform === "win32" && globalCli && existsSync(globalCli)) {
    return { command: process.execPath, args: [globalCli, ...args] };
  }
  return { command: "pi", args };
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
  const agentRuntimes = new Map<string, AgentRuntime>();

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

  const stopAgent = (id: string) => {
    const runtime = agentRuntimes.get(id);
    if (!runtime) return false;
    runtime.intentionallyStopped = true;
    if (!runtime.child.killed) runtime.child.kill("SIGTERM");
    agentRuntimes.delete(id);
    return true;
  };

  const sendRpc = (runtime: AgentRuntime, command: Record<string, unknown>) => {
    if (runtime.child.exitCode !== null || !runtime.child.stdin.writable) throw new Error(`Sub-agent '${runtime.agent.id}' is not available.`);
    runtime.child.stdin.write(`${JSON.stringify(command)}\n`);
  };

  const startAgentRuntime = async (agent: ProjectAgent, ctx: ExtensionCommandContext, fresh = false): Promise<AgentRuntime> => {
    const existing = agentRuntimes.get(agent.id);
    if (existing && existing.child.exitCode === null) return existing;

    const sessionDir = join(ctx.cwd, ".pi", "sessions", "agents", agent.id);
    await mkdir(sessionDir, { recursive: true });
    const hasSessions = (await readdir(sessionDir)).some((name) => name.endsWith(".jsonl"));
    const args = ["--mode", "rpc", "--session-dir", sessionDir, "--name", `agent:${agent.id}`, "--append-system-prompt", agent.rolePrompt];
    if (!fresh && hasSessions) args.push("--continue");
    const configuredProvider = typeof agent.config.provider === "string" && agent.config.provider ? agent.config.provider : undefined;
    const configuredModel = typeof agent.config.model === "string" && agent.config.model ? agent.config.model : undefined;
    const provider = configuredProvider ?? ctx.model?.provider;
    const model = configuredModel ?? (!configuredProvider || configuredProvider === ctx.model?.provider ? ctx.model?.id : undefined);
    const thinking = typeof agent.config.thinking === "string" && agent.config.thinking ? agent.config.thinking : pi.getThinkingLevel();
    if (provider) args.push("--provider", provider);
    if (model) args.push("--model", model);
    if (thinking) args.push("--thinking", thinking);
    if (Array.isArray(agent.config.tools) && agent.config.tools.length) args.push("--tools", agent.config.tools.map(String).join(","));

    const invocation = piInvocation(args);
    const child = spawn(invocation.command, invocation.args, { cwd: ctx.cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    const runtime: AgentRuntime = { agent, child, running: false, latestText: "", stderr: "", startedAt: Date.now(), intentionallyStopped: false };
    agentRuntimes.set(agent.id, runtime);

    const decoder = new StringDecoder("utf8");
    let buffer = "";
    const processLine = (line: string) => {
      if (!line.trim() || runtime.intentionallyStopped) return;
      let event: Record<string, unknown>;
      try { event = JSON.parse(line) as Record<string, unknown>; } catch { return; }
      if (event.type === "agent_start") {
        runtime.running = true;
        runtime.latestText = "";
        ctx.ui.setStatus(`work-agent:${agent.id}`, `${agent.id} · working`);
      } else if (event.type === "message_end") {
        const text = assistantText(event.message as Record<string, unknown> | undefined);
        if (text) runtime.latestText = text;
      } else if (event.type === "agent_settled") {
        runtime.running = false;
        ctx.ui.setStatus(`work-agent:${agent.id}`, undefined);
        pi.sendMessage({
          customType: "work-agent-reply",
          content: `## ${agent.displayName}\n\n${runtime.latestText || "(The sub-agent completed without a text reply.)"}`,
          display: true,
          details: { agent: agent.id, startedAt: runtime.startedAt },
        }, { triggerTurn: false });
      } else if (
        event.type === "extension_ui_request"
        && typeof event.id === "string"
        && ["select", "confirm", "input", "editor"].includes(String(event.method))
      ) {
        sendRpc(runtime, { type: "extension_ui_response", id: event.id, cancelled: true });
      }
    };
    child.stdout.on("data", (chunk) => {
      buffer += decoder.write(chunk);
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        processLine(line);
      }
    });
    child.stdout.on("end", () => {
      buffer += decoder.end();
      if (buffer) processLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
    });
    child.stderr.on("data", (chunk) => { runtime.stderr = `${runtime.stderr}${chunk.toString()}`.slice(-8000); });
    child.on("error", (error) => { runtime.stderr = error.message; });
    child.on("close", (code) => {
      runtime.running = false;
      if (agentRuntimes.get(agent.id) === runtime) agentRuntimes.delete(agent.id);
      if (!runtime.intentionallyStopped) {
        ctx.ui.setStatus(`work-agent:${agent.id}`, undefined);
        if (code !== 0) ctx.ui.notify(`Sub-agent '${agent.id}' exited (${code ?? "unknown"}). ${runtime.stderr.trim()}`, "error");
      }
    });
    return runtime;
  };

  const handleAgentCommand = async (args: string, ctx: ExtensionCommandContext) => {
    if (!ctx.isProjectTrusted()) {
      ctx.ui.notify("Direct project sub-agent access is disabled until this project is trusted.", "error");
      return;
    }
    const trimmed = args.trim();
    const [id, ...parts] = trimmed.split(/\s+/);
    if (!id) {
      ctx.ui.notify("Usage: /work agent <agent-id> <message|--status|--abort|--new|--steer message>", "error");
      return;
    }
    const agents = await discoverProjectAgents(ctx.cwd);
    const agent = agents.find((candidate) => candidate.id === id);
    if (!agent) {
      ctx.ui.notify(`Unknown agent '${id}'. Available: ${agents.map((candidate) => candidate.id).join(", ") || "none"}`, "error");
      return;
    }
    const message = parts.join(" ").trim();
    if (message === "--abort") {
      const runtime = agentRuntimes.get(id);
      if (!runtime?.running) { ctx.ui.notify(`Sub-agent '${id}' is not working.`, "info"); return; }
      sendRpc(runtime, { type: "abort" });
      ctx.ui.notify(`Abort requested for '${id}'.`, "warning");
      return;
    }
    if (message === "--status" || !message) {
      const runtime = agentRuntimes.get(id);
      const state = runtime?.running ? "working" : runtime ? "idle" : "not started in this runtime";
      pi.sendMessage({ customType: "work-agent-status", content: `## ${agent.displayName} — ${state}\n\n${runtime?.latestText || "No reply is cached. Send a message to resume its persistent session."}`, display: true }, { triggerTurn: false });
      return;
    }
    if (message === "--new") {
      const runtime = agentRuntimes.get(id);
      if (runtime?.running) {
        ctx.ui.notify(`Sub-agent '${id}' is working. Abort it before starting a fresh conversation.`, "error");
        return;
      }
      if (runtime) sendRpc(runtime, { type: "new_session" });
      else await startAgentRuntime(agent, ctx, true);
      ctx.ui.notify(`Started a fresh conversation with '${id}'.`, "info");
      return;
    }

    const steer = message.startsWith("--steer ");
    const text = steer ? message.slice("--steer ".length).trim() : message;
    if (!text) { ctx.ui.notify("A message is required after --steer.", "error"); return; }
    const runtime = await startAgentRuntime(agent, ctx);
    if (runtime.running) sendRpc(runtime, { type: steer ? "steer" : "follow_up", message: text });
    else sendRpc(runtime, { type: "prompt", message: text });
    ctx.ui.notify(`${runtime.running ? steer ? "Steered" : "Queued for" : "Sent to"} '${id}'.`, "info");
  };

  pi.registerCommand("work", {
    description: "Control execution or talk directly to project sub-agents; use /work help",
    getArgumentCompletions: (prefix) => {
      const values = ["help", "inspect", "inspect --report", "scaffold", "agents", "agent", "direct", "auto", "team"];
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
      if (command.toLowerCase() === "agents") {
        if (!ctx.isProjectTrusted()) {
          ctx.ui.notify("Project sub-agent discovery is disabled until this project is trusted.", "error");
          return;
        }
        const agents = await discoverProjectAgents(ctx.cwd);
        const content = agents.length
          ? `# Project sub-agents\n\n${agents.map((agent) => `- **${agent.id}** — ${agent.displayName}${agentRuntimes.get(agent.id)?.running ? " *(working)*" : ""}`).join("\n")}\n\nUse \`/work agent <agent-id> <message>\` to talk directly.`
          : "# Project sub-agents\n\nNone found. Use `/work scaffold` to create the default infrastructure.";
        pi.sendMessage({ customType: "work-agent-list", content, display: true }, { triggerTurn: false });
        return;
      }
      if (command.toLowerCase() === "agent") {
        await handleAgentCommand(rest.join(" "), ctx);
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

  pi.on("session_shutdown", () => {
    clearDeadline();
    for (const id of [...agentRuntimes.keys()]) stopAgent(id);
  });
}
