import {
  Input,
  SelectList,
  Key,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { plain, workflowReviewLines } from "./work-review.mjs";

type Item = { value: string; label: string; description?: string };
const oneLine = (value: unknown) => plain(value).replace(/[\r\n\t]/g, " ");

// Each picker owns one Pi component lifecycle. No renderer, service or worker is started here.
export async function workPicker(
  ctx: any,
  title: string,
  items: Item[],
  detail = "",
): Promise<string | undefined> {
  if (ctx.mode !== "tui")
    throw new Error(
      "The Mesh team editor requires interactive Pi TUI mode. No work was started.",
    );
  return ctx.ui.custom((tui: any, theme: any, _keys: any, done: any) => {
    const search = new Input({ placeholder: "Type to search…" });
    const safeItems = items.map((item) => ({
      ...item,
      label: oneLine(item.label),
      description: oneLine(item.description),
    }));
    let capacity = 0,
      query = "",
      list: SelectList;
    const normalized = (value: string) =>
      value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
    const resize = () => {
      const next = Math.max(1, Math.min(10, (tui.terminal.rows || 24) - 9)),
        filter = search.getValue();
      if (next === capacity && filter === query) return;
      const selected =
        filter === query ? list?.getSelectedItem()?.value : undefined;
      capacity = next;
      query = filter;
      const words = normalized(filter).split(/\s+/).filter(Boolean),
        filtered = safeItems.filter((item) =>
          words.every((word) =>
            normalized(
              `${item.value} ${item.label} ${item.description}`,
            ).includes(word),
          ),
        );
      list = new SelectList(filtered, capacity, {
        selectedPrefix: (s: string) => theme.fg("accent", s),
        selectedText: (s: string) => theme.fg("accent", s),
        description: (s: string) => theme.fg("muted", s),
        scrollInfo: (s: string) => theme.fg("dim", s),
        noMatch: (s: string) => theme.fg("warning", s),
      });
      list.onSelect = (item) => done(item.value);
      list.onCancel = () => done(undefined);
      const index = filtered.findIndex((item) => item.value === selected);
      if (index >= 0) list.setSelectedIndex(index);
    };
    resize();
    return {
      get focused() {
        return search.focused;
      },
      set focused(value: boolean) {
        search.focused = value;
      },
      render(width: number) {
        resize();
        return [
          theme.fg("accent", truncateToWidth(oneLine(title), width)),
          truncateToWidth(oneLine(detail), width),
          ...search.render(width),
          ...list.render(width),
          theme.fg(
            "dim",
            truncateToWidth(
              "Type to filter • ↑↓ choose • Enter select • Esc back/cancel",
              width,
            ),
          ),
        ];
      },
      invalidate() {
        search.invalidate();
        list.invalidate();
      },
      handleInput(data: string) {
        if (
          [Key.up, Key.down, Key.enter, Key.escape].some((key) =>
            matchesKey(data, key),
          )
        )
          list.handleInput(data);
        else {
          const previous = search.getValue();
          search.handleInput(data);
          if (search.getValue() !== previous) resize();
        }
        tui.requestRender();
      },
    };
  });
}

export async function reviewWork(
  ctx: any,
  summary: any,
  signal?: AbortSignal,
  allowBack = false,
  readOnly = false,
): Promise<"approve" | "back" | "cancel"> {
  if (signal?.aborted || !ctx.hasUI) return "cancel";
  const text = workflowReviewLines(summary);
  // RPC supports dialogs, not custom terminal components. Never infer approval from undefined.
  if (ctx.mode !== "tui" && readOnly) return "cancel";
  if (ctx.mode !== "tui")
    return (await ctx.ui.confirm("Authorize Mesh workflow?", text.join("\n"), {
      signal,
    }))
      ? "approve"
      : "cancel";
  return ctx.ui.custom((tui: any, theme: any, _keys: any, done: any) => {
    let offset = 0,
      selected = 0,
      finished = false;
    const buttons = readOnly
      ? ["back"]
      : allowBack
        ? ["back", "cancel", "approve"]
        : ["cancel", "approve"];
    const finish = (value: string) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", abort);
      done(value);
    };
    const abort = () => finish("cancel");
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) queueMicrotask(abort);
    return {
      render(width: number) {
        const height = Math.max(1, (tui.terminal.rows || 24) - 7);
        const lines = text.flatMap((line) =>
          wrapTextWithAnsi(line || " ", Math.max(1, width)),
        );
        offset = Math.min(offset, Math.max(0, lines.length - height));
        return [
          theme.fg(
            "accent",
            truncateToWidth("Mesh • review exact execution scope", width),
          ),
          ...lines.slice(offset, offset + height),
          theme.fg(
            "dim",
            truncateToWidth(
              `Lines ${offset + 1}–${Math.min(lines.length, offset + height)} of ${lines.length} • ↑↓/PgUp/PgDn scroll`,
              width,
            ),
          ),
          truncateToWidth(
            `[ ${buttons[selected] === "approve" ? "APPROVE & START" : buttons[selected].toUpperCase()} ] (${selected + 1}/${buttons.length})`,
            width,
          ),
          theme.fg(
            "warning",
            truncateToWidth(
              "Tab chooses action • Enter confirms chosen action • Esc cancels",
              width,
            ),
          ),
        ];
      },
      invalidate() {},
      dispose() {
        signal?.removeEventListener("abort", abort);
      },
      handleInput(data: string) {
        if (matchesKey(data, Key.escape)) return finish("cancel");
        if (matchesKey(data, Key.enter)) return finish(buttons[selected]);
        if (matchesKey(data, Key.tab) || matchesKey(data, Key.right))
          selected = (selected + 1) % buttons.length;
        else if (
          matchesKey(data, Key.shift("tab")) ||
          matchesKey(data, Key.left)
        )
          selected = (selected + buttons.length - 1) % buttons.length;
        else if (matchesKey(data, Key.down)) offset++;
        else if (matchesKey(data, Key.up)) offset = Math.max(0, offset - 1);
        else if (matchesKey(data, Key.pageDown))
          offset += Math.max(1, (tui.terminal.rows || 24) - 8);
        else if (matchesKey(data, Key.pageUp))
          offset = Math.max(
            0,
            offset - Math.max(1, (tui.terminal.rows || 24) - 8),
          );
        tui.requestRender();
      },
    };
  });
}

// Editing is a private draft. The caller must compile afresh and obtain reviewWork approval.
export async function editTeamRequest(ctx: any, original: any, options: any) {
  if (ctx.mode !== "tui")
    throw new Error(
      "/mesh team requires interactive Pi TUI mode. No work was started.",
    );
  const request = structuredClone(original),
    definition = request.definition;
  if(!Object.hasOwn(definition,'maxTokens'))definition.maxTokens=null;
  const choose = (title: string, values: string[]) =>
    workPicker(
      ctx,
      title,
      values.map((value) => ({ value, label: value })),
    );
  const edit = (title: string, value: any) =>
    ctx.ui.editor(title, String(value ?? ""));
  const limits: Record<string, [string, number]> = {
    maxCost: ["Estimated-cost ceiling ($)", 10],
    maxTokens: ["Token budget", 200000],
    maxCalls: ["Child-spawn budget", 64],
    timeoutMs: ["Child timeout (ms)", 600000],
    concurrency: ["Concurrency", 3],
  };
  for (;;) {
    let error = "";
    try {
      options.validate(definition);
    } catch (e: any) {
      error = e.message;
    }
    const rows: Item[] = [
      {
        value: "review",
        label: options.doneLabel || "Review execution plan →",
        description: error
          ? `BLOCKED: ${error}`
          : "No work starts until the next screen is explicitly approved",
      },
      { value: "cancel", label: "Cancel — do not start" },
    ];
    definition.stages.forEach((stage: any, i: number) =>
      stage.tasks.forEach((task: any, j: number) =>
        rows.push({
          value: `task:${i}:${j}`,
          label: `${i + 1}. ${task.id} · ${task.profile}`,
          description: `${task.model || options.profiles[task.profile]?.model || options.currentModel} · edit role/model/task`,
        }),
      ),
    );
    rows.push(
      { value: "add", label: "Add a worker stage" },
      {
        value: "isolation",
        label: "Workspace",
        description: definition.isolation || "worktree",
      },
      {
        value: "background",
        label: "Execution",
        description: request.background ? "Background" : "Foreground",
      },
      {
        value: "context",
        label: "Context",
        description: definition.context || "fresh",
      },
    );
    if (Object.hasOwn(definition, "untilComplete"))
      rows.push({
        value: "untilComplete",
        label: "Continuation",
        description: definition.untilComplete
          ? "AUTOMATIC — time/spawn checkpoints; chosen token ceiling is a hard stop"
          : "Bounded — stop at limits",
      });
    for (const [key, [label, fallback]] of Object.entries(limits))
      rows.push({
        value: key,
        label,
        description:
          definition[key] === null
            ? (key==='maxTokens'?'AUDIT ONLY — no token ceiling':'UNLIMITED — no total spending ceiling')
            : String(definition[key] ?? fallback),
      });
    const selected = await workPicker(
      ctx,
      options.title || "Mesh • team configuration",
      rows,
      error ||
        (definition.maxCost === null
          ? "WARNING: NO TOTAL SPENDING CEILING. Change cost/continuation before review."
          : "New child workers, not existing peers. Edits are drafts; Esc cancels."),
    );
    if (!selected || selected === "cancel") return undefined;
    if (selected === "review") {
      if (!error)
        try {
          await options.preflight?.(definition);
          return request;
        } catch (e: any) {
          error = e.message;
        }
      ctx.ui.notify(error, "error");
      continue;
    }
    try {
      if (selected === "add") {
        const role = await choose(
          "Profile for the new worker",
          Object.keys(options.profiles),
        );
        if (!role) continue;
        const task = await edit(
          "New worker task — instructions and acceptance expectations",
          "",
        );
        if (!task?.trim()) continue;
        const ids = new Set(
          definition.stages.flatMap((s: any) => s.tasks.map((t: any) => t.id)),
        );
        let n = 1;
        while (ids.has(`extra-${n}`)) n++;
        definition.stages.push({
          tasks: [{ id: `extra-${n}`, profile: role, task }],
        });
      } else if (selected.startsWith("task:")) {
        const [, i, j] = selected.split(":").map(Number),
          task = definition.stages[i].tasks[j],
          stage = definition.stages[i];
        const field = await choose(`Edit ${task.id}`, [
          "Role / tool profile",
          "Exact model",
          "Task instructions",
          "Retries",
          "Move stage earlier",
          "Move stage later",
          "Remove worker",
          "Back",
        ]);
        if (field === "Remove worker") {
          if (
            await ctx.ui.confirm(
              "Remove worker and its acceptance gates?",
              `Remove ${plain(task.id)}? This changes the proposed verification coverage. Nothing has started.`,
            )
          ) {
            stage.tasks.splice(j, 1);
            if (!stage.tasks.length) definition.stages.splice(i, 1);
          }
        } else if (field === "Move stage earlier" && i > 0) {
          [definition.stages[i - 1], definition.stages[i]] = [
            stage,
            definition.stages[i - 1],
          ];
        } else if (
          field === "Move stage later" &&
          i < definition.stages.length - 1
        ) {
          [definition.stages[i + 1], definition.stages[i]] = [
            stage,
            definition.stages[i + 1],
          ];
        } else if (field === "Role / tool profile") {
          const role = await workPicker(
            ctx,
            "Worker profile",
            Object.entries(options.profiles).map(([value, p]: any) => ({
              value,
              label: value,
              description: `${p.write ? "May write" : "Read only"} · ${p.tools.join(", ")}`,
            })),
          );
          if (role) task.profile = role;
        } else if (field === "Exact model") {
          const model = await choose(
            "Exact available model — type to search",
            options.models,
          );
          if (model) task.model = model;
        } else if (field === "Task instructions") {
          const value = await edit(
            `Task for ${task.id} — preserve the completion contract and required output`,
            task.task,
          );
          if (value !== undefined) task.task = value;
        } else if (field === "Retries") {
          const value = await choose("Retries for this stage", ["0", "1", "2"]);
          if (value !== undefined) stage.retries = Number(value);
        }
      } else if (selected === "isolation") {
        const value = await choose(
          "Workspace — shared edits your current files",
          ["worktree", "shared"],
        );
        if (value) definition.isolation = value;
      } else if (selected === "context") {
        const value = await choose("Worker context", ["fresh", "fork"]);
        if (value) definition.context = value;
      } else if (selected === "background") {
        const value = await choose("Execution", ["Background", "Foreground"]);
        if (value) request.background = value === "Background";
      } else if (selected === "untilComplete") {
        const value = await choose("Continuation", ["Bounded", "Automatic"]);
        if (value) {
          definition.untilComplete = value === "Automatic";
          if (!definition.untilComplete && definition.maxCost === null)
            definition.maxCost = 10;
        }
      } else if (limits[selected]) {
        const value = await edit(
          limits[selected][0] +
            (selected==='maxTokens'
              ? ' — number or "unlimited" (audit only)'
              : selected === "maxCost" && definition.untilComplete
              ? ' — number or explicit "unlimited"'
              : ""),
          definition[selected] === null
            ? "unlimited"
            : (definition[selected] ?? limits[selected][1]),
        );
        if (value !== undefined) {
          if (
            (selected==='maxTokens'||selected === "maxCost" && definition.untilComplete) &&
            value.trim() === "unlimited"
          )
            definition[selected] = null;
          else {
            if (!value.trim() || !Number.isFinite(Number(value)))
              throw new Error("Enter a finite number");
            definition[selected] = Number(value);
          }
        }
      }
    } catch (e: any) {
      ctx.ui.notify(e.message, "error");
    }
  }
}
