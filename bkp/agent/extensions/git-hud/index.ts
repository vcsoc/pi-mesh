/**
 * Git Status HUD Extension
 *
 * Renders a one-line Git status in the footer (left side):
 *   ⎇ branch → upstream  ↑ahead ↓behind  ⚡conflicts  ●staged  ○modified  ?untracked  +ins -del  ⧉stash
 *
 * Git info is always leftmost, followed by any other extension setStatus()
 * items, with the model name anchored to the right — matching the built-in
 * footer layout. If the CWD is not a git repo the footer is left unchanged.
 *
 * The HUD refreshes automatically on session start, after every agent turn,
 * and immediately after bash/edit/write tool calls. A configurable polling
 * interval keeps it current even while pi is idle.
 *
 * Commands:
 *   /git-hud                 — toggle the HUD on/off
 *   /git-hud refresh         — force an immediate refresh
 *   /git-hud settings        — show current settings
 *   /git-hud settings <k=v>  — update settings (poll=N churn=bool stash=bool)
 *   /git-hud settings reset  — restore defaults
 *
 * Settings are persisted to ~/.pi/git-hud-settings.json.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile }  from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join }     from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface GitStatus {
  isRepo:      boolean;
  branch:      string;
  upstream:    string | undefined;
  ahead:       number;
  behind:      number;
  staged:      number;
  unstaged:    number;
  untracked:   number;
  conflicts:   number;
  insertions:  number;
  deletions:   number;
  stashCount:  number;
  lastRefresh: number; // epoch ms
  error:       string | undefined;
}

interface HudSettings {
  enabled:         boolean;
  pollIntervalSec: number;
  includeChurn:    boolean;
  includeStash:    boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants & defaults
// ─────────────────────────────────────────────────────────────────────────────

const WIDGET_ID     = "git-hud";
const SETTINGS_FILE = join(homedir(), ".pi", "git-hud-settings.json");

const DEFAULT_SETTINGS: HudSettings = {
  enabled:         true,
  pollIntervalSec: 15,
  includeChurn:    true,
  includeStash:    true,
};

// Tools that mutate the repo and should trigger an immediate refresh
const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);

// ─────────────────────────────────────────────────────────────────────────────
// Settings persistence
// ─────────────────────────────────────────────────────────────────────────────

async function loadSettings(): Promise<HudSettings> {
  try {
    const raw    = await readFile(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<HudSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(s: HudSettings): Promise<void> {
  try {
    await mkdir(join(homedir(), ".pi"), { recursive: true });
    await writeFile(SETTINGS_FILE, JSON.stringify(s, null, 2), "utf8");
  } catch (e) {
    console.warn("[git-hud] Failed to save settings:", e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Git helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Run a git command in `cwd`. Returns trimmed stdout or null on any error. */
async function gitRun(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, timeout: 5000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Returns true if `cwd` is inside a git work-tree. */
async function insideWorkTree(cwd: string): Promise<boolean> {
  return (await gitRun(["rev-parse", "--is-inside-work-tree"], cwd)) === "true";
}

// ─────────────────────────────────────────────────────────────────────────────
// Output parsers
// ─────────────────────────────────────────────────────────────────────────────

/** XY codes that indicate an unresolved merge conflict */
const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/**
 * Parse `git status --porcelain=v1 -b` output.
 *
 * Branch header line format:
 *   ## <branch>...<upstream> [ahead N, behind M]
 *   ## HEAD (no branch)        — detached HEAD
 *   ## <branch>                — local-only branch
 *
 * File status lines use XY codes:
 *   X = staged index state, Y = unstaged working-tree state
 *   ?? = untracked,  !! = ignored
 */
function parseStatusOutput(raw: string): Pick<
  GitStatus,
  "branch" | "upstream" | "ahead" | "behind" | "staged" | "unstaged" | "untracked" | "conflicts"
> {
  let branch   = "HEAD";
  let upstream: string | undefined;
  let ahead    = 0;
  let behind   = 0;
  let staged   = 0;
  let unstaged = 0;
  let untracked = 0;
  let conflicts = 0;

  for (const line of raw.split("\n")) {
    if (line.startsWith("## ")) {
      const rest     = line.slice(3);
      const dotdotAt = rest.indexOf("...");

      if (rest.startsWith("HEAD (no branch)") || rest.startsWith("HEAD (no branch")) {
        branch = "HEAD (detached)";
      } else if (dotdotAt !== -1) {
        branch = rest.slice(0, dotdotAt);
        const afterDots = rest.slice(dotdotAt + 3);
        // Upstream is the part before the first space (strip "[ahead N, behind M]")
        const spaceAt = afterDots.indexOf(" ");
        upstream = spaceAt !== -1 ? afterDots.slice(0, spaceAt) : afterDots;

        const aM = /\bahead (\d+)/.exec(afterDots);
        const bM = /\bbehind (\d+)/.exec(afterDots);
        if (aM) ahead  = parseInt(aM[1]!, 10);
        if (bM) behind = parseInt(bM[1]!, 10);
      } else {
        // Local-only branch — no upstream
        branch = rest.split(" ")[0] ?? rest;
      }
      continue;
    }

    if (line.length < 2) continue;
    const X  = line[0] ?? " ";
    const Y  = line[1] ?? " ";
    const xy = X + Y;

    if (xy === "??") { untracked++; continue; }
    if (xy === "!!") continue; // ignored file

    if (CONFLICT_CODES.has(xy)) { conflicts++; continue; }

    // Staged change: X is not space or '?'
    if (X !== " " && X !== "?") staged++;
    // Unstaged change: Y is not space or '?'
    if (Y !== " " && Y !== "?") unstaged++;
  }

  return { branch, upstream, ahead, behind, staged, unstaged, untracked, conflicts };
}

/**
 * Parse `git diff --shortstat` / `git diff --cached --shortstat` output.
 * Example: " 3 files changed, 45 insertions(+), 12 deletions(-)"
 */
function parseShortstat(raw: string): { insertions: number; deletions: number } {
  const iM = /(\d+) insertion/.exec(raw);
  const dM = /(\d+) deletion/.exec(raw);
  return {
    insertions: iM ? parseInt(iM[1]!, 10) : 0,
    deletions:  dM ? parseInt(dM[1]!, 10) : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Full status fetch
// ─────────────────────────────────────────────────────────────────────────────

async function fetchGitStatus(cwd: string, settings: HudSettings): Promise<GitStatus> {
  const base: GitStatus = {
    isRepo:      false,
    branch:      "",
    upstream:    undefined,
    ahead:       0,
    behind:      0,
    staged:      0,
    unstaged:    0,
    untracked:   0,
    conflicts:   0,
    insertions:  0,
    deletions:   0,
    stashCount:  0,
    lastRefresh: Date.now(),
    error:       undefined,
  };

  try {
    if (!(await insideWorkTree(cwd))) return base; // not a repo — hide widget
    base.isRepo = true;

    // ── Core status (branch + file counts) ──────────────────────────────────
    const statusOut = await gitRun(["status", "--porcelain=v1", "-b"], cwd);
    if (statusOut !== null) {
      Object.assign(base, parseStatusOutput(statusOut));
    }

    // ── Churn (insertions / deletions) — parallel fetch ─────────────────────
    if (settings.includeChurn) {
      const [unstChurn, stgChurn] = await Promise.all([
        gitRun(["diff",           "--shortstat"], cwd),
        gitRun(["diff", "--cached", "--shortstat"], cwd),
      ]);
      let ins = 0, del = 0;
      if (unstChurn) { const c = parseShortstat(unstChurn); ins += c.insertions; del += c.deletions; }
      if (stgChurn)  { const c = parseShortstat(stgChurn);  ins += c.insertions; del += c.deletions; }
      base.insertions = ins;
      base.deletions  = del;
    }

    // ── Stash count ─────────────────────────────────────────────────────────
    if (settings.includeStash) {
      const stashOut = await gitRun(["stash", "list"], cwd);
      if (stashOut) {
        base.stashCount = stashOut.split("\n").filter(Boolean).length;
      }
    }
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
  }

  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

type Theme = ExtensionContext["ui"]["theme"];

/**
 * Build a single-line HUD string from current git status.
 *
 * Returns null when not in a git repo (footer entry hidden).
 * Packs all data onto one compact line:
 *   ⎇ branch → upstream  ↑N ↓M  ⚡C  ●S  ○U  ?T  +I -D  ⧉stash
 */
function renderHudLine(s: GitStatus, settings: HudSettings, theme: Theme): string | null {
  if (!s.isRepo) return null;

  if (s.error) {
    return theme.fg("error", `⊘ git: ${s.error}`);
  }

  const dim     = (t: string) => theme.fg("dim",     t);
  const muted   = (t: string) => theme.fg("muted",   t);
  const accent  = (t: string) => theme.fg("accent",  t);
  const success = (t: string) => theme.fg("success", t);
  const warning = (t: string) => theme.fg("warning", t);
  const error   = (t: string) => theme.fg("error",   t);

  // Branch + upstream
  let line = theme.bold(accent(`⎇  ${s.branch}`));
  if (s.upstream) line += dim(` → ${s.upstream}`);

  // Ahead / behind / in-sync
  if (s.ahead  > 0) line += "  " + warning(`↑${s.ahead}`);
  if (s.behind > 0) line += "  " + warning(`↓${s.behind}`);
  if (s.upstream && s.ahead === 0 && s.behind === 0) line += "  " + success("✓");

  // File counts
  if (s.conflicts > 0) line += "  " + error(`⚡${s.conflicts}`);
  if (s.staged    > 0) line += "  " + success(`●${s.staged}`);
  if (s.unstaged  > 0) line += "  " + warning(`○${s.unstaged}`);
  if (s.untracked > 0) line += "  " + dim(`?${s.untracked}`);

  // Churn (optional)
  if (settings.includeChurn && (s.insertions > 0 || s.deletions > 0)) {
    line += "  ";
    if (s.insertions > 0) line += success(`+${s.insertions}`);
    if (s.insertions > 0 && s.deletions > 0) line += " ";
    if (s.deletions  > 0) line += error(`-${s.deletions}`);
  }

  // Stash count (optional)
  if (settings.includeStash && s.stashCount > 0) {
    line += "  " + muted(`⧉${s.stashCount}`);
  }

  return line;
}

// ─────────────────────────────────────────────────────────────────────────────
// Miscellaneous utils
// ─────────────────────────────────────────────────────────────────────────────

function parseBool(s: string): boolean | undefined {
  if (s === "true"  || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no")  return false;
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension entry point
// ─────────────────────────────────────────────────────────────────────────────

export default async function (pi: ExtensionAPI) {

  // ── Mutable state ──────────────────────────────────────────────────────────

  let settings: HudSettings = await loadSettings();
  let status:   GitStatus | null = null;

  // Most-recently-seen UI context. Updated at the start of every event handler
  // so that the polling timer can render the widget without a live ctx.
  let activeUi:  ExtensionContext["ui"] | null = null;
  let activeCwd: string = process.cwd();

  // Debounce + poll timers
  let debounceTimer: ReturnType<typeof setTimeout>  | null = null;
  let pollTimer:     ReturnType<typeof setInterval> | null = null;

  // Guard against concurrent git invocations
  let isRefreshing = false;

  // ── Core refresh ───────────────────────────────────────────────────────────

  /** Fetch git status and repaint the widget. Non-reentrant. */
  async function doRefresh(): Promise<void> {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      status = await fetchGitStatus(activeCwd, settings);
      renderWidget();
    } finally {
      isRefreshing = false;
    }
  }

  /**
   * Debounced refresh — collapses multiple rapid triggers (e.g. several tool
   * results firing in one turn) into a single git invocation.
   */
  function scheduleRefresh(delayMs = 400): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      doRefresh().catch(console.error);
    }, delayMs);
  }

  // ── Widget painting ────────────────────────────────────────────────────────

  /** Repaint the widget using the current status and theme. */
  function renderWidget(): void {
    if (!activeUi) return;
    if (!settings.enabled || !status || !status.isRepo) {
      activeUi.setWidget(WIDGET_ID, undefined);
      return;
    }
    const line = renderHudLine(status, settings, activeUi.theme);
    activeUi.setWidget(WIDGET_ID, line ? [line] : undefined);
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  function startPolling(): void {
    stopPolling();
    if (settings.pollIntervalSec > 0) {
      pollTimer = setInterval(() => {
        if (activeUi) scheduleRefresh(0);
      }, settings.pollIntervalSec * 1000);
    }
  }

  function stopPolling(): void {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    activeUi  = ctx.ui;
    activeCwd = ctx.cwd;
    startPolling();
    await doRefresh();
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    stopPolling();
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    activeUi?.setWidget(WIDGET_ID, undefined);
    activeUi = null;
  });

  pi.on("turn_end", async (_event, ctx) => {
    activeUi  = ctx.ui;
    activeCwd = ctx.cwd;
    scheduleRefresh(); // debounced — multiple turn_ends won't stack up
  });

  /** Refresh after tools that mutate the working tree. */
  pi.on("tool_result", async (event, ctx) => {
    if (!MUTATING_TOOLS.has(event.toolName)) return;
    activeUi  = ctx.ui;
    activeCwd = ctx.cwd;
    scheduleRefresh(200); // short delay to let the FS settle
  });

  // ── Commands ────────────────────────────────────────────────────────────────

  // /git-hud  |  /git-hud on  |  /git-hud off  |  /git-hud refresh
  // /git-hud settings  |  /git-hud settings <key=value …>  |  /git-hud settings reset
  pi.registerCommand("git-hud", {
    description:
      "Git status HUD · /git-hud [on|off|refresh|settings [key=val…|reset]]",

    getArgumentCompletions: (prefix) => {
      const opts = [
        { value: "on",       label: "on",       description: "Show the Git HUD" },
        { value: "off",      label: "off",       description: "Hide the Git HUD" },
        { value: "refresh",  label: "refresh",  description: "Force an immediate refresh" },
        { value: "settings", label: "settings", description: "Show or update settings" },
      ];
      return opts.filter((o) => o.value.startsWith(prefix)) || null;
    },

    handler: async (args, ctx) => {
      activeUi  = ctx.ui;
      activeCwd = ctx.cwd;

      const [sub = "", ...rest] = (args ?? "").trim().split(/\s+/);

      // ── toggle / on / off ─────────────────────────────────────────────────
      if (sub === "" || sub === "on" || sub === "off") {
        if (sub === "on")       settings.enabled = true;
        else if (sub === "off") settings.enabled = false;
        else                    settings.enabled = !settings.enabled;

        await saveSettings(settings);

        if (settings.enabled) {
          ctx.ui.notify("Git HUD enabled.", "info");
          await doRefresh();
        } else {
          ctx.ui.setWidget(WIDGET_ID, undefined);
          ctx.ui.notify("Git HUD disabled.", "info");
        }
        return;
      }

      // ── refresh ───────────────────────────────────────────────────────────
      if (sub === "refresh") {
        ctx.ui.notify("Git HUD: refreshing…", "info");
        await doRefresh();
        return;
      }

      // ── settings ──────────────────────────────────────────────────────────
      if (sub === "settings") {
        const settingsArg = rest.join(" ").trim();

        // Show current settings
        if (!settingsArg || settingsArg === "show") {
          const onOff = (b: boolean) => b ? "on" : "off";
          ctx.ui.notify(
            `Git HUD settings — enabled:${onOff(settings.enabled)}  poll:${settings.pollIntervalSec}s  churn:${onOff(settings.includeChurn)}  stash:${onOff(settings.includeStash)}`,
            "info",
          );
          return;
        }

        // Reset to defaults
        if (settingsArg === "reset") {
          settings = { ...DEFAULT_SETTINGS };
          await saveSettings(settings);
          startPolling();
          await doRefresh();
          ctx.ui.notify("Git HUD settings reset to defaults.", "info");
          return;
        }

        // Parse key=value tokens
        let changed     = false;
        let restartPoll = false;

        for (const token of settingsArg.split(/\s+/)) {
          const eqAt = token.indexOf("=");
          if (eqAt === -1) {
            ctx.ui.notify(
              `Unknown argument: "${token}".  Usage: /git-hud settings poll=30 churn=true stash=false`,
              "warning",
            );
            continue;
          }
          const key = token.slice(0, eqAt).toLowerCase();
          const val = token.slice(eqAt + 1);

          switch (key) {
            case "poll": {
              const n = parseInt(val, 10);
              if (isNaN(n) || n < 0) {
                ctx.ui.notify(`poll must be a non-negative integer, got: "${val}"`, "warning");
                break;
              }
              settings.pollIntervalSec = n;
              restartPoll = true;
              changed     = true;
              break;
            }
            case "churn": {
              const b = parseBool(val);
              if (b === undefined) { ctx.ui.notify(`churn must be true/false, got: "${val}"`, "warning"); break; }
              settings.includeChurn = b;
              changed = true;
              break;
            }
            case "stash": {
              const b = parseBool(val);
              if (b === undefined) { ctx.ui.notify(`stash must be true/false, got: "${val}"`, "warning"); break; }
              settings.includeStash = b;
              changed = true;
              break;
            }
            default:
              ctx.ui.notify(`Unknown key: "${key}".  Valid keys: poll, churn, stash`, "warning");
          }
        }

        if (changed) {
          await saveSettings(settings);
          if (restartPoll) startPolling();
          await doRefresh();
          ctx.ui.notify(
            `Git HUD settings saved — poll:${settings.pollIntervalSec}s  churn:${settings.includeChurn}  stash:${settings.includeStash}`,
            "info",
          );
        }
        return;
      }

      // ── unknown subcommand ────────────────────────────────────────────────
      ctx.ui.notify(
        `Unknown subcommand: "${sub}".  Try: /git-hud  /git-hud on|off  /git-hud refresh  /git-hud settings`,
        "warning",
      );
    },
  });
}
