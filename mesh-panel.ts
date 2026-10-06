import {
  matchesKey,
  Key,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { plain } from "./work-review.mjs";
export type MeshRow = {
  id: string;
  label: string;
  value: string;
  detail?: string;
};
export type MeshChoice = {
  action: "change" | "cancel" | "accept";
  row: string;
};
const line = (value: unknown) => plain(value).replace(/[\r\n\t]/g, " ");

// Same compact rounded-box visual language as prompt-history; no second renderer.
export async function meshPanel(
  ctx: any,
  title: string,
  rows: MeshRow[],
  options: {
    notice?: string;
    hint?: string;
    signal?: AbortSignal;
    selected?: string;
    acceptLabel?: string;
  } = {},
): Promise<MeshChoice> {
  if (ctx.mode !== "tui")
    throw new Error("Mesh requires interactive Pi TUI mode");
  if (options.signal?.aborted) return { action: "cancel", row: "" };
  return ctx.ui.custom((tui: any, theme: any, _keys: any, done: any) => {
    let selected = Math.max(
        0,
        rows.findIndex((row) => row.id === options.selected),
      ),
      offset = 0,
      action = 0,
      closed = false;
    const actions = ["change", "cancel", "accept"] as const;
    const finish = (chosen: (typeof actions)[number]) => {
      if (closed) return;
      closed = true;
      options.signal?.removeEventListener("abort", abort);
      done({ action: chosen, row: rows[selected]?.id || "" });
    };
    const abort = () => finish("cancel");
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) queueMicrotask(abort);
    return {
      render(width: number) {
        const inner = Math.max(1, width - 2),
          height = Math.max(1, (tui.terminal.rows || 24) - 12),
          count = Math.min(rows.length, height, 8);
        if (selected < offset) offset = selected;
        if (selected >= offset + count)
          offset = Math.max(0, selected - count + 1);
        const content = [
          theme.fg(
            "muted",
            truncateToWidth(
              line(
                options.notice || "Nothing starts while you change settings.",
              ),
              inner,
            ),
          ),
          "",
        ];
        for (let i = offset; i < Math.min(rows.length, offset + count); i++) {
          const row = rows[i],
            text = truncateToWidth(
              `${i === selected ? "›" : " "} ${row.label.padEnd(Math.min(12, Math.floor(inner / 3)))} ${line(row.value)}`,
              inner,
            );
          content.push(i === selected ? theme.fg("accent", text) : text);
        }
        if (rows.length > count)
          content.push(
            theme.fg(
              "dim",
              `Rows ${offset + 1}–${Math.min(rows.length, offset + count)} of ${rows.length}`,
            ),
          );
        const detail = wrapTextWithAnsi(
          plain(
            rows[selected]?.detail || "Enter changes the highlighted option.",
          ),
          inner,
        );
        content.push(
          "",
          ...detail.slice(0, 2).map((text) => theme.fg("muted", text)),
          "",
        );
        const names = ["Change", "Cancel", options.acceptLabel || "Accept"];
        const footer = names
          .map((name, i) => (i === action ? `[ ${name} ]` : `  ${name}  `))
          .join(" ");
        content.push(
          theme.fg(
            "accent",
            visibleWidth(footer) <= inner
              ? footer
              : `[ ${names[action]} ] (${action + 1}/3)`,
          ),
        );
        content.push(
          theme.fg(
            "dim",
            truncateToWidth(
              line(
                options.hint ||
                  "↑↓ option · Enter change · Tab action · Esc cancel",
              ),
              inner,
            ),
          ),
        );
        const heading = truncateToWidth(` ${line(title)} `, inner),
          pad = Math.max(0, inner - visibleWidth(heading));
        const top =
          theme.fg("border", "╭" + "─".repeat(Math.floor(pad / 2))) +
          theme.fg("accent", heading) +
          theme.fg("border", "─".repeat(pad - Math.floor(pad / 2)) + "╮");
        return [
          top,
          ...content.map(
            (value) =>
              theme.fg("border", "│") +
              truncateToWidth(value, inner) +
              " ".repeat(
                Math.max(
                  0,
                  inner - visibleWidth(truncateToWidth(value, inner)),
                ),
              ) +
              theme.fg("border", "│"),
          ),
          theme.fg("border", "╰" + "─".repeat(inner) + "╯"),
        ].map((value) => truncateToWidth(value, width));
      },
      invalidate() {},
      dispose() {
        options.signal?.removeEventListener("abort", abort);
      },
      handleInput(data: string) {
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")))
          return finish("cancel");
        if (matchesKey(data, Key.enter)) return finish(actions[action]);
        if (matchesKey(data, Key.tab) || matchesKey(data, Key.right))
          action = (action + 1) % 3;
        else if (
          matchesKey(data, Key.shift("tab")) ||
          matchesKey(data, Key.left)
        )
          action = (action + 2) % 3;
        else if (matchesKey(data, Key.down)) {
          selected = Math.min(rows.length - 1, selected + 1);
          action = 0;
        } else if (matchesKey(data, Key.up)) {
          selected = Math.max(0, selected - 1);
          action = 0;
        } else if (matchesKey(data, Key.pageDown)) {
          selected = Math.min(rows.length - 1, selected + 5);
          action = 0;
        } else if (matchesKey(data, Key.pageUp)) {
          selected = Math.max(0, selected - 5);
          action = 0;
        }
        tui.requestRender();
      },
    };
  });
}
