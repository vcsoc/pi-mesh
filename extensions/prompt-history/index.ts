import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ExtensionAPI, SessionEntry, Theme } from '@earendil-works/pi-coding-agent';

interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate(): void;
}

type HistoryRole = 'user' | 'assistant';

interface HistoryItem {
  id: string;
  role: HistoryRole;
  text: string;
  timestamp: number;
}

interface HistoryState {
  items: HistoryItem[];
  cursor: number | null;
}

const HISTORY_LIMIT = 50;
const HISTORY_VIEW_SIZE = 10;
const HISTORY_STATE_TYPE = 'prompt-history-state';
const HISTORY_FILE_PATH = ['.pi', 'history', 'data.json'];

const trimPreview = (value: string, max = 72) => {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 1).trimEnd()}…` : compact;
};

const pad2 = (value: number) => String(value).padStart(2, '0');
const formatHistoryTimestamp = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${pad2(date.getFullYear() % 100)}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
};

const formatHistoryRole = (role: HistoryRole) => role === 'user' ? 'User' : 'Agent';

const extractText = (content: unknown) => {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      if ('type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string') return part.text;
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
};

const limitHistory = (items: HistoryItem[]) => items.slice(-HISTORY_LIMIT);

const appendHistoryItem = (items: HistoryItem[], role: HistoryRole, text: string, timestamp = Date.now()) => {
  const normalized = text.trim();
  if (!normalized) return limitHistory(items);
  return limitHistory([
    ...items,
    {
      id: `history-${role}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      text: normalized,
      timestamp
    }
  ]);
};

const getHistoryFromEntries = (entries: SessionEntry[]) => {
  const items: HistoryItem[] = [];
  for (const entry of entries) {
    if (entry.type !== 'message') continue;
    if (entry.message.role !== 'user' && entry.message.role !== 'assistant') continue;
    const text = extractText(entry.message.content);
    if (!text) continue;
    items.push({
      id: entry.id,
      role: entry.message.role,
      text,
      timestamp: entry.message.timestamp ?? Date.now()
    });
  }
  return limitHistory(items);
};

const formatTranscript = (items: HistoryItem[]) => {
  if (items.length === 0) return 'No conversation history captured yet.';
  return items
    .map((item, index) => {
      const heading = `${index + 1}. [${item.role}] ${new Date(item.timestamp).toLocaleString()}`;
      const lines = item.text.split(/\r?\n/).map((line) => `   ${line}`);
      return [heading, ...lines].join('\n');
    })
    .join('\n\n');
};

const buildExportPath = (cwd: string, input?: string) => {
  const trimmed = input?.trim();
  if (trimmed) return path.resolve(cwd, trimmed);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.resolve(cwd, '.pi-recovery', `prompt-history-${stamp}.md`);
};

const copyTextToClipboard = (text: string) => {
  const commands = process.platform === 'win32'
    ? [['clip.exe']]
    : process.platform === 'darwin'
      ? [['pbcopy']]
      : [['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input']];

  for (const [command, ...args] of commands) {
    const result = spawnSync(command, args, { input: text, encoding: 'utf8', windowsHide: true });
    if (!result.error && result.status === 0) return true;
  }
  return false;
};

const getHistoryDataPath = (cwd: string) => path.resolve(cwd, ...HISTORY_FILE_PATH);

const loadPersistedState = (cwd: string): HistoryState | null => {
  const filePath = getHistoryDataPath(cwd);
  if (!fs.existsSync(filePath)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<HistoryState>;
    const items = Array.isArray(parsed.items)
      ? parsed.items
          .filter((item): item is HistoryItem => !!item && typeof item === 'object' && (item.role === 'user' || item.role === 'assistant') && typeof item.text === 'string' && typeof item.timestamp === 'number' && typeof item.id === 'string')
          .slice(-HISTORY_LIMIT)
      : [];
    const cursor = typeof parsed.cursor === 'number' && parsed.cursor >= 0 && parsed.cursor < items.length ? parsed.cursor : null;
    return { items, cursor };
  } catch {
    return null;
  }
};

const isRecoverableUserInput = (text: string) => {
  const trimmed = text.trim();
  return trimmed.length > 0 && !trimmed.startsWith('/');
};

const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
const visibleWidth = (value: string) => stripAnsi(value).length;
const truncateToWidth = (value: string, width: number, suffix = '…') => {
  const plain = stripAnsi(value);
  if (plain.length <= width) return value;
  if (width <= suffix.length) return suffix.slice(0, width);
  return plain.slice(0, width - suffix.length) + suffix;
};
const padToWidth = (value: string, width: number) => {
  const remaining = width - visibleWidth(value);
  return remaining > 0 ? value + ' '.repeat(remaining) : value;
};
const matchesKey = (data: string, key: string) => {
  const aliases: Record<string, string[]> = {
    escape: ['\x1b'],
    'ctrl+c': ['\x03'],
    return: ['\r', '\n'],
    'shift+return': ['\x1b[13;2u', '\x1b[27;2;13~', '\x1b[13;2~'],
    up: ['\x1b[A', '\x1bOA'],
    down: ['\x1b[B', '\x1bOB'],
    pageup: ['\x1b[5~'],
    pagedown: ['\x1b[6~'],
    home: ['\x1b[H', '\x1b[1~', '\x1bOH'],
    end: ['\x1b[F', '\x1b[4~', '\x1bOF']
  };
  return aliases[key]?.includes(data) ?? false;
};

type HistoryBrowserResult = { selectedIndex: number; action: 'copy' | 'load' } | null;

class HistoryBrowser implements Component {
  private selected = 0;
  private offset = 0;

  constructor(
    private readonly theme: Theme,
    private readonly items: HistoryItem[],
    private readonly done: (result: HistoryBrowserResult) => void
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) {
      this.done(null);
      return;
    }

    if (matchesKey(data, 'shift+return')) {
      this.done({ selectedIndex: this.selected, action: 'load' });
      return;
    }

    if (matchesKey(data, 'return')) {
      this.done({ selectedIndex: this.selected, action: 'copy' });
      return;
    }

    if (matchesKey(data, 'up')) this.moveSelection(-1);
    else if (matchesKey(data, 'down')) this.moveSelection(1);
    else if (matchesKey(data, 'pageup')) this.moveSelection(-HISTORY_VIEW_SIZE);
    else if (matchesKey(data, 'pagedown')) this.moveSelection(HISTORY_VIEW_SIZE);
    else if (matchesKey(data, 'home')) this.setSelection(0);
    else if (matchesKey(data, 'end')) this.setSelection(this.items.length - 1);
  }

  render(width: number): string[] {
    const innerWidth = Math.max(1, width - 2);
    const visibleItems = this.items.slice(this.offset, this.offset + HISTORY_VIEW_SIZE);
    const lines = [
      this.theme.fg('dim', `Showing ${this.offset + 1}-${this.offset + visibleItems.length} of ${this.items.length}`),
      ''
    ];

    for (let index = 0; index < HISTORY_VIEW_SIZE; index++) {
      const item = visibleItems[index];
      if (!item) {
        lines.push('');
        continue;
      }

      const absoluteIndex = this.offset + index;
      const timestamp = formatHistoryTimestamp(item.timestamp);
      const role = `[${formatHistoryRole(item.role)}]`;
      const prefix = `${timestamp} ${role} `;
      const previewWidth = Math.max(12, innerWidth - visibleWidth(prefix));
      const preview = trimPreview(item.text, previewWidth);
      const line = truncateToWidth(`${prefix}${preview}`, innerWidth);
      lines.push(absoluteIndex === this.selected ? this.theme.fg('accent', line) : line);
    }

    lines.push('', this.theme.fg('dim', '↑/↓ scroll · PgUp/PgDn jump · Enter copy · Shift+Enter load · Esc close'));
    return this.box(lines, width, 'Conversation history');
  }

  invalidate(): void {}

  private moveSelection(delta: number) {
    this.setSelection(this.selected + delta);
  }

  private setSelection(index: number) {
    this.selected = Math.max(0, Math.min(this.items.length - 1, index));
    if (this.selected < this.offset) this.offset = this.selected;
    if (this.selected >= this.offset + HISTORY_VIEW_SIZE) this.offset = this.selected - HISTORY_VIEW_SIZE + 1;
  }

  private box(lines: string[], width: number, title: string) {
    const innerWidth = Math.max(1, width - 2);
    const titleText = ` ${title} `;
    const titleWidth = visibleWidth(titleText);
    const left = '─'.repeat(Math.max(0, Math.floor((innerWidth - titleWidth) / 2)));
    const right = '─'.repeat(Math.max(0, innerWidth - titleWidth - left.length));
    return [
      this.theme.fg('border', `╭${left}`) + this.theme.fg('accent', titleText) + this.theme.fg('border', `${right}╮`),
      ...lines.map((line) => this.theme.fg('border', '│') + padToWidth(truncateToWidth(line, innerWidth), innerWidth) + this.theme.fg('border', '│')),
      this.theme.fg('border', `╰${'─'.repeat(innerWidth)}╯`)
    ];
  }
}

const renderWidget = (theme: any, state: HistoryState) => {
  if (state.items.length === 0) return [theme.fg('dim', 'history: 0/50')];
  const item = state.cursor === null ? state.items[state.items.length - 1] : state.items[state.cursor];
  const preview = trimPreview(item?.text ?? '', 96);
  const color = item?.role === 'user' ? 'userMessageText' : 'text';
  return [theme.fg('dim', `history: ${state.items.length}/${HISTORY_LIMIT}: `) + theme.fg(color, preview)];
};

const persistState = (pi: ExtensionAPI, state: HistoryState, cwd?: string) => {
  pi.appendEntry(HISTORY_STATE_TYPE, state);

  if (!cwd) return;
  const filePath = getHistoryDataPath(cwd);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ items: state.items, cursor: state.cursor }, null, 2) + '\n', 'utf8');
};

const updateWidget = (ctx: any, state: HistoryState) => {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(
    'prompt-history',
    (_tui: any, theme: any) => ({
      render: (_width: number) => renderWidget(theme, state),
      invalidate: () => {}
    }),
    { placement: 'belowEditor' }
  );
};

const loadCursorIntoEditor = (ctx: any, state: HistoryState) => {
  if (state.cursor === null || !state.items[state.cursor]) {
    ctx.ui.setEditorText('');
    ctx.ui.notify('Cleared history selection.', 'info');
    return;
  }
  const item = state.items[state.cursor]!;
  ctx.ui.setEditorText(item.text);
  ctx.ui.notify(`Loaded saved ${item.role} entry ${state.items.length - state.cursor}/${state.items.length} into the editor.`, 'info');
};

const cycleHistory = (ctx: any, state: HistoryState, direction: 'older' | 'newer') => {
  if (state.items.length === 0) {
    ctx.ui.notify('No conversation history captured yet.', 'warning');
    return;
  }

  if (direction === 'older') {
    state.cursor = state.cursor === null
      ? state.items.length - 1
      : state.cursor === 0
        ? null
        : state.cursor - 1;
  } else {
    state.cursor = state.cursor === null
      ? 0
      : state.cursor >= state.items.length - 1
        ? null
        : state.cursor + 1;
  }

  loadCursorIntoEditor(ctx, state);
};

export default function promptHistoryExtension(pi: ExtensionAPI) {
  const state: HistoryState = { items: [], cursor: null };

  pi.on('session_start', (_event, ctx) => {
    const saved = ctx.sessionManager
      .getEntries()
      .filter((entry: { type: string; customType?: string }) => entry.type === 'custom' && entry.customType === HISTORY_STATE_TYPE)
      .pop() as { data?: HistoryState } | undefined;

    const fileState = loadPersistedState(ctx.cwd);
    state.items = fileState?.items?.length
      ? fileState.items.slice(-HISTORY_LIMIT)
      : saved?.data?.items?.length
        ? saved.data.items.slice(-HISTORY_LIMIT)
        : getHistoryFromEntries(ctx.sessionManager.getEntries());
    state.cursor = null;
    persistState(pi, state, ctx.cwd);
    updateWidget(ctx, state);
  });

  pi.on('input', (event, ctx) => {
    if (event.source === 'extension' || !isRecoverableUserInput(event.text)) return { action: 'continue' as const };
    state.items = appendHistoryItem(state.items, 'user', event.text);
    state.cursor = null;
    persistState(pi, state, ctx.cwd);
    updateWidget(ctx, state);
    return { action: 'continue' as const };
  });

  pi.on('message_end', (event, ctx) => {
    if (event.message.role !== 'assistant') return;
    const text = extractText(event.message.content);
    if (!text) return;
    state.items = appendHistoryItem(state.items, 'assistant', text, event.message.timestamp ?? Date.now());
    state.cursor = null;
    persistState(pi, state, ctx.cwd);
    updateWidget(ctx, state);
  });

  pi.registerCommand('history', {
    description: 'Browse, cycle, show, or export the last 50 user/assistant messages.',
    handler: async (args, ctx) => {
      const raw = args.trim();
      const arg = raw.toLowerCase();

      if (state.items.length === 0) {
        ctx.ui.notify('No conversation history captured yet.', 'warning');
        return;
      }

      if (arg === 'prev' || arg === 'older') {
        cycleHistory(ctx, state, 'older');
        persistState(pi, state, ctx.cwd);
        updateWidget(ctx, state);
        return;
      }

      if (arg === 'next' || arg === 'newer') {
        cycleHistory(ctx, state, 'newer');
        persistState(pi, state, ctx.cwd);
        updateWidget(ctx, state);
        return;
      }

      if (arg === 'all' || arg === 'show') {
        ctx.ui.setEditorText(formatTranscript(state.items));
        ctx.ui.notify('Loaded the full conversation history transcript into the editor.', 'info');
        return;
      }

      if (arg === 'export' || arg.startsWith('export ')) {
        const filePath = buildExportPath(ctx.cwd, raw.startsWith('export ') ? raw.slice('export '.length) : undefined);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, formatTranscript(state.items), 'utf8');
        ctx.ui.notify(`Exported conversation history to ${filePath}`, 'info');
        ctx.ui.setEditorText(filePath);
        return;
      }

      const items = [...state.items].reverse();
      const selection = ctx.mode === 'tui'
        ? await (async () => {
            const overlayHeight = HISTORY_VIEW_SIZE + 6;
            const fallbackRows = Number(process.stdout.rows ?? 40);
            const overlayOptions: any = {
              anchor: 'top-center',
              width: '100%',
              maxHeight: overlayHeight,
              row: Math.max(0, Math.floor(fallbackRows * 0.65) - overlayHeight - 1),
              margin: { left: 2, right: 2 }
            };

            return ctx.ui.custom(
              (tui: any, theme: Theme, _keybindings: any, done: (result: HistoryBrowserResult) => void) => {
                const terminalRows = Number(tui?.terminal?.rows ?? process.stdout.rows ?? 40);
                const typedAreaRow = Number(tui?.cursorRow ?? tui?.maxLinesRendered ?? Math.floor(terminalRows * 0.65));
                overlayOptions.row = Math.max(0, Math.min(typedAreaRow - overlayHeight - 1, terminalRows - overlayHeight));
                return new HistoryBrowser(theme, items, done);
              },
              { overlay: true, overlayOptions }
            );
          })()
        : await (async () => {
            const choices = items.slice(0, HISTORY_VIEW_SIZE).map((item) => `${formatHistoryTimestamp(item.timestamp)} [${formatHistoryRole(item.role)}] ${trimPreview(item.text)}`);
            const selected = await ctx.ui.select('Conversation history', choices);
            const selectedIndex = selected ? choices.findIndex((item) => item === selected) : -1;
            return selectedIndex >= 0 ? { selectedIndex, action: 'copy' as const } : null;
          })();
      if (!selection || selection.selectedIndex < 0) return;

      const selectedItem = items[selection.selectedIndex];
      if (!selectedItem) return;

      state.cursor = state.items.length - 1 - selection.selectedIndex;
      if (selection.action === 'load') {
        loadCursorIntoEditor(ctx, state);
      } else {
        const copied = copyTextToClipboard(selectedItem.text);
        ctx.ui.notify(
          copied
            ? `Copied saved ${selectedItem.role} history entry to clipboard.`
            : 'Unable to copy history entry to clipboard: no clipboard command available.',
          copied ? 'info' : 'warning'
        );
      }
      persistState(pi, state, ctx.cwd);
      updateWidget(ctx, state);
    }
  });

  pi.registerShortcut('alt+shift+up', {
    description: 'Load an older saved history entry into the editor',
    handler: async (ctx) => {
      cycleHistory(ctx, state, 'older');
      persistState(pi, state, ctx.cwd);
      updateWidget(ctx, state);
    }
  });

  pi.registerShortcut('alt+shift+down', {
    description: 'Load a newer saved history entry into the editor',
    handler: async (ctx) => {
      cycleHistory(ctx, state, 'newer');
      persistState(pi, state, ctx.cwd);
      updateWidget(ctx, state);
    }
  });
}
