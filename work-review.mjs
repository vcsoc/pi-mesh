// Escape controls visibly, rather than hiding any part of the approved task.
export const plain = (value) =>
  String(value ?? "").replace(
    /[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

// Presentation only. The compiled specification remains the execution authority.
export function workflowSummaryLines(summary) {
  const workers = (summary.steps || []).flatMap(stage => stage.tasks);
  const models = [...new Set(workers.map(task => plain(task.model)))];
  const limits = summary.limits || {};
  const checks = workers.reduce((count, task) => count + (task.acceptance?.length || 0), 0);
  const lines = [
    `Project: ${summary.project}`,
    `Work: ${workers.length} workers, up to ${limits.concurrency ?? 1} at once; ${summary.background ? 'background' : 'foreground'}`,
    `Files: ${summary.isolation === 'shared' ? 'SHARED, edits your current files' : 'isolated Git worktrees'}`,
    limits.estimatedCost === null ? 'Budget: UNLIMITED, no total spending ceiling' : `Budget: up to $${limits.estimatedCost} estimated`,
    `Tokens: ${limits.tokens == null ? 'audit only, no ceiling' : limits.tokens.toLocaleString('en-US')}; child spawns: ${limits.spawns}; timeout: ${Math.round((limits.childDeadlineMs || 0) / 60000)} min per worker`,
    `Continuation: ${summary.continuation?.untilComplete ? 'automatic until completion or stopped' : 'pauses at checkpoints; no automatic continuation'}`,
    'OpenShell NOT integrated: host permissions apply, no OS sandbox',
    'Parent approval hooks are not inherited; no automatic commit or push',
    checks ? `Checks: ${checks} explicit gates; passing is not independent certification` : 'Checks: none defined; completion will remain UNVERIFIED',
    ...(models.length === 1 ? [`Model: ${models[0]}`] : []),
    '',
    'WORKERS',
    ...workers.flatMap((task, index) => {
      const label = plain(task.lane || task.id).replace(/[-_]/g, ' ');
      const brief = plain(task.task).replace(/[\r\n\t]+/g, ' ').split(/(?<=[.!?])\s/)[0];
      return [
        `${index + 1}. ${label} (${task.role}; ${task.write ? 'may write' : task.write === false ? 'read only' : 'write permission unspecified'})`,
        `   ${brief.length > 180 ? brief.slice(0, 177) + '...' : brief}`,
        ...(models.length > 1 ? [`   Model: ${task.model}`] : []),
      ];
    }),
    '',
    'Summaries are shortened. Open details for exact tasks, tools and checks',
  ];
  return lines.flatMap(line => plain(line).split('\n'));
}

export function workflowReviewLines(summary) {
  const lines = [
    "MESH EXECUTION REVIEW",
    `Project: ${summary.project}`,
    `AI gateway: ${summary.gateway?.mode||'audit'} | metadata audit enabled | OS confinement unverified`,
    `Working directory: ${summary.workingDirectory || summary.project}`,
    `Scope: ${summary.scope==='review'?'REVIEW ONLY — inspection and findings; no writer/shell/extension tools':summary.scope==='build'?'BUILD / FIX — may implement changes':'Custom — inspect each worker below'}`,
    `Workspace: ${summary.isolation === "shared" ? (summary.scope==='review'?'SHARED — inspect current files; runtime logs/handoffs still recorded':'SHARED — workers may edit your current files directly') : "Managed Git worktrees (writing lanes require clean source)"}`,
    `Run: ${summary.background ? "Background — survives closing Pi" : "Foreground"}`,
    `Thinking: ${summary.thinkingLevel || "inherited from parent"}`,
    `Context: ${summary.context || "fresh"}${summary.context === "fork" ? " — includes a bounded parent conversation snapshot" : ""}`,
  ];
  const limits = summary.limits || {};
  const continuous = summary.continuation?.untilComplete === true;
  lines.push(
    continuous
      ? limits.tokenLimitMode==='hard'
        ? 'AUTOMATIC CONTINUATION: time/spawn counts are checkpoints, NOT total ceilings. Your selected token ceiling remains a HARD STOP.'
        : limits.tokenLimitMode==='audit'
          ? 'AUTOMATIC CONTINUATION: token audit only, no token ceiling; time/spawn counts are checkpoints, NOT total ceilings.'
          : "AUTOMATIC CONTINUATION: legacy tokens, time and spawn counts are checkpoints, NOT total ceilings."
      : "Bounded execution: no automatic checkpoint continuation.",
    limits.estimatedCost === null
      ? "WARNING: NO TOTAL SPENDING CEILING. Quota/cost may accumulate indefinitely."
      : `Estimated-cost ceiling: $${limits.estimatedCost} (provider-reported costs may be incomplete)`,
    `Tokens: ${limits.tokens==null?'AUDIT ONLY — no token ceiling':limits.tokens} | child spawns: ${limits.spawns} | concurrency: ${limits.concurrency}`,
    `Child timeout: ${limits.childDeadlineMs} ms`,
  );
  if (limits.costApprovalBase)
    lines.push(`Prior approved cost baseline: ${limits.costApprovalBase}`);
  if (summary.schedule)
    lines.push(
      `Schedule: ${new Date(summary.schedule.at).toISOString()} | interval ${summary.schedule.everyMs} ms | at most ${summary.schedule.maxRuns} runs`,
    );
  lines.push(
    "",
    "PERMISSIONS AND RISKS",
    "OpenShell enforcement is NOT integrated. These are host processes, not a sandbox.",
    "Parent extension permission hooks are NOT inherited by workers or command gates.",
    "Bash and selected extensions run with your OS permissions. Tool lists are not filesystem isolation.",
    "No automatic commit/push. A passing task gate is not independent certification.",
  );
  if (continuous)
    lines.push(
      "Automatic continuation, compaction and acceptance repair continue until gates pass or you stop; repeated failures pause for input.",
    );
  for (const [index, stage] of (summary.steps || []).entries()) {
    lines.push(
      "",
      `STAGE ${index + 1} — ${stage.parallel ? "parallel" : "sequential"} | retries: ${stage.retries ?? 0}`,
    );
    if (stage.when)
      lines.push(
        `Only when ${stage.when.step}.${stage.when.field} equals ${JSON.stringify(stage.when.equals)}`,
      );
    for (const task of stage.tasks) {
      lines.push(
        `Worker: ${task.id} | role: ${task.role} | lane: ${task.lane}`,
        `Exact model: ${task.model}`,
        `Profile write permission: ${task.write === true ? "yes" : task.write === false ? "no" : "unspecified"}`,
        `Tools: ${task.tools?.join(", ") || "(none)"}`,
        `Extensions: ${task.extensions?.length ? task.extensions.map((e) => (typeof e === "string" ? e : `${e.name || e.entry || e.path} [${e.sha256 || e.hash || e.digest || "see manifest"}]`)).join(", ") : "(none)"}`,
        `Extension tools: ${task.extensionTools?.join(", ") || "(none)"}`,
        "Task:",
        task.task,
      );
      if (task.prompt) lines.push("Role instructions:", task.prompt);
      lines.push("Acceptance gates:");
      if (!task.acceptance?.length)
        lines.push(
          "  None — runtime completion alone does not prove acceptance.",
        );
      for (const gate of task.acceptance || []) {
        if (gate.type === "command")
          lines.push(
            `  Host command: ${gate.command}`,
            `  Arguments (separate, not a shell string): ${(gate.args || []).map((a) => JSON.stringify(a)).join(" ")}`,
            `  Timeout: ${gate.timeoutMs} ms`,
          );
        else
          lines.push(
            `  JSON fields required: ${gate.required?.join(", ") || "(none)"}`,
            `  Field types: ${
              Object.entries(gate.types || {})
                .map(([k, v]) => `${k}: ${v}`)
                .join(", ") || "(none)"
            }`,
            `  Required values: ${
              Object.entries(gate.equals || {})
                .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
                .join(", ") || "(none)"
            }`,
          );
      }
    }
  }
  return lines.flatMap((line) => plain(line).split("\n"));
}
