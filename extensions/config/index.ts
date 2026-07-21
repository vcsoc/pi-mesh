import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatHtml, formatMarkdown, formatTable, scanConfig, summary } from "./core.mjs";

type Report = Awaited<ReturnType<typeof scanConfig>>;
const VIEW_ROWS = 18;
const pad = (value: string, width: number) => { const text = truncateToWidth(value, width, "…"); return text + " ".repeat(Math.max(0, width - visibleWidth(text))); };

class ConfigTable {
  private offset = 0;
  constructor(private readonly theme: Theme, private readonly report: Report, private readonly keys: any, private readonly redraw: () => void, private readonly done: () => void) {}
  handleInput(data: string) {
    if (this.keys.matches(data, "tui.select.cancel") || this.keys.matches(data, "tui.select.confirm")) return this.done();
    const max = Math.max(0, this.report.rows.length - VIEW_ROWS), before = this.offset;
    if (this.keys.matches(data, "tui.select.up")) this.offset--; else if (this.keys.matches(data, "tui.select.down")) this.offset++; else if (this.keys.matches(data, "tui.select.pageUp")) this.offset -= VIEW_ROWS; else if (this.keys.matches(data, "tui.select.pageDown")) this.offset += VIEW_ROWS; else if (matchesKey(data, Key.home)) this.offset = 0; else if (matchesKey(data, Key.end)) this.offset = max;
    this.offset = Math.max(0, Math.min(max, this.offset)); if (before !== this.offset) this.redraw();
  }
  invalidate() {}
  render(width: number) {
    const available = Math.max(40, width - 2), visible = this.report.rows.slice(this.offset, this.offset + VIEW_ROWS);
    const naturalName = Math.max(18, ...this.report.rows.map((item) => visibleWidth(item.name))), naturalPath = Math.max(18, ...this.report.rows.map((item) => visibleWidth(item.path)));
    let nameWidth = naturalName, pathWidth = naturalPath;
    const fixed = 10 + 8 + 8 + 4;
    if (fixed + nameWidth + pathWidth > available) pathWidth = Math.max(18, available - fixed - nameWidth);
    if (fixed + nameWidth + pathWidth > available) nameWidth = Math.max(18, available - fixed - pathWidth);
    if (fixed + nameWidth + pathWidth > available) { pathWidth = Math.max(10, available - fixed - 18); nameWidth = Math.max(10, available - fixed - pathWidth); }
    const tableWidth = fixed + nameWidth + pathWidth;
    const row = (kind: string, name: string, scope: string, action: string, location: string) => `${pad(kind, 10)} ${pad(name, nameWidth)} ${pad(scope, 8)} ${pad(action, 8)} ${pad(location, pathWidth)}`;
    const s = summary(this.report), lines = [this.theme.fg("accent", this.theme.bold("Pi configuration inventory")), this.theme.fg("muted", `${s.total} instances · ${s.kept} keep · ${s.removed} remove`), this.theme.fg("dim", row("TYPE", "NAME", "SCOPE", "ACTION", "PATH")), this.theme.fg("border", "─".repeat(tableWidth))];
    for (const item of visible) {
      const rendered = row(item.kind, item.name, item.scope, item.action, item.path);
      lines.push(item.action === "keep" ? this.theme.fg("success", rendered) : this.theme.fg("dim", rendered));
    }
    if (!visible.length) lines.push(this.theme.fg("warning", "No extensions or skills found."));
    lines.push("", this.theme.fg("dim", `${this.report.rows.length ? `${this.offset + 1}–${Math.min(this.report.rows.length, this.offset + VIEW_ROWS)} of ${this.report.rows.length} · ` : ""}↑/↓ scroll · Enter/Esc close`));
    return lines.map((line) => truncateToWidth(line, width));
  }
}

function exportReport(ctx: any, report: Report, type: "md" | "html") {
  const dir = path.resolve(ctx.cwd, ".pi-reports", "config"); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `config-${new Date(report.generatedAt).toISOString().replace(/[:.]/g, "-")}.${type}`);
  const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, type === "md" ? formatMarkdown(report) : formatHtml(report), "utf8"); fs.renameSync(temp, file); return file;
}

export default function configExtension(pi: ExtensionAPI) {
  pi.registerCommand("config", {
    description: "Compare project extensions/skills with the Pi harness and report recommended versions.",
    getArgumentCompletions: (prefix) => ["extensions", "skills", "all", "--md", "--html"].filter((x) => x.startsWith(prefix.trim().toLowerCase())).map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const tokens = args.trim().split(/\s+/).filter(Boolean); let exportType: "md" | "html" | null = null;
      if (["--md", "--html"].includes(tokens.at(-1)?.toLowerCase() || "")) exportType = tokens.pop()!.slice(2) as "md" | "html";
      if (tokens.some((x) => x === "--md" || x === "--html") || tokens.some((x) => !["extensions", "skills", "all"].includes(x.toLowerCase()))) { ctx.ui.notify("Usage: /config [extensions|skills|all] [--md|--html]", "error"); return; }
      try {
        const report = await scanConfig(ctx.cwd, getAgentDir());
        if (tokens[0] && tokens[0].toLowerCase() !== "all") report.rows = report.rows.filter((row) => row.kind === tokens[0].toLowerCase().slice(0, -1));
        const output = exportType ? exportReport(ctx, report, exportType) : null;
        if (ctx.mode === "tui") await ctx.ui.custom<void>((tui: any, theme: Theme, keys: any, done: () => void) => new ConfigTable(theme, report, keys, () => tui.requestRender(), done));
        const s = summary(report);
        if (ctx.mode !== "tui") {
          const content = `\`\`\`text\n${formatTable(report)}\n\`\`\`\n\nSummary: ${s.total} instances · ${s.kept} keep · ${s.removed} remove`;
          pi.sendMessage({ customType: "config-report", content, display: true }, { triggerTurn: false });
          if (ctx.mode === "print") console.log(`${formatTable(report)}\n\nSummary: ${s.total} instances · ${s.kept} keep · ${s.removed} remove`);
        } else ctx.ui.notify(`${s.total} config resources scanned.`, "info");
        if (output) ctx.ui.notify(`Exported report to ${output}`, "info");
      } catch (error) { ctx.ui.notify(`Unable to scan configuration: ${error instanceof Error ? error.message : String(error)}`, "error"); }
    }
  });
}
