import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

type HudSettings = {
	enabled: boolean;
	pollIntervalMs: number;
	includeChurn: boolean;
	includeStash: boolean;
};

type PersistedState = {
	version: 1;
	settings: HudSettings;
};

type GitRepoSnapshot = {
	kind: "repo";
	branch: string;
	upstream?: string;
	ahead: number;
	behind: number;
	staged: number;
	unstaged: number;
	untracked: number;
	conflicts: number;
	changedFiles: number;
	insertions?: number;
	deletions?: number;
	stashCount?: number;
	repoRoot: string;
};

type GitNonRepoSnapshot = {
	kind: "not-git";
	message: string;
};

type GitErrorSnapshot = {
	kind: "error";
	message: string;
};

type GitSnapshot = GitRepoSnapshot | GitNonRepoSnapshot | GitErrorSnapshot;

type RuntimeState = {
	settings: HudSettings;
	lastSnapshot?: GitSnapshot;
	lastRefreshAt?: number;
	lastSuccessAt?: number;
	lastError?: string;
	lastReason?: string;
	isRefreshing: boolean;
	refreshQueued: boolean;
	refreshTimer?: ReturnType<typeof setTimeout>;
	pollTimer?: ReturnType<typeof setInterval>;
	activeCtx?: ExtensionContext;
	shutdown: boolean;
};

const ENTRY_TYPE = "git-hud-config";
const WIDGET_ID = "git-hud";
const DEFAULT_SETTINGS: HudSettings = {
	enabled: true,
	pollIntervalMs: 15_000,
	includeChurn: true,
	includeStash: true,
};
const REFRESH_DEBOUNCE_MS = 250;
const GIT_TIMEOUT_MS = 4_000;
const REFRESH_TOOLS = new Set(["bash", "edit", "write"]);

function cloneSettings(settings: HudSettings): HudSettings {
	return { ...settings };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function coerceBoolean(value: string): boolean | undefined {
	switch (value.trim().toLowerCase()) {
		case "1":
		case "on":
		case "true":
		case "yes":
		case "y":
			return true;
		case "0":
		case "off":
		case "false":
		case "no":
		case "n":
			return false;
		default:
			return undefined;
	}
}

function parseDurationMs(raw: string): number | undefined {
	const value = raw.trim().toLowerCase();
	const match = value.match(/^(\d+)(ms|s|m)?$/);
	if (!match) return undefined;

	const amount = Number(match[1]);
	const unit = match[2] ?? "s";
	if (!Number.isFinite(amount) || amount < 0) return undefined;

	switch (unit) {
		case "ms":
			return amount;
		case "s":
			return amount * 1_000;
		case "m":
			return amount * 60_000;
		default:
			return undefined;
	}
}

function formatDurationMs(ms: number): string {
	if (ms % 60_000 === 0) return `${ms / 60_000}m`;
	if (ms % 1_000 === 0) return `${ms / 1_000}s`;
	return `${ms}ms`;
}

function formatAge(timestamp: number | undefined, now = Date.now()): string {
	if (!timestamp) return "never";
	const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ago`;
}

function parseShortStat(output: string): { insertions: number; deletions: number } {
	const insertions = Number(output.match(/(\d+)\s+insertions?\(\+\)/)?.[1] ?? 0);
	const deletions = Number(output.match(/(\d+)\s+deletions?\(-\)/)?.[1] ?? 0);
	return { insertions, deletions };
}

function parsePorcelainV2(stdout: string, repoRoot: string): GitRepoSnapshot {
	let branch = "HEAD";
	let upstream: string | undefined;
	let ahead = 0;
	let behind = 0;
	let staged = 0;
	let unstaged = 0;
	let untracked = 0;
	let conflicts = 0;
	let changedFiles = 0;
	let branchOid = "";

	for (const line of stdout.split(/\r?\n/)) {
		if (!line) continue;

		if (line.startsWith("# branch.oid ")) {
			branchOid = line.slice("# branch.oid ".length).trim();
			continue;
		}
		if (line.startsWith("# branch.head ")) {
			branch = line.slice("# branch.head ".length).trim();
			continue;
		}
		if (line.startsWith("# branch.upstream ")) {
			upstream = line.slice("# branch.upstream ".length).trim();
			continue;
		}
		if (line.startsWith("# branch.ab ")) {
			const match = line.match(/\+(\d+)\s+-(\d+)/);
			ahead = Number(match?.[1] ?? 0);
			behind = Number(match?.[2] ?? 0);
			continue;
		}
		if (line.startsWith("1 ") || line.startsWith("2 ")) {
			const x = line[2] ?? ".";
			const y = line[3] ?? ".";
			changedFiles++;
			if (x !== ".") staged++;
			if (y !== ".") unstaged++;
			continue;
		}
		if (line.startsWith("u ")) {
			changedFiles++;
			conflicts++;
			continue;
		}
		if (line.startsWith("? ")) {
			changedFiles++;
			untracked++;
		}
	}

	if (branch === "(detached)") {
		branch = branchOid ? `detached ${branchOid.slice(0, 8)}` : "detached";
	}

	return {
		kind: "repo",
		branch,
		upstream,
		ahead,
		behind,
		staged,
		unstaged,
		untracked,
		conflicts,
		changedFiles,
		repoRoot,
	};
}

function isNotGitRepoMessage(text: string): boolean {
	return /not a git repository/i.test(text);
}

async function queryGitSnapshot(pi: ExtensionAPI, cwd: string, settings: HudSettings): Promise<GitSnapshot> {
	try {
		const rootResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			timeout: GIT_TIMEOUT_MS,
		});

		if (rootResult.code !== 0) {
			const details = `${rootResult.stderr ?? ""}\n${rootResult.stdout ?? ""}`.trim();
			if (isNotGitRepoMessage(details)) {
				return { kind: "not-git", message: "current directory is not a Git repository" };
			}
			return { kind: "error", message: details || "git rev-parse failed" };
		}

		const repoRoot = rootResult.stdout.trim() || cwd;
		const statusPromise = pi.exec("git", ["status", "--porcelain=v2", "--branch"], {
			cwd,
			timeout: GIT_TIMEOUT_MS,
		});
		const stashPromise = settings.includeStash
			? pi.exec("git", ["stash", "list", "--format=%gd"], { cwd, timeout: GIT_TIMEOUT_MS })
			: Promise.resolve(undefined);
		const stagedChurnPromise = settings.includeChurn
			? pi.exec("git", ["diff", "--shortstat", "--cached", "--"], { cwd, timeout: GIT_TIMEOUT_MS })
			: Promise.resolve(undefined);
		const unstagedChurnPromise = settings.includeChurn
			? pi.exec("git", ["diff", "--shortstat", "--"], { cwd, timeout: GIT_TIMEOUT_MS })
			: Promise.resolve(undefined);

		const [statusResult, stashResult, stagedChurnResult, unstagedChurnResult] = await Promise.all([
			statusPromise,
			stashPromise,
			stagedChurnPromise,
			unstagedChurnPromise,
		]);

		if (statusResult.code !== 0) {
			const message = statusResult.stderr.trim() || "git status failed";
			return { kind: "error", message };
		}

		const snapshot = parsePorcelainV2(statusResult.stdout, repoRoot);

		if (settings.includeStash) {
			const stashOutput = stashResult?.stdout.trim() ?? "";
			snapshot.stashCount = stashOutput ? stashOutput.split(/\r?\n/).filter(Boolean).length : 0;
		}

		if (settings.includeChurn) {
			const staged = parseShortStat(stagedChurnResult?.stdout ?? "");
			const unstaged = parseShortStat(unstagedChurnResult?.stdout ?? "");
			snapshot.insertions = staged.insertions + unstaged.insertions;
			snapshot.deletions = staged.deletions + unstaged.deletions;
		}

		return snapshot;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { kind: "error", message };
	}
}

function summarizeSettings(settings: HudSettings): string {
	return [
		settings.enabled ? "enabled" : "hidden",
		`interval=${formatDurationMs(settings.pollIntervalMs)}`,
		`churn=${settings.includeChurn ? "on" : "off"}`,
		`stash=${settings.includeStash ? "on" : "off"}`,
	].join(" | ");
}

function buildWidgetLines(theme: Theme, state: RuntimeState, width: number): string[] {
	const snapshot = state.lastSnapshot;
	const now = Date.now();
	const parts: string[] = [];
	const sep = theme.fg("dim", "  ");

	if (!snapshot) {
		return [truncateToWidth(theme.fg("accent", theme.bold("⎇")) + sep + theme.fg("muted", "refreshing…"), width)];
	}

	if (snapshot.kind === "not-git") {
		const line = [
			theme.fg("accent", theme.bold("⎇")),
			theme.fg("muted", snapshot.message),
			state.lastRefreshAt ? theme.fg("dim", formatAge(state.lastRefreshAt, now)) : undefined,
		]
			.filter(Boolean)
			.join(sep);
		return [truncateToWidth(line, width)];
	}

	if (snapshot.kind === "error") {
		const line = [
			theme.fg("accent", theme.bold("⎇")),
			theme.fg("error", "refresh failed"),
			theme.fg("dim", snapshot.message),
		].join(sep);
		return [truncateToWidth(line, width)];
	}

	parts.push(theme.fg("accent", theme.bold("⎇")) + theme.fg("toolTitle", ` ${theme.bold(snapshot.branch)}`));

	if (snapshot.ahead > 0) parts.push(theme.fg("success", `↑${snapshot.ahead}`));
	if (snapshot.behind > 0) parts.push(theme.fg("warning", `↓${snapshot.behind}`));
	if (snapshot.ahead === 0 && snapshot.behind === 0 && snapshot.upstream) {
		parts.push(theme.fg("success", "✓"));
	}

	if (snapshot.conflicts > 0) parts.push(theme.fg("error", `⚡${snapshot.conflicts}`));
	if (snapshot.staged > 0) parts.push(theme.fg("success", `●${snapshot.staged}`));
	if (snapshot.unstaged > 0) parts.push(theme.fg("warning", `○${snapshot.unstaged}`));
	if (snapshot.untracked > 0) parts.push(theme.fg("accent", `?${snapshot.untracked}`));
	if (snapshot.changedFiles === 0) parts.push(theme.fg("dim", "clean"));

	if (state.settings.includeChurn) {
		const insertions = snapshot.insertions ?? 0;
		const deletions = snapshot.deletions ?? 0;
		if (insertions > 0) parts.push(theme.fg("success", `+${insertions}`));
		if (deletions > 0) parts.push(theme.fg("error", `-${deletions}`));
	}

	if (state.settings.includeStash && (snapshot.stashCount ?? 0) > 0) {
		parts.push(theme.fg("muted", `⧉${snapshot.stashCount ?? 0}`));
	}

	parts.push(state.isRefreshing ? theme.fg("warning", "…") : theme.fg("dim", formatAge(state.lastSuccessAt ?? state.lastRefreshAt, now)));

	const staleMs = state.lastSuccessAt ? now - state.lastSuccessAt : undefined;
	if (state.lastError) {
		parts.push(theme.fg("warning", `warn:${state.lastError}`));
	} else if (staleMs !== undefined && staleMs > state.settings.pollIntervalMs * 2.5) {
		parts.push(theme.fg("warning", `stale:${formatAge(state.lastSuccessAt, now)}`));
	}

	return [truncateToWidth(parts.join(sep), width)];
}

function renderWidget(ctx: ExtensionContext, state: RuntimeState): void {
	if (!ctx.hasUI || !state.settings.enabled) {
		ctx.ui.setWidget(WIDGET_ID, undefined);
		return;
	}

	ctx.ui.setWidget(WIDGET_ID, (_tui, theme) => ({
		render(width: number): string[] {
			return buildWidgetLines(theme, state, width);
		},
		invalidate(): void {},
	}));
}

function clearTimers(state: RuntimeState): void {
	if (state.refreshTimer) {
		clearTimeout(state.refreshTimer);
		state.refreshTimer = undefined;
	}
	if (state.pollTimer) {
		clearInterval(state.pollTimer);
		state.pollTimer = undefined;
	}
}

function persistState(pi: ExtensionAPI, state: RuntimeState): void {
	const payload: PersistedState = {
		version: 1,
		settings: cloneSettings(state.settings),
	};
	pi.appendEntry(ENTRY_TYPE, payload);
}

function restoreState(ctx: ExtensionContext): HudSettings {
	let restored = cloneSettings(DEFAULT_SETTINGS);
	for (const entry of ctx.sessionManager.getBranch()) {
		const customEntry = entry as { type?: string; customType?: string; data?: unknown };
		if (customEntry.type !== "custom" || customEntry.customType !== ENTRY_TYPE || !isRecord(customEntry.data)) {
			continue;
		}
		const settings = customEntry.data.settings;
		if (!isRecord(settings)) continue;

		restored = {
			enabled: typeof settings.enabled === "boolean" ? settings.enabled : restored.enabled,
			pollIntervalMs:
				typeof settings.pollIntervalMs === "number" && Number.isFinite(settings.pollIntervalMs)
					? settings.pollIntervalMs
					: restored.pollIntervalMs,
			includeChurn:
				typeof settings.includeChurn === "boolean" ? settings.includeChurn : restored.includeChurn,
			includeStash:
				typeof settings.includeStash === "boolean" ? settings.includeStash : restored.includeStash,
		};
	}
	return restored;
}

function applyPollTimer(pi: ExtensionAPI, state: RuntimeState): void {
	if (state.pollTimer) {
		clearInterval(state.pollTimer);
		state.pollTimer = undefined;
	}
	if (!state.settings.enabled || state.settings.pollIntervalMs <= 0 || state.shutdown) return;

	state.pollTimer = setInterval(() => {
		const ctx = state.activeCtx;
		if (!ctx) return;
		scheduleRefresh(pi, state, ctx, "poll", 0);
	}, state.settings.pollIntervalMs);
}

function scheduleRefresh(
	pi: ExtensionAPI,
	state: RuntimeState,
	ctx: ExtensionContext,
	reason: string,
	delayMs = REFRESH_DEBOUNCE_MS,
): void {
	state.activeCtx = ctx;
	if (state.shutdown) return;
	if (!state.settings.enabled && reason !== "manual") {
		renderWidget(ctx, state);
		return;
	}
	if (state.refreshTimer) {
		clearTimeout(state.refreshTimer);
	}
	state.refreshTimer = setTimeout(() => {
		state.refreshTimer = undefined;
		void runRefresh(pi, state, ctx, reason);
	}, delayMs);
}

async function runRefresh(pi: ExtensionAPI, state: RuntimeState, ctx: ExtensionContext, reason: string): Promise<void> {
	state.activeCtx = ctx;
	if (state.shutdown) return;
	if (state.isRefreshing) {
		state.refreshQueued = true;
		return;
	}

	state.isRefreshing = true;
	state.lastReason = reason;
	renderWidget(ctx, state);

	try {
		const snapshot = await queryGitSnapshot(pi, ctx.cwd, state.settings);
		state.lastSnapshot = snapshot;
		state.lastRefreshAt = Date.now();
		if (snapshot.kind === "repo" || snapshot.kind === "not-git") {
			state.lastSuccessAt = state.lastRefreshAt;
			state.lastError = undefined;
		} else {
			state.lastError = snapshot.message;
		}
	} finally {
		state.isRefreshing = false;
		renderWidget(ctx, state);

		if (state.refreshQueued) {
			state.refreshQueued = false;
			scheduleRefresh(pi, state, ctx, "queued", 100);
		}
	}
}

function parseSettingsArgs(args: string, current: HudSettings): { next?: HudSettings; errors: string[]; changed: boolean } {
	const next = cloneSettings(current);
	const errors: string[] = [];
	let changed = false;

	for (const token of args.split(/\s+/).filter(Boolean)) {
		const [rawKey, ...valueParts] = token.split("=");
		const key = rawKey.trim().toLowerCase();
		const rawValue = valueParts.join("=").trim();
		if (!key || !rawValue) {
			errors.push(`expected key=value, got '${token}'`);
			continue;
		}

		switch (key) {
			case "interval":
			case "poll":
			case "polling": {
				const ms = parseDurationMs(rawValue);
				if (ms === undefined || ms < 1_000) {
					errors.push("interval must be >= 1s (examples: interval=15s, interval=30000ms, interval=1m)");
					break;
				}
				if (next.pollIntervalMs !== ms) {
					next.pollIntervalMs = ms;
					changed = true;
				}
				break;
			}
			case "churn": {
				const value = coerceBoolean(rawValue);
				if (value === undefined) {
					errors.push("churn must be on/off");
					break;
				}
				if (next.includeChurn !== value) {
					next.includeChurn = value;
					changed = true;
				}
				break;
			}
			case "stash": {
				const value = coerceBoolean(rawValue);
				if (value === undefined) {
					errors.push("stash must be on/off");
					break;
				}
				if (next.includeStash !== value) {
					next.includeStash = value;
					changed = true;
				}
				break;
			}
			case "enabled":
			case "show": {
				const value = coerceBoolean(rawValue);
				if (value === undefined) {
					errors.push("enabled must be on/off");
					break;
				}
				if (next.enabled !== value) {
					next.enabled = value;
					changed = true;
				}
				break;
			}
			default:
				errors.push(`unknown setting '${key}'`);
		}
	}

	return { next: errors.length === 0 ? next : undefined, errors, changed };
}

export default function gitHudExtension(pi: ExtensionAPI): void {
	const state: RuntimeState = {
		settings: cloneSettings(DEFAULT_SETTINGS),
		isRefreshing: false,
		refreshQueued: false,
		shutdown: false,
	};

	pi.registerCommand("git-hud", {
		description: "Toggle the Git status HUD widget",
		handler: async (_args, ctx) => {
			state.activeCtx = ctx;
			state.settings.enabled = !state.settings.enabled;
			persistState(pi, state);
			applyPollTimer(pi, state);
			renderWidget(ctx, state);
			if (state.settings.enabled) {
				ctx.ui.notify(`Git HUD enabled (${summarizeSettings(state.settings)})`, "info");
				scheduleRefresh(pi, state, ctx, "manual", 0);
			} else {
				ctx.ui.notify("Git HUD hidden", "info");
			}
		},
	});

	pi.registerCommand("git-hud-refresh", {
		description: "Force a Git HUD refresh",
		handler: async (_args, ctx) => {
			state.activeCtx = ctx;
			ctx.ui.notify("Refreshing Git HUD...", "info");
			scheduleRefresh(pi, state, ctx, "manual", 0);
		},
	});

	pi.registerCommand("git-hud-settings", {
		description:
			"Show or update Git HUD settings. Usage: /git-hud-settings interval=15s churn=on stash=on enabled=on",
		handler: async (args, ctx) => {
			state.activeCtx = ctx;
			if (!args.trim()) {
				ctx.ui.notify(
					`Git HUD settings: ${summarizeSettings(state.settings)}\nUsage: /git-hud-settings interval=15s churn=on stash=off enabled=on`,
					"info",
				);
				return;
			}

			const parsed = parseSettingsArgs(args, state.settings);
			if (parsed.errors.length > 0 || !parsed.next) {
				ctx.ui.notify(`Git HUD settings error: ${parsed.errors.join("; ")}`, "error");
				return;
			}

			state.settings = parsed.next;
			persistState(pi, state);
			applyPollTimer(pi, state);
			renderWidget(ctx, state);
			ctx.ui.notify(`Git HUD updated: ${summarizeSettings(state.settings)}`, "info");
			scheduleRefresh(pi, state, ctx, "manual", 0);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		state.shutdown = false;
		state.activeCtx = ctx;
		state.settings = restoreState(ctx);
		state.lastSnapshot = undefined;
		state.lastError = undefined;
		state.lastRefreshAt = undefined;
		state.lastSuccessAt = undefined;
		state.refreshQueued = false;
		renderWidget(ctx, state);
		applyPollTimer(pi, state);
		scheduleRefresh(pi, state, ctx, "session_start", 0);
	});

	pi.on("turn_end", async (_event, ctx) => {
		scheduleRefresh(pi, state, ctx, "turn_end");
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		if (!REFRESH_TOOLS.has(event.toolName)) return;
		scheduleRefresh(pi, state, ctx, `tool:${event.toolName}`);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		state.shutdown = true;
		clearTimers(state);
		state.isRefreshing = false;
		state.refreshQueued = false;
		state.activeCtx = undefined;
		if (ctx.hasUI) {
			ctx.ui.setWidget(WIDGET_ID, undefined);
		}
	});
}
