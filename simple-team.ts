import { meshPanel, type MeshRow } from "./mesh-panel.ts";
import { basename } from "node:path";
import { editTeamRequest, workPicker, reviewWork } from "./work-tui.ts";
import { plain } from "./work-review.mjs";
import {scopeProposal} from './team-scope.mjs';

export function simpleProposal(factory: any, goal: string) {
  const proposal = scopeProposal(factory,goal);
  // New drafts only. Never alter existing grants, resumptions or persisted defaults.
  proposal.requestText = goal.trim();
  proposal.definition.maxCost = 5;
  proposal.definition.maxTokens = null;
  proposal.definition.isolation = proposal.definition.scope==='review'?'shared':'worktree';
  if (Object.hasOwn(proposal.definition, "untilComplete"))
    proposal.definition.untilComplete = false;
  return proposal;
}
export async function simpleTeam(ctx: any, original: any, options: any) {
  if (ctx.mode !== "tui")
    throw new Error(
      "/mesh requires interactive Pi TUI mode. No work was started.",
    );
  let draft = structuredClone(original),
    selected = "request",
    notice = "";
  const pick = (title: string, items: any[]) => workPicker(ctx, title, items);
  for (;;) {
    const definition = draft.definition,
      tasks = definition.stages.flatMap((s: any) => s.tasks);
    let error = "",
      preview: any;
    try {
      options.validate(definition);
      preview = await options.preview(draft);
    } catch (e: any) {
      error = e.message;
    }
    const effective = preview?.steps?.flatMap((s: any) => s.tasks) || tasks;
    const models = [
      ...new Set(
        effective.map(
          (task: any) =>
            task.model ||
            options.profiles[task.profile]?.model ||
            options.currentModel,
        ),
      ),
    ];
    const cost = preview?.limits
      ? preview.limits.estimatedCost
      : definition.maxCost;
    const budget = cost === null ? "UNLIMITED" : `$${cost ?? 10} estimated`;
    const rows: MeshRow[] = [
      {
        id: "request",
        label: "Task",
        value: draft.requestText || "Custom worker instructions",
        detail: plain(draft.requestText || tasks[0]?.task || ""),
      },
      {
        id: "team",
        label: "Team",
        value: `${definition.scope==='review'?'Review only':'Build / fix'} · ${effective.map((t: any) => t.role || t.profile).join(' → ')}`,
        detail: definition.scope==='review'?'Inspect and report only: no editing, shell, extensions or implementation stages. Change scope explicitly to build.':'Writers may implement changes and tests. Change chooses Review only, Build / fix, or custom workers.',
      },
      {
        id: "model",
        label: "Model",
        value:
          models.length === 1
            ? String(models[0])
            : `Custom · ${models.length} models`,
        detail:
          models.join("\n") +
          "\nChange picks one exact model for the whole team; per-worker choices are in Advanced.",
      },
      {
        id: "budget",
        label: "Spending",
        value: `${budget} · ${definition.maxTokens==null?'audit only':definition.maxTokens+' tokens'}`,
        detail:
          'Usage is audited by default without a token hard stop. Advanced → Token budget can set an optional ceiling. Cost/time/spawn limits remain separate; cached input still counts in the audit.',
      },
      {
        id: "workspace",
        label: "Files",
        value:
          definition.isolation === "shared"
            ? (definition.scope==='review'?'Current project — inspect only':'Current project — direct edits')
            : "Separate Git worktree",
        detail:
          `Project: ${preview?.workingDirectory || preview?.project || ctx.cwd || ""}\n` +
          (definition.isolation === "shared"
            ? (definition.scope==='review'?'Worker tools are read-only. Runtime logs/handoffs are still recorded; no OS sandbox.':'Workers can edit current project files directly. No automatic cleanup or stash.')
            : "Separate working directory; clean Git source required. Not a security sandbox."),
      },
      {
        id: "execution",
        label: "Run",
        value: draft.background ? "In background" : "Stay in Pi",
        detail: draft.background
          ? "Continues if Pi closes. Inspect with /mesh jobs list or /mesh dashboard."
          : "Attached to this Pi session.",
      },
      {
        id: "advanced",
        label: "Advanced",
        value: "Optional · workers, context, limits, continuation",
        detail:
          "Most tasks need no changes here. Existing exact permission and acceptance review is retained.",
      },
      {
        id: "details",
        label: "Permissions",
        value: "Inspect full execution plan",
        detail:
          "Host processes, NOT a sandbox. View exact tools, instructions, acceptance gates and limits before accepting.",
      },
    ];
    const risk =
      cost === null
        ? "UNLIMITED COST"
        : preview?.continuation?.untilComplete
          ? "Automatic continuation"
          : "Bounded run";
    const result = await meshPanel(
      ctx,
      `Mesh · new team${preview?.project ? " · " + basename(preview.project) : ""}`,
      rows,
      {
        selected,
        notice:
          error || notice || `${risk} · ${budget} · host tools, NOT sandboxed`,
        hint: "↑↓ option · Enter change · Tab action · Accept starts · Esc cancel",
        acceptLabel: "Accept",
      },
    );
    selected = result.row;
    if (result.action === "cancel") return undefined;
    if (result.action === "accept") {
      if (error || !preview) {
        notice = error || "Execution preview is unavailable";
        continue;
      }
      try {
        await options.preflight?.(definition);
        return { request: draft, approval: JSON.stringify(preview) };
      } catch (e: any) {
        notice = e.message;
        continue;
      }
    }
    notice = "";
    try {
      if (result.row === "request") {
        const goal = await ctx.ui.editor(
          "What should Mesh do?",
          draft.requestText || "",
        );
        if (
          goal === undefined ||
          !goal.trim() ||
          goal.trim() === draft.requestText
        )
          continue;
        // Rebuilding worker prompts must not silently discard custom instructions.
        if (
          !(await ctx.ui.confirm(
            "Update task and regenerate worker instructions?",
            "This resets custom worker tasks/roles and suggests scope again. Spending and execution settings are retained.",
          ))
        )
          continue;
        const next = scopeProposal(options.factory,goal.trim());
        draft = {
          ...draft,
          requestText: goal.trim(),
          definition: { ...definition, scope:next.definition.scope, isolation:next.definition.isolation, watchdog:next.definition.watchdog??false, stages: next.definition.stages },
        };
        if (models.length === 1)
          for (const stage of draft.definition.stages)
            for (const task of stage.tasks) task.model = models[0];
      } else if (result.row === "model") {
        const model = await pick(
          "Model for the team · type to search",
          options.models.map((value: string) => ({ value, label: value })),
        );
        if (model) for (const task of tasks) task.model = model;
      } else if (result.row === "budget") {
        const choice = await pick(
          "Spending limit",
          [2, 5, 10, 25]
            .map((value) => ({
              value: String(value),
              label: `$${value}`,
              description: "Estimated total cost",
            }))
            .concat([
              {
                value: "custom",
                label: "Custom amount",
                description: "Enter a finite limit",
              },
            ]),
        );
        if (!choice) continue;
        const value =
          choice === "custom"
            ? await ctx.ui.editor(
                "Estimated-cost limit ($, greater than 0, at most 100)",
                String(definition.maxCost ?? 5),
              )
            : choice;
        if (value === undefined) continue;
        const amount = Number(value);
        if (
          !value.trim() ||
          !Number.isFinite(amount) ||
          amount <= 0 ||
          amount > 100
        )
          throw new Error("Enter a cost limit greater than 0 and at most 100");
        definition.maxCost = amount;
      } else if (result.row === "workspace") {
        const scope = await pick(definition.scope==='review'?'Where should the team review files?':"Where may the team edit files?", [
          {
            value: "worktree",
            label: "Separate Git worktree",
            description: "Recommended · requires clean Git source",
          },
          {
            value: "shared",
            label: "Current project",
            description: definition.scope==='review'?'Inspect current files without writer tools':'Direct edits to current files; preserve your own backup',
          },
        ]);
        if (scope) definition.isolation = scope;
      } else if (result.row === "execution") {
        const mode = await pick("Execution", [
          {
            value: "background",
            label: "In background",
            description: "Continues after Pi closes",
          },
          {
            value: "foreground",
            label: "Stay in Pi",
            description: "Attached to this session",
          },
        ]);
        if (mode) draft.background = mode === "background";
      } else if (result.row === "details") {
        if (preview) await reviewWork(ctx, preview, undefined, true, true);
      } else if (result.row === "advanced" || result.row === "team") {
        if(result.row==='team') {
          const scope=await pick('What may this team do?',[
            {value:'review',label:'Review only',description:'Inspect and report; no edits, shell commands or implementation'},
            {value:'build',label:'Build / fix',description:'Plan, implement, test and review changes'},
            {value:'custom',label:'Customize workers',description:'Keep the selected scope and edit worker settings'},
          ]);
          if(!scope)continue;
          if(scope!=='custom') {
            const next=scopeProposal(options.factory,draft.requestText||'Follow the existing request',scope);
            draft={...draft,definition:{...definition,scope,isolation:next.definition.isolation,watchdog:next.definition.watchdog??false,stages:next.definition.stages}};
            if(models.length===1)for(const stage of draft.definition.stages)for(const task of stage.tasks)task.model=models[0];
            continue;
          }
        }
        const edited = await editTeamRequest(ctx, draft, {
          ...options,
          title: "Mesh · advanced (optional)",
          doneLabel: "Return to simple view →",
          preflight: undefined,
        });
        if (edited) draft = edited;
      }
    } catch (e: any) {
      notice = e.message;
    }
  }
}
