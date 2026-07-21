import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ExtensionAPI, Theme } from '@earendil-works/pi-coding-agent';
import { Key, matchesKey, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
// @ts-ignore — core.mjs is intentionally plain ESM so Node's test runner can exercise it directly.
import { aggregateUsage, collectUsage, findSessionFiles, formatCost, formatHtml, formatInteger, formatMarkdown, parseUsageArgs, totals } from './core.mjs';

type UsageRow = {
  key: string; available: boolean; requests: number; input: number; output: number;
  cacheRead: number; cacheWrite: number; totalTokens: number; costTotal: number;
};
type UsageReport = { label: string; model: string | null; rows: UsageRow[]; generatedAt: number; fileCount: number; mode: 'usage' | 'models' };

const VIEW_ROWS = 16;
const pad = (value: string, width: number, right = false) => {
  const text = truncateToWidth(value, width, '…');
  const spaces = ' '.repeat(Math.max(0, width - visibleWidth(text)));
  return right ? spaces + text : text + spaces;
};
const reportSlug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'usage';

class UsageTable {
  private offset = 0;
  constructor(
    private readonly theme: Theme,
    private readonly report: UsageReport,
    private readonly keybindings: { matches(data: string, action: string): boolean },
    private readonly requestRender: () => void,
    private readonly done: () => void
  ) {}

  handleInput(data: string) {
    if (this.keybindings.matches(data, 'tui.select.cancel') || this.keybindings.matches(data, 'tui.select.confirm')) return this.done();
    const previous = this.offset, max = Math.max(0, this.report.rows.length - VIEW_ROWS);
    if (this.keybindings.matches(data, 'tui.select.up')) this.offset--;
    else if (this.keybindings.matches(data, 'tui.select.down')) this.offset++;
    else if (this.keybindings.matches(data, 'tui.select.pageUp')) this.offset -= VIEW_ROWS;
    else if (this.keybindings.matches(data, 'tui.select.pageDown')) this.offset += VIEW_ROWS;
    else if (matchesKey(data, Key.home)) this.offset = 0;
    else if (matchesKey(data, Key.end)) this.offset = max;
    this.offset = Math.max(0, Math.min(max, this.offset));
    if (previous !== this.offset) this.requestRender();
  }

  invalidate() {}

  render(width: number) {
    const inner = Math.max(20, width - 4), total = totals(this.report.rows), visible = this.report.rows.slice(this.offset, this.offset + VIEW_ROWS);
    const lines = [
      this.theme.fg('accent', this.theme.bold('Pi token usage by model')),
      this.theme.fg('muted', `${this.report.label}${this.report.model ? ` · @${this.report.model}` : ''} · ${this.report.fileCount} session files`),
      ''
    ];
    if (inner >= 112) {
      const modelWidth = Math.max(24, inner - 82);
      const row = (model: string, requests: string, input: string, output: string, cacheRead: string, cacheWrite: string, tokens: string, cost: string) => `${pad(model, modelWidth)} ${pad(requests, 7, true)} ${pad(input, 10, true)} ${pad(output, 10, true)} ${pad(cacheRead, 11, true)} ${pad(cacheWrite, 11, true)} ${pad(tokens, 12, true)} ${pad(cost, 10, true)}`;
      lines.push(this.theme.fg('dim', row('MODEL', 'CALLS', 'INPUT', 'OUTPUT', 'CACHE READ', 'CACHE WRITE', 'TOKENS', 'COST')), this.theme.fg('border', '─'.repeat(inner)));
      for (const item of visible) lines.push(row(`${item.key}${item.available ? ' ●' : ''}`, formatInteger(item.requests), formatInteger(item.input), formatInteger(item.output), formatInteger(item.cacheRead), formatInteger(item.cacheWrite), formatInteger(item.totalTokens), formatCost(item.costTotal)));
      if (!visible.length) lines.push(this.theme.fg('warning', 'No matching usage records.'));
      lines.push(this.theme.fg('border', '─'.repeat(inner)), this.theme.bold(row('TOTAL', formatInteger(total.requests), formatInteger(total.input), formatInteger(total.output), formatInteger(total.cacheRead), formatInteger(total.cacheWrite), formatInteger(total.totalTokens), formatCost(total.costTotal))));
    } else if (inner >= 68) {
      const modelWidth = Math.max(24, inner - 34);
      const row = (model: string, requests: string, tokens: string, cost: string) => `${pad(model, modelWidth)} ${pad(requests, 7, true)} ${pad(tokens, 13, true)} ${pad(cost, 10, true)}`;
      lines.push(this.theme.fg('dim', row('MODEL', 'CALLS', 'TOKENS', 'COST')), this.theme.fg('border', '─'.repeat(inner)));
      for (const item of visible) lines.push(row(`${item.key}${item.available ? ' ●' : ''}`, formatInteger(item.requests), formatInteger(item.totalTokens), formatCost(item.costTotal)));
      if (!visible.length) lines.push(this.theme.fg('warning', 'No matching usage records.'));
      lines.push(this.theme.fg('border', '─'.repeat(inner)), this.theme.bold(row('TOTAL', formatInteger(total.requests), formatInteger(total.totalTokens), formatCost(total.costTotal))));
    } else {
      for (const item of visible) lines.push(truncateToWidth(`${item.key}${item.available ? ' ●' : ''}`, inner), this.theme.fg('muted', `  ${formatInteger(item.requests)} calls · ${formatInteger(item.totalTokens)} tokens · ${formatCost(item.costTotal)}`));
      if (!visible.length) lines.push(this.theme.fg('warning', 'No matching usage records.'));
      lines.push('', this.theme.bold(`Total: ${formatInteger(total.requests)} calls · ${formatInteger(total.totalTokens)} tokens · ${formatCost(total.costTotal)}`));
    }
    const end = Math.min(this.report.rows.length, this.offset + VIEW_ROWS);
    lines.push('', this.theme.fg('dim', `${this.report.rows.length ? `${this.offset + 1}–${end} of ${this.report.rows.length} · ` : ''}↑/↓ scroll · PgUp/PgDn page · Home/End · Enter/Esc close · ● available`));
    return lines.map((line) => truncateToWidth(line, width));
  }
}

let cached: { at: number; files: string[]; records: any[] } | null = null;
async function usageData(sessionRoot: string) {
  if (cached && Date.now() - cached.at < 5000) return cached;
  const files = await findSessionFiles(sessionRoot), records = await collectUsage(files);
  cached = { at: Date.now(), files, records };
  return cached;
}

function sessionRoot(ctx: any) {
  const current = ctx.sessionManager.getSessionDir?.();
  if (current) return path.dirname(current);
  return path.join(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent'), 'sessions');
}

function exportReport(ctx: any, report: UsageReport, type: 'md' | 'html') {
  const directory = path.resolve(ctx.cwd, '.pi-reports', 'usage');
  fs.mkdirSync(directory, { recursive: true });
  const stamp = new Date(report.generatedAt).toISOString().replace(/[:.]/g, '-');
  const suffix = report.model ? `-${reportSlug(report.model)}` : '';
  const filePath = path.join(directory, `usage-${report.mode}-${stamp}${suffix}.${type}`);
  fs.writeFileSync(filePath, type === 'md' ? formatMarkdown(report) : formatHtml(report), 'utf8');
  return filePath;
}

export default function usageExtension(pi: ExtensionAPI) {
  pi.registerCommand('usage', {
    description: 'Show or export token usage and cost by model.',
    getArgumentCompletions: (prefix) => {
      const value = prefix.trimStart().toLowerCase();
      const options = ['models', 'today', 'week', 'month', '--md', '--html'].map((item) => ({ value: item, label: item }));
      const matches = options.filter((item) => item.value.startsWith(value));
      return matches.length ? matches : null;
    },
    handler: async (args, ctx) => {
      let query;
      try { query = parseUsageArgs(args); }
      catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error'); return; }
      ctx.ui.setStatus('usage', ctx.ui.theme.fg('accent', 'usage:scanning'));
      try {
        const data = await usageData(sessionRoot(ctx));
        const available = ctx.modelRegistry.getAvailable().map((model: any) => ({ provider: model.provider, id: model.id }));
        const rows = aggregateUsage(data.records, query, available);
        const report: UsageReport = { label: query.label, model: query.model, rows, generatedAt: Date.now(), fileCount: data.files.length, mode: query.mode };
        let exported: string | null = null;
        if (query.exportType) exported = exportReport(ctx, report, query.exportType);
        if (ctx.mode === 'tui') {
          await ctx.ui.custom<void>((tui: any, theme: Theme, keybindings: any, done: () => void) => new UsageTable(theme, report, keybindings, () => tui.requestRender(), done));
        } else {
          const total = totals(rows);
          ctx.ui.notify(`${query.label}: ${formatInteger(total.totalTokens)} tokens · ${formatCost(total.costTotal)} across ${rows.length} model${rows.length === 1 ? '' : 's'}.`, 'info');
        }
        if (exported) ctx.ui.notify(`Exported usage report to ${exported}`, 'info');
      } catch (error) {
        ctx.ui.notify(`Unable to build usage report: ${error instanceof Error ? error.message : String(error)}`, 'error');
      } finally {
        ctx.ui.setStatus('usage', undefined);
      }
    }
  });
}
