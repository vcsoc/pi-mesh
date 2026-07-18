import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

type ScheduleMode = "once" | "interval" | "cron";
type ScheduleStatus = "active" | "suspended" | "removed" | "completed";
type RunStatus = "queued" | "running" | "completed" | "failed" | "interrupted";

type ScheduleRecord = {
  id: string;
  name: string;
  mode: ScheduleMode;
  status: ScheduleStatus;
  prompt: string;
  timezone: string;
  createdAt: number;
  updatedAt: number;
  onceAt?: number;
  intervalMs?: number;
  cron?: string;
  anchorAt?: number;
  lastQueuedAt?: number;
  lastStartedAt?: number;
  lastCompletedAt?: number;
  lastDurationMs?: number;
  averageDurationMs?: number;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  nextRunAt?: number | null;
  removedAt?: number;
  suspendedAt?: number;
  lastError?: string;
};

type ScheduleRun = {
  id: string;
  scheduleId: string;
  scheduleName: string;
  scheduleMode: ScheduleMode;
  queuedAt: number;
  dueAt?: number | null;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  status: RunStatus;
  prompt: string;
  promptPreview: string;
  resultSummary?: string;
  error?: string;
};

type ScheduleStore = {
  version: 1;
  schedules: ScheduleRecord[];
  history: ScheduleRun[];
};

type TickContext = Pick<ExtensionContext, "cwd" | "hasPendingMessages" | "isIdle" | "ui">;

type CronFieldMatcher = {
  matches: (value: number) => boolean;
  label: string;
};

const STORE_VERSION = 1;
const HISTORY_LIMIT = 2000;
const TICK_MS = 15_000;
const RUN_PREFIX = "[PI_SCHEDULE";
const SUBCOMMANDS = ["create", "list", "report", "run", "suspend", "resume", "delete", "restore", "help"];

let store: ScheduleStore = { version: STORE_VERSION, schedules: [], history: [] };
let tickTimer: NodeJS.Timeout | undefined;
let busy = false;
let currentCtx: TickContext | undefined;
let currentRunId: string | undefined;
let currentRunScheduleId: string | undefined;

function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function getDataDir(): string {
  return join(getAgentDir(), "schedule-data");
}

function getStorePath(): string {
  return join(getDataDir(), "store.json");
}

function getReportPath(): string {
  return join(getDataDir(), "schedule-report.html");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureDataDir(): Promise<void> {
  await mkdir(getDataDir(), { recursive: true });
}

async function loadStore(): Promise<void> {
  await ensureDataDir();
  const path = getStorePath();

  if (!(await exists(path))) {
    store = { version: STORE_VERSION, schedules: [], history: [] };
    await saveStore();
    return;
  }

  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<ScheduleStore>;
    store = {
      version: STORE_VERSION,
      schedules: Array.isArray(parsed.schedules) ? parsed.schedules.map(normalizeSchedule) : [],
      history: Array.isArray(parsed.history) ? parsed.history.map(normalizeRun).slice(-HISTORY_LIMIT) : [],
    };
  } catch {
    store = { version: STORE_VERSION, schedules: [], history: [] };
  }

  markInterruptedRuns();
  recalculateRunAggregates();
  recomputeAllNextRuns(Date.now());
  await saveStore();
}

async function saveStore(): Promise<void> {
  await ensureDataDir();
  store.history = store.history.slice(-HISTORY_LIMIT);
  await writeFile(getStorePath(), JSON.stringify(store, null, 2) + "\n", "utf8");
}

function normalizeSchedule(input: Partial<ScheduleRecord>): ScheduleRecord {
  const now = Date.now();
  return {
    id: String(input.id || createId("sch")),
    name: String(input.name || "Untitled schedule"),
    mode: input.mode === "cron" || input.mode === "interval" ? input.mode : "once",
    status:
      input.status === "suspended" || input.status === "removed" || input.status === "completed"
        ? input.status
        : "active",
    prompt: String(input.prompt || ""),
    timezone: String(input.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "local"),
    createdAt: numberOr(input.createdAt, now),
    updatedAt: numberOr(input.updatedAt, now),
    onceAt: optionalNumber(input.onceAt),
    intervalMs: optionalNumber(input.intervalMs),
    cron: typeof input.cron === "string" ? input.cron.trim() : undefined,
    anchorAt: optionalNumber(input.anchorAt),
    lastQueuedAt: optionalNumber(input.lastQueuedAt),
    lastStartedAt: optionalNumber(input.lastStartedAt),
    lastCompletedAt: optionalNumber(input.lastCompletedAt),
    lastDurationMs: optionalNumber(input.lastDurationMs),
    averageDurationMs: optionalNumber(input.averageDurationMs),
    totalRuns: Math.max(0, numberOr(input.totalRuns, 0)),
    successfulRuns: Math.max(0, numberOr(input.successfulRuns, 0)),
    failedRuns: Math.max(0, numberOr(input.failedRuns, 0)),
    nextRunAt: input.nextRunAt === null ? null : optionalNumber(input.nextRunAt),
    removedAt: optionalNumber(input.removedAt),
    suspendedAt: optionalNumber(input.suspendedAt),
    lastError: typeof input.lastError === "string" ? input.lastError : undefined,
  };
}

function normalizeRun(input: Partial<ScheduleRun>): ScheduleRun {
  return {
    id: String(input.id || createId("run")),
    scheduleId: String(input.scheduleId || "unknown"),
    scheduleName: String(input.scheduleName || "Unknown schedule"),
    scheduleMode: input.scheduleMode === "cron" || input.scheduleMode === "interval" ? input.scheduleMode : "once",
    queuedAt: numberOr(input.queuedAt, Date.now()),
    dueAt: input.dueAt === null ? null : optionalNumber(input.dueAt),
    startedAt: optionalNumber(input.startedAt),
    completedAt: optionalNumber(input.completedAt),
    durationMs: optionalNumber(input.durationMs),
    status:
      input.status === "running" || input.status === "completed" || input.status === "failed" || input.status === "interrupted"
        ? input.status
        : "queued",
    prompt: String(input.prompt || ""),
    promptPreview: String(input.promptPreview || previewText(String(input.prompt || ""))),
    resultSummary: typeof input.resultSummary === "string" ? input.resultSummary : undefined,
    error: typeof input.error === "string" ? input.error : undefined,
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function previewText(text: string, max = 140): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`;
}

function formatDateTime(value?: number | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function formatDuration(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatRelative(target?: number | null): string {
  if (!target) return "—";
  const delta = target - Date.now();
  const abs = Math.abs(delta);
  const units: Array<[number, string]> = [
    [60_000, "m"],
    [3_600_000, "h"],
    [86_400_000, "d"],
  ];

  if (abs < 60_000) return delta >= 0 ? "in <1m" : "<1m ago";
  if (abs < units[1][0]) return `${delta >= 0 ? "in " : ""}${Math.round(abs / units[0][0])}m${delta < 0 ? " ago" : ""}`;
  if (abs < units[2][0]) return `${delta >= 0 ? "in " : ""}${Math.round(abs / units[1][0])}h${delta < 0 ? " ago" : ""}`;
  return `${delta >= 0 ? "in " : ""}${Math.round(abs / units[2][0])}d${delta < 0 ? " ago" : ""}`;
}

function formatInterval(ms?: number): string {
  if (!ms) return "—";
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  if (ms % week === 0) return `${ms / week}w`;
  if (ms % day === 0) return `${ms / day}d`;
  if (ms % hour === 0) return `${ms / hour}h`;
  if (ms % minute === 0) return `${ms / minute}m`;
  return `${Math.round(ms / 1000)}s`;
}

function describeScheduleMode(schedule: ScheduleRecord): string {
  if (schedule.mode === "once") return `once @ ${formatDateTime(schedule.onceAt)}`;
  if (schedule.mode === "interval") return `every ${formatInterval(schedule.intervalMs)}`;
  return `cron ${schedule.cron || "* * * * *"}`;
}

function statusIcon(status: ScheduleStatus): string {
  switch (status) {
    case "active":
      return "●";
    case "suspended":
      return "◐";
    case "removed":
      return "○";
    case "completed":
      return "✓";
  }
}

function markInterruptedRuns(): void {
  for (const run of store.history) {
    if (run.status === "queued" || run.status === "running") {
      run.status = "interrupted";
      run.completedAt = run.completedAt || Date.now();
      run.durationMs = run.startedAt ? run.completedAt - run.startedAt : undefined;
      run.error = run.error || "Pi stopped before the scheduled run completed.";
    }
  }
}

function recalculateRunAggregates(): void {
  for (const schedule of store.schedules) {
    const allRuns = getScheduleHistory(schedule.id);
    const finalizedRuns = allRuns.filter((run) => run.status === "completed" || run.status === "failed" || run.status === "interrupted");

    schedule.totalRuns = finalizedRuns.length;
    schedule.successfulRuns = finalizedRuns.filter((run) => run.status === "completed").length;
    schedule.failedRuns = finalizedRuns.filter((run) => run.status === "failed" || run.status === "interrupted").length;

    const durations = finalizedRuns
      .map((run) => run.durationMs)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    schedule.averageDurationMs = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : undefined;

    const latestAny = allRuns[0];
    const latestFinalized = finalizedRuns[0];
    schedule.lastQueuedAt = latestAny?.queuedAt;
    schedule.lastStartedAt = latestAny?.startedAt || latestFinalized?.startedAt;
    schedule.lastCompletedAt = latestFinalized?.completedAt;
    schedule.lastDurationMs = latestFinalized?.durationMs;
    schedule.lastError = latestFinalized?.error;
  }
}

function parseHumanInterval(input: string): number | undefined {
  const match = input.trim().toLowerCase().match(/^(\d+)\s*([smhdw])$/);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return value * multipliers[unit];
}

function parseDateTimeInput(input: string): number | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const direct = Date.parse(trimmed);
  if (!Number.isNaN(direct)) return direct;

  const localMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!localMatch) return undefined;
  const [, y, m, d, hh, mm] = localMatch;
  return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), 0, 0).getTime();
}

function splitCronField(field: string): string[] {
  return field.split(",").map((part) => part.trim()).filter(Boolean);
}

function buildCronMatcher(field: string, min: number, max: number): CronFieldMatcher {
  const pieces = splitCronField(field || "*");
  if (pieces.length === 0) {
    throw new Error("Empty cron field");
  }

  const predicates = pieces.map((piece) => buildCronPieceMatcher(piece, min, max));
  return {
    label: field,
    matches(value: number) {
      return predicates.some((fn) => fn(value));
    },
  };
}

function buildCronPieceMatcher(piece: string, min: number, max: number): (value: number) => boolean {
  const [rangePart, stepPart] = piece.split("/");
  const step = stepPart ? Number(stepPart) : 1;
  if (!Number.isInteger(step) || step <= 0) {
    throw new Error(`Invalid cron step: ${piece}`);
  }

  if (rangePart === "*") {
    return (value) => value >= min && value <= max && (value - min) % step === 0;
  }

  const rangeMatch = rangePart.match(/^(\d+)(?:-(\d+))?$/);
  if (!rangeMatch) {
    throw new Error(`Invalid cron field: ${piece}`);
  }

  const start = Number(rangeMatch[1]);
  const end = rangeMatch[2] ? Number(rangeMatch[2]) : start;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
    throw new Error(`Cron value out of range: ${piece}`);
  }

  return (value) => value >= start && value <= end && (value - start) % step === 0;
}

function parseCronExpression(expression: string): {
  minute: CronFieldMatcher;
  hour: CronFieldMatcher;
  dayOfMonth: CronFieldMatcher;
  month: CronFieldMatcher;
  dayOfWeek: CronFieldMatcher;
} {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("Cron expressions must have 5 fields: minute hour day-of-month month day-of-week");
  }

  return {
    minute: buildCronMatcher(parts[0]!, 0, 59),
    hour: buildCronMatcher(parts[1]!, 0, 23),
    dayOfMonth: buildCronMatcher(parts[2]!, 1, 31),
    month: buildCronMatcher(parts[3]!, 1, 12),
    dayOfWeek: buildCronMatcher(parts[4]!, 0, 6),
  };
}

function nextCronRun(expression: string, after: number): number | undefined {
  const cron = parseCronExpression(expression);
  const candidate = new Date(after + 60_000);
  candidate.setSeconds(0, 0);

  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    if (
      cron.minute.matches(candidate.getMinutes()) &&
      cron.hour.matches(candidate.getHours()) &&
      cron.dayOfMonth.matches(candidate.getDate()) &&
      cron.month.matches(candidate.getMonth() + 1) &&
      cron.dayOfWeek.matches(candidate.getDay())
    ) {
      return candidate.getTime();
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return undefined;
}

function computeNextRun(schedule: ScheduleRecord, now: number): number | null {
  if (schedule.status === "removed" || schedule.status === "suspended" || schedule.status === "completed") {
    return null;
  }

  if (schedule.mode === "once") {
    if (!schedule.onceAt) return null;
    return schedule.onceAt;
  }

  if (schedule.mode === "interval") {
    if (!schedule.intervalMs) return null;
    const anchor = schedule.anchorAt || schedule.createdAt || now;
    const baseline = Math.max(anchor, schedule.lastQueuedAt || anchor);
    if (baseline <= now) {
      const steps = Math.floor((now - anchor) / schedule.intervalMs) + 1;
      return anchor + steps * schedule.intervalMs;
    }
    return baseline;
  }

  if (!schedule.cron) return null;
  return nextCronRun(schedule.cron, schedule.lastQueuedAt || now - 60_000) ?? null;
}

function recomputeSchedule(schedule: ScheduleRecord, now: number): void {
  if (schedule.status === "completed" && schedule.mode !== "once") {
    schedule.status = "active";
  }
  schedule.nextRunAt = computeNextRun(schedule, now);
}

function recomputeAllNextRuns(now: number): void {
  for (const schedule of store.schedules) {
    recomputeSchedule(schedule, now);
  }
}

function listSchedules(includeRemoved = true): ScheduleRecord[] {
  const items = includeRemoved ? [...store.schedules] : store.schedules.filter((item) => item.status !== "removed");
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

function getSchedule(id: string): ScheduleRecord | undefined {
  return store.schedules.find((item) => item.id === id);
}

function getRun(id: string): ScheduleRun | undefined {
  return store.history.find((item) => item.id === id);
}

function getScheduleHistory(scheduleId: string): ScheduleRun[] {
  return store.history.filter((item) => item.scheduleId === scheduleId).sort((a, b) => b.queuedAt - a.queuedAt);
}

function scheduleSummaryLine(schedule: ScheduleRecord): string {
  return `${statusIcon(schedule.status)} ${schedule.name} [${schedule.id}] • ${describeScheduleMode(schedule)} • next ${formatDateTime(schedule.nextRunAt)} (${formatRelative(schedule.nextRunAt)})`;
}

function buildRunPrompt(schedule: ScheduleRecord, run: ScheduleRun): string {
  return `${RUN_PREFIX} id=${schedule.id} run=${run.id}]\nExecute the following scheduled task now.\n\nSchedule name: ${schedule.name}\nSchedule type: ${describeScheduleMode(schedule)}\nQueued at: ${formatDateTime(run.queuedAt)}\nDue at: ${formatDateTime(run.dueAt)}\n\nTask instructions:\n${schedule.prompt}\n\nAfter completing the work, give a concise summary of what happened.`;
}

function parseRunMetadata(prompt: string): { scheduleId: string; runId: string } | undefined {
  const match = prompt.match(/^\[PI_SCHEDULE\s+id=([^\s]+)\s+run=([^\]]+)\]/);
  if (!match) return undefined;
  return { scheduleId: match[1]!, runId: match[2]! };
}

function extractAssistantSummary(messages: Array<{ role?: string; content?: any }>): string | undefined {
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (!lastAssistant || !Array.isArray(lastAssistant.content)) return undefined;
  const text = lastAssistant.content
    .filter((item: any) => item?.type === "text" && typeof item.text === "string")
    .map((item: any) => item.text)
    .join("\n")
    .trim();
  return text ? previewText(text, 280) : undefined;
}

function updateStatus(ctx: TickContext): void {
  const active = store.schedules.filter((item) => item.status === "active");
  if (active.length === 0) {
    ctx.ui.setStatus("schedule", "⏰ none");
    return;
  }

  const next = [...active]
    .filter((item) => item.nextRunAt)
    .sort((a, b) => (a.nextRunAt || Number.MAX_SAFE_INTEGER) - (b.nextRunAt || Number.MAX_SAFE_INTEGER))[0];

  const detail = next ? `${next.name} ${formatRelative(next.nextRunAt)}` : "waiting";
  ctx.ui.setStatus("schedule", `⏰ ${active.length} active • ${detail}`);
}

async function queueRun(schedule: ScheduleRecord, ctx: TickContext, source: "automatic" | "manual"): Promise<ScheduleRun> {
  const now = Date.now();
  const run: ScheduleRun = {
    id: createId("run"),
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    scheduleMode: schedule.mode,
    queuedAt: now,
    dueAt: schedule.nextRunAt ?? now,
    status: "queued",
    prompt: schedule.prompt,
    promptPreview: previewText(schedule.prompt),
  };

  store.history.push(run);
  schedule.lastQueuedAt = now;
  schedule.updatedAt = now;
  schedule.lastError = undefined;

  if (schedule.mode === "once") {
    schedule.status = "completed";
    schedule.nextRunAt = null;
  } else {
    schedule.nextRunAt = computeNextRun(schedule, now);
  }

  await saveStore();
  updateStatus(ctx);

  const prompt = buildRunPrompt(schedule, run);
  if (ctx.isIdle()) {
    currentRunId = run.id;
    currentRunScheduleId = schedule.id;
    piRef?.sendUserMessage(prompt);
  } else {
    piRef?.sendUserMessage(prompt, { deliverAs: "followUp" });
    ctx.ui.notify(`Queued schedule “${schedule.name}” as a follow-up (${source})`, "info");
  }

  return run;
}

let piRef: ExtensionAPI | undefined;

async function processDueSchedules(ctx: TickContext): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const now = Date.now();
    recomputeAllNextRuns(now);
    const due = store.schedules
      .filter((item) => item.status === "active" && item.nextRunAt !== null && item.nextRunAt !== undefined && item.nextRunAt <= now)
      .sort((a, b) => (a.nextRunAt || 0) - (b.nextRunAt || 0));

    for (const schedule of due) {
      await queueRun(schedule, ctx, "automatic");
    }

    await saveStore();
    updateStatus(ctx);
  } finally {
    busy = false;
  }
}

function stopScheduler(ctx?: TickContext): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = undefined;
  }
  currentCtx = undefined;
  if (ctx) {
    ctx.ui.setStatus("schedule", undefined);
  }
}

function startScheduler(ctx: TickContext): void {
  stopScheduler();
  currentCtx = ctx;
  updateStatus(ctx);
  tickTimer = setInterval(() => {
    if (!currentCtx) return;
    void processDueSchedules(currentCtx);
  }, TICK_MS);
  void processDueSchedules(ctx);
}

async function createScheduleFlow(ctx: ExtensionCommandContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/schedule create requires interactive mode", "error");
    return;
  }

  const mode = await ctx.ui.select("Schedule type", ["once", "interval", "cron"]);
  if (!mode) return;

  const name = await ctx.ui.input("Schedule name", "daily maintenance");
  if (!name?.trim()) return;

  const prompt = await ctx.ui.editor(
    "Scheduled task instructions",
    "Describe what the agent should do when this schedule fires."
  );
  if (!prompt?.trim()) return;

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const schedule: ScheduleRecord = {
    id: createId("sch"),
    name: name.trim(),
    mode: mode as ScheduleMode,
    status: "active",
    prompt: prompt.trim(),
    timezone,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    totalRuns: 0,
    successfulRuns: 0,
    failedRuns: 0,
    nextRunAt: undefined,
  };

  if (mode === "once") {
    const answer = await ctx.ui.input("Run at (ISO or YYYY-MM-DD HH:mm)", new Date(Date.now() + 3_600_000).toISOString().slice(0, 16));
    const parsed = answer ? parseDateTimeInput(answer) : undefined;
    if (!parsed) {
      ctx.ui.notify("Invalid date/time", "error");
      return;
    }
    schedule.onceAt = parsed;
  } else if (mode === "interval") {
    const answer = await ctx.ui.input("Interval (examples: 15m, 2h, 1d)", "15m");
    const parsed = answer ? parseHumanInterval(answer) : undefined;
    if (!parsed) {
      ctx.ui.notify("Invalid interval", "error");
      return;
    }
    schedule.intervalMs = parsed;
    schedule.anchorAt = Date.now();
  } else {
    const answer = await ctx.ui.input("Cron expression (minute hour day month weekday)", "0 9 * * 1-5");
    if (!answer?.trim()) return;
    try {
      parseCronExpression(answer.trim());
    } catch (error: any) {
      ctx.ui.notify(error?.message || "Invalid cron expression", "error");
      return;
    }
    schedule.cron = answer.trim();
  }

  recomputeSchedule(schedule, Date.now());
  store.schedules.push(schedule);
  await saveStore();
  if (currentCtx) updateStatus(currentCtx);
  ctx.ui.notify(`Created schedule “${schedule.name}”`, "info");
}

async function chooseSchedule(ctx: ExtensionCommandContext, title: string, includeRemoved = true): Promise<ScheduleRecord | undefined> {
  const schedules = listSchedules(includeRemoved);
  if (schedules.length === 0) {
    ctx.ui.notify("No schedules found", "info");
    return undefined;
  }

  const labels = schedules.map((item) => scheduleSummaryLine(item));
  const picked = await ctx.ui.select(title, labels);
  if (!picked) return undefined;
  return schedules[labels.indexOf(picked)];
}

async function editScheduleFlow(ctx: ExtensionCommandContext, schedule: ScheduleRecord): Promise<void> {
  let done = false;

  while (!done) {
    const actions = [
      "View details",
      "Edit name",
      "Edit prompt",
      "Edit timing",
      schedule.status === "suspended" ? "Resume" : "Suspend",
      schedule.status === "removed" ? "Restore" : "Delete",
      "Run now",
      "Back",
    ];

    const action = await ctx.ui.select(`Manage schedule: ${schedule.name}`, actions);
    if (!action || action === "Back") return;

    if (action === "View details") {
      const history = getScheduleHistory(schedule.id).slice(0, 10);
      const body = [
        `ID: ${schedule.id}`,
        `Status: ${schedule.status}`,
        `Mode: ${describeScheduleMode(schedule)}`,
        `Next run: ${formatDateTime(schedule.nextRunAt)} (${formatRelative(schedule.nextRunAt)})`,
        `Last completed: ${formatDateTime(schedule.lastCompletedAt)}`,
        `Average duration: ${formatDuration(schedule.averageDurationMs)}`,
        `Total runs: ${schedule.totalRuns}`,
        "",
        "Recent runs:",
        ...history.map((run) => `- ${formatDateTime(run.queuedAt)} • ${run.status} • ${formatDuration(run.durationMs)} • ${run.resultSummary || run.error || ""}`),
      ].join("\n");
      await ctx.ui.editor("Schedule details", body);
      continue;
    }

    if (action === "Edit name") {
      const next = await ctx.ui.input("New name", schedule.name);
      if (!next?.trim()) continue;
      schedule.name = next.trim();
      schedule.updatedAt = Date.now();
      await saveStore();
      continue;
    }

    if (action === "Edit prompt") {
      const next = await ctx.ui.editor("Edit prompt", schedule.prompt);
      if (!next?.trim()) continue;
      schedule.prompt = next.trim();
      schedule.updatedAt = Date.now();
      await saveStore();
      continue;
    }

    if (action === "Edit timing") {
      if (schedule.mode === "once") {
        const next = await ctx.ui.input("Run at", schedule.onceAt ? new Date(schedule.onceAt).toISOString().slice(0, 16) : "");
        const parsed = next ? parseDateTimeInput(next) : undefined;
        if (!parsed) {
          ctx.ui.notify("Invalid date/time", "error");
          continue;
        }
        schedule.onceAt = parsed;
        if (schedule.status === "completed") schedule.status = "active";
      } else if (schedule.mode === "interval") {
        const next = await ctx.ui.input("Interval", formatInterval(schedule.intervalMs));
        const parsed = next ? parseHumanInterval(next) : undefined;
        if (!parsed) {
          ctx.ui.notify("Invalid interval", "error");
          continue;
        }
        schedule.intervalMs = parsed;
        schedule.anchorAt = Date.now();
      } else {
        const next = await ctx.ui.input("Cron expression", schedule.cron || "");
        if (!next?.trim()) continue;
        try {
          parseCronExpression(next.trim());
        } catch (error: any) {
          ctx.ui.notify(error?.message || "Invalid cron expression", "error");
          continue;
        }
        schedule.cron = next.trim();
      }
      schedule.updatedAt = Date.now();
      recomputeSchedule(schedule, Date.now());
      await saveStore();
      continue;
    }

    if (action === "Suspend") {
      schedule.status = "suspended";
      schedule.suspendedAt = Date.now();
      schedule.updatedAt = Date.now();
      recomputeSchedule(schedule, Date.now());
      await saveStore();
      continue;
    }

    if (action === "Resume") {
      schedule.status = "active";
      schedule.suspendedAt = undefined;
      schedule.updatedAt = Date.now();
      recomputeSchedule(schedule, Date.now());
      await saveStore();
      continue;
    }

    if (action === "Delete") {
      const ok = await ctx.ui.confirm("Remove schedule?", `Soft-delete ${schedule.name}?`);
      if (!ok) continue;
      schedule.status = "removed";
      schedule.removedAt = Date.now();
      schedule.updatedAt = Date.now();
      recomputeSchedule(schedule, Date.now());
      await saveStore();
      done = true;
      continue;
    }

    if (action === "Restore") {
      schedule.status = "active";
      schedule.removedAt = undefined;
      schedule.updatedAt = Date.now();
      recomputeSchedule(schedule, Date.now());
      await saveStore();
      continue;
    }

    if (action === "Run now") {
      if (!currentCtx) {
        ctx.ui.notify("Scheduler context unavailable", "error");
        continue;
      }
      await queueRun(schedule, currentCtx, "manual");
      continue;
    }
  }
}

async function listSchedulesFlow(ctx: ExtensionCommandContext): Promise<void> {
  if (ctx.mode !== "tui") {
    const lines = listSchedules(true).map((item) => scheduleSummaryLine(item));
    ctx.ui.notify(lines.length ? lines.join(" | ") : "No schedules found", "info");
    return;
  }

  while (true) {
    const schedule = await chooseSchedule(ctx, "Select a schedule", true);
    if (!schedule) return;
    await editScheduleFlow(ctx, schedule);
  }
}

function buildStats() {
  const schedules = listSchedules(true);
  const statusCounts: Record<ScheduleStatus, number> = {
    active: 0,
    suspended: 0,
    removed: 0,
    completed: 0,
  };

  for (const schedule of schedules) {
    statusCounts[schedule.status] += 1;
  }

  const runsByDay = new Map<string, number>();
  for (const run of store.history) {
    const key = new Date(run.queuedAt).toISOString().slice(0, 10);
    runsByDay.set(key, (runsByDay.get(key) || 0) + 1);
  }

  return {
    scheduleCount: schedules.length,
    runCount: store.history.length,
    statusCounts,
    runsByDay: [...runsByDay.entries()].sort((a, b) => a[0].localeCompare(b[0])),
  };
}

function generateReportHtml(): string {
  recalculateRunAggregates();
  const stats = buildStats();
  const payload = JSON.stringify({ generatedAt: Date.now(), schedules: listSchedules(true), history: store.history, stats });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pi Schedule Report</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b1020;
      --panel: #121933;
      --panel-2: #192349;
      --border: #2a376a;
      --text: #e9eefb;
      --muted: #9fb0e3;
      --accent: #7aa2ff;
      --success: #43d08a;
      --warn: #f8c45c;
      --danger: #ff6b7a;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: var(--bg); color: var(--text); }
    .wrap { padding: 24px; display: grid; gap: 20px; }
    .hero, .panel { background: linear-gradient(180deg, var(--panel), var(--panel-2)); border: 1px solid var(--border); border-radius: 18px; }
    .hero { padding: 22px; }
    .hero h1 { margin: 0 0 8px; font-size: 28px; }
    .muted { color: var(--muted); }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
    .card { padding: 16px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; }
    .big { font-size: 26px; font-weight: 700; margin-top: 6px; }
    .grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 20px; }
    .panel { padding: 18px; }
    .panel h2 { margin: 0 0 16px; font-size: 18px; }
    .list { width: 100%; border-collapse: collapse; }
    .list th, .list td { text-align: left; padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.07); vertical-align: top; }
    .list tbody tr { cursor: pointer; }
    .list tbody tr:hover, .list tbody tr.active { background: rgba(122, 162, 255, 0.12); }
    .pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .pill.active { background: rgba(67, 208, 138, 0.14); color: var(--success); }
    .pill.suspended { background: rgba(248, 196, 92, 0.14); color: var(--warn); }
    .pill.removed { background: rgba(255, 107, 122, 0.14); color: var(--danger); }
    .pill.completed { background: rgba(122, 162, 255, 0.14); color: var(--accent); }
    .kv { display: grid; grid-template-columns: 160px 1fr; gap: 8px 14px; }
    .kv .k { color: var(--muted); }
    .code { white-space: pre-wrap; background: rgba(0,0,0,0.22); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; }
    .history-item { border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 12px; margin-bottom: 10px; background: rgba(255,255,255,0.02); }
    .history-item:last-child { margin-bottom: 0; }
    .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .bar-row { display: grid; grid-template-columns: 90px 1fr 40px; gap: 10px; align-items: center; margin-bottom: 10px; }
    .bar { height: 12px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden; }
    .bar > span { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), #a8c1ff); }
    svg { width: 100%; height: 220px; display: block; }
    .footer-note { color: var(--muted); font-size: 12px; }
    @media (max-width: 980px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>Pi Schedule Report</h1>
      <div class="muted">Generated ${new Date().toLocaleString()} • local report • click any schedule to drill into its history</div>
    </section>

    <section class="stats" id="summary-cards"></section>

    <section class="charts">
      <div class="panel">
        <h2>Status distribution</h2>
        <div id="status-bars"></div>
      </div>
      <div class="panel">
        <h2>Runs over time</h2>
        <svg id="runs-chart" viewBox="0 0 520 220" preserveAspectRatio="none"></svg>
      </div>
    </section>

    <section class="grid">
      <div class="panel">
        <h2>Schedules</h2>
        <table class="list">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Next</th>
              <th>Avg duration</th>
            </tr>
          </thead>
          <tbody id="schedule-rows"></tbody>
        </table>
      </div>

      <div class="panel">
        <h2>Schedule detail</h2>
        <div id="detail"></div>
      </div>
    </section>

    <section class="panel">
      <h2>Execution history</h2>
      <div id="history"></div>
      <div class="footer-note">History is retained locally and capped to the most recent ${HISTORY_LIMIT} runs.</div>
    </section>
  </div>

  <script>
    const data = ${payload};
    const schedules = data.schedules.slice();
    const history = data.history.slice().sort((a, b) => b.queuedAt - a.queuedAt);
    let selected = schedules[0] || null;

    function fmtDate(value) {
      return value ? new Date(value).toLocaleString() : "—";
    }

    function fmtDuration(ms) {
      if (ms === undefined || ms === null || Number.isNaN(ms)) return "—";
      if (ms < 1000) return Math.round(ms) + "ms";
      const sec = ms / 1000;
      if (sec < 60) return (sec < 10 ? sec.toFixed(1) : Math.round(sec)) + "s";
      const min = Math.floor(sec / 60);
      const rest = Math.round(sec % 60);
      if (min < 60) return min + "m " + rest + "s";
      return Math.floor(min / 60) + "h " + (min % 60) + "m";
    }

    function modeLabel(item) {
      if (item.mode === "once") return "once @ " + fmtDate(item.onceAt);
      if (item.mode === "interval") return "every " + Math.round((item.intervalMs || 0) / 60000) + "m";
      return "cron " + (item.cron || "* * * * *");
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function runPillClass(status) {
      if (status === "failed" || status === "interrupted") return "removed";
      if (status === "queued" || status === "running") return "suspended";
      return "active";
    }

    function renderCards() {
      const items = [
        ["Schedules", data.stats.scheduleCount],
        ["Runs", data.stats.runCount],
        ["Active", data.stats.statusCounts.active],
        ["Suspended", data.stats.statusCounts.suspended],
        ["Removed", data.stats.statusCounts.removed],
        ["Completed once", data.stats.statusCounts.completed],
      ];
      document.getElementById("summary-cards").innerHTML = items.map(function(item) {
        return '<div class="card"><div class="muted">' + item[0] + '</div><div class="big">' + item[1] + '</div></div>';
      }).join("");
    }

    function renderStatusBars() {
      const values = Object.values(data.stats.statusCounts);
      const max = Math.max.apply(null, [1].concat(values));
      document.getElementById("status-bars").innerHTML = Object.entries(data.stats.statusCounts).map(function(entry) {
        const width = (entry[1] / max) * 100;
        return '<div class="bar-row"><div>' + entry[0] + '</div><div class="bar"><span style="width:' + width + '%"></span></div><div>' + entry[1] + '</div></div>';
      }).join("");
    }

    function renderRunsChart() {
      const svg = document.getElementById("runs-chart");
      const points = data.stats.runsByDay;
      if (!points.length) {
        svg.innerHTML = '<text x="20" y="40" fill="#9fb0e3">No executions yet</text>';
        return;
      }
      const width = 520;
      const height = 220;
      const left = 30;
      const bottom = 28;
      const top = 14;
      const right = 12;
      const maxY = Math.max.apply(null, points.map(function(point) { return point[1]; }));
      const innerW = width - left - right;
      const innerH = height - top - bottom;
      const coords = points.map(function(point, index) {
        const x = left + (points.length === 1 ? innerW / 2 : (index / (points.length - 1)) * innerW);
        const y = top + innerH - (point[1] / Math.max(1, maxY)) * innerH;
        return { label: point[0], value: point[1], x, y };
      });
      const line = coords.map(function(point) { return point.x + ',' + point.y; }).join(' ');
      const labels = coords.filter(function(_point, index) {
        return index === 0 || index === coords.length - 1 || index === Math.floor(coords.length / 2);
      }).map(function(point) {
        return '<text x="' + point.x + '" y="' + (height - 6) + '" text-anchor="middle" fill="#9fb0e3" font-size="10">' + point.label.slice(5) + '</text>';
      }).join('');
      const dots = coords.map(function(point) {
        return '<circle cx="' + point.x + '" cy="' + point.y + '" r="4" fill="#7aa2ff"><title>' + point.label + ': ' + point.value + '</title></circle>';
      }).join('');
      svg.innerHTML = '<line x1="' + left + '" y1="' + (height - bottom) + '" x2="' + (width - right) + '" y2="' + (height - bottom) + '" stroke="#2a376a" />' +
        '<line x1="' + left + '" y1="' + top + '" x2="' + left + '" y2="' + (height - bottom) + '" stroke="#2a376a" />' +
        '<polyline fill="none" stroke="#7aa2ff" stroke-width="3" points="' + line + '" />' + dots + labels;
    }

    function renderSchedules() {
      const tbody = document.getElementById("schedule-rows");
      tbody.innerHTML = schedules.map(function(item) {
        const active = selected && selected.id === item.id ? 'active' : '';
        return '<tr data-id="' + escapeHtml(item.id) + '" class="' + active + '">' +
          '<td><div><strong>' + escapeHtml(item.name) + '</strong></div><div class="muted">' + escapeHtml(modeLabel(item)) + '</div></td>' +
          '<td><span class="pill ' + item.status + '">' + item.status + '</span></td>' +
          '<td>' + escapeHtml(fmtDate(item.nextRunAt)) + '</td>' +
          '<td>' + escapeHtml(fmtDuration(item.averageDurationMs)) + '</td>' +
          '</tr>';
      }).join('');
      Array.from(tbody.querySelectorAll('tr')).forEach(function(row) {
        row.addEventListener('click', function() {
          selected = schedules.find(function(item) { return item.id === row.dataset.id; }) || null;
          renderSchedules();
          renderDetail();
          renderHistory();
        });
      });
    }

    function renderDetail() {
      const el = document.getElementById("detail");
      if (!selected) {
        el.innerHTML = '<div class="muted">No schedules available</div>';
        return;
      }
      const runs = history.filter(function(run) { return run.scheduleId === selected.id; });
      el.innerHTML =
        '<div class="kv">' +
          '<div class="k">ID</div><div>' + escapeHtml(selected.id) + '</div>' +
          '<div class="k">Status</div><div><span class="pill ' + selected.status + '">' + selected.status + '</span></div>' +
          '<div class="k">Mode</div><div>' + escapeHtml(modeLabel(selected)) + '</div>' +
          '<div class="k">Created</div><div>' + escapeHtml(fmtDate(selected.createdAt)) + '</div>' +
          '<div class="k">Next run</div><div>' + escapeHtml(fmtDate(selected.nextRunAt)) + '</div>' +
          '<div class="k">Last completed</div><div>' + escapeHtml(fmtDate(selected.lastCompletedAt)) + '</div>' +
          '<div class="k">Total runs</div><div>' + selected.totalRuns + '</div>' +
          '<div class="k">Succeeded</div><div>' + selected.successfulRuns + '</div>' +
          '<div class="k">Failed/interrupted</div><div>' + selected.failedRuns + '</div>' +
          '<div class="k">Average duration</div><div>' + escapeHtml(fmtDuration(selected.averageDurationMs)) + '</div>' +
          '<div class="k">Last duration</div><div>' + escapeHtml(fmtDuration(selected.lastDurationMs)) + '</div>' +
        '</div>' +
        '<h3>Prompt</h3><div class="code">' + escapeHtml(selected.prompt) + '</div>' +
        '<h3>Schedule run stats</h3><div class="muted">' + runs.length + ' recorded execution(s)</div>';
    }

    function renderHistory() {
      const el = document.getElementById("history");
      const rows = selected ? history.filter(function(run) { return run.scheduleId === selected.id; }) : history;
      if (!rows.length) {
        el.innerHTML = '<div class="muted">No execution history for the current selection.</div>';
        return;
      }
      el.innerHTML = rows.map(function(run) {
        return '<div class="history-item">' +
          '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
            '<strong>' + escapeHtml(run.scheduleName) + '</strong>' +
            '<span class="pill ' + runPillClass(run.status) + '">' + escapeHtml(run.status) + '</span>' +
          '</div>' +
          '<div class="muted">Queued ' + escapeHtml(fmtDate(run.queuedAt)) + ' • Started ' + escapeHtml(fmtDate(run.startedAt)) + ' • Completed ' + escapeHtml(fmtDate(run.completedAt)) + ' • Duration ' + escapeHtml(fmtDuration(run.durationMs)) + '</div>' +
          '<div style="margin-top:10px;">' + escapeHtml(run.resultSummary || run.error || run.promptPreview || '') + '</div>' +
          '<details style="margin-top:10px;"><summary>Prompt</summary><div class="code" style="margin-top:8px;">' + escapeHtml(run.prompt) + '</div></details>' +
        '</div>';
      }).join('');
    }

    renderCards();
    renderStatusBars();
    renderRunsChart();
    renderSchedules();
    renderDetail();
    renderHistory();
  </script>
</body>
</html>`;
}

async function generateReport(ctx: ExtensionCommandContext): Promise<void> {
  await ensureDataDir();
  await writeFile(getReportPath(), generateReportHtml(), "utf8");
  ctx.ui.notify(`Wrote ${getReportPath()}`, "info");
}

async function manualRunById(ctx: ExtensionCommandContext, id: string): Promise<void> {
  const schedule = getSchedule(id);
  if (!schedule) {
    ctx.ui.notify(`Unknown schedule: ${id}`, "error");
    return;
  }
  if (!currentCtx) {
    ctx.ui.notify("Scheduler context unavailable", "error");
    return;
  }
  await queueRun(schedule, currentCtx, "manual");
}

async function updateStatusById(ctx: ExtensionCommandContext, id: string, status: ScheduleStatus): Promise<void> {
  const schedule = getSchedule(id);
  if (!schedule) {
    ctx.ui.notify(`Unknown schedule: ${id}`, "error");
    return;
  }
  schedule.status = status;
  schedule.updatedAt = Date.now();
  if (status === "removed") schedule.removedAt = Date.now();
  if (status === "suspended") schedule.suspendedAt = Date.now();
  if (status === "active") {
    schedule.removedAt = undefined;
    schedule.suspendedAt = undefined;
  }
  recomputeSchedule(schedule, Date.now());
  await saveStore();
  if (currentCtx) updateStatus(currentCtx);
  ctx.ui.notify(`Updated ${schedule.name} to ${status}`, "info");
}

function usageText(): string {
  return [
    "/schedule",
    "/schedule create",
    "/schedule list",
    "/schedule report",
    "/schedule run <schedule-id>",
    "/schedule suspend <schedule-id>",
    "/schedule resume <schedule-id>",
    "/schedule delete <schedule-id>",
    "/schedule restore <schedule-id>",
  ].join("\n");
}

export default function scheduleWorkflow(pi: ExtensionAPI) {
  piRef = pi;

  pi.on("session_start", async (_event, ctx) => {
    await loadStore();
    startScheduler(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopScheduler(ctx);
    await saveStore();
  });

  pi.on("agent_start", async (event, _ctx) => {
    const rawPrompt = event.prompt || "";
    const meta = parseRunMetadata(rawPrompt);
    if (!meta) return;

    const run = getRun(meta.runId);
    const schedule = getSchedule(meta.scheduleId);
    if (!run || !schedule) return;

    run.status = "running";
    run.startedAt = Date.now();
    schedule.lastStartedAt = run.startedAt;
    currentRunId = run.id;
    currentRunScheduleId = schedule.id;
    await saveStore();
  });

  pi.on("agent_end", async (event, ctx) => {
    if (!currentRunId || !currentRunScheduleId) return;
    const run = getRun(currentRunId);
    const schedule = getSchedule(currentRunScheduleId);
    currentRunId = undefined;
    currentRunScheduleId = undefined;
    if (!run || !schedule) return;

    const completedAt = Date.now();
    run.completedAt = completedAt;
    run.durationMs = run.startedAt ? completedAt - run.startedAt : undefined;
    run.status = "completed";
    run.resultSummary = extractAssistantSummary(event.messages as any[]) || "Scheduled run completed.";

    schedule.lastCompletedAt = completedAt;
    schedule.lastDurationMs = run.durationMs;
    schedule.lastError = undefined;
    schedule.updatedAt = completedAt;
    if (schedule.mode !== "once" && schedule.status === "completed") {
      schedule.status = "active";
      recomputeSchedule(schedule, completedAt);
    }

    recalculateRunAggregates();
    await saveStore();
    updateStatus(ctx);
  });

  pi.registerCommand("schedule", {
    description: "Create, manage, and report on persistent schedules.",
    getArgumentCompletions: (prefix) => {
      const value = prefix.trimStart();
      const parts = value.split(/\s+/).filter(Boolean);
      if (parts.length <= 1) {
        return SUBCOMMANDS.filter((item) => item.startsWith(parts[0] || "")).map((item) => ({ value: item, label: item }));
      }
      if (["run", "suspend", "resume", "delete", "restore"].includes(parts[0] || "")) {
        return listSchedules(true)
          .filter((item) => item.id.startsWith(parts[1] || ""))
          .map((item) => ({ value: `${parts[0]} ${item.id}`, label: `${parts[0]} ${item.id}`, description: item.name }));
      }
      return null;
    },
    handler: async (args, ctx) => {
      const [subcommand = "list", ...rest] = (args || "").trim().split(/\s+/).filter(Boolean);
      const targetId = rest[0];

      if (!args?.trim() && ctx.mode === "tui") {
        const picked = await ctx.ui.select("Schedule", ["create", "list", "report", "help"]);
        if (!picked) return;
        if (picked === "create") return createScheduleFlow(ctx);
        if (picked === "list") return listSchedulesFlow(ctx);
        if (picked === "report") return generateReport(ctx);
        ctx.ui.notify(usageText(), "info");
        return;
      }

      switch (subcommand) {
        case "create":
          await createScheduleFlow(ctx);
          return;
        case "list":
          await listSchedulesFlow(ctx);
          return;
        case "report":
          await generateReport(ctx);
          return;
        case "run":
          if (!targetId) {
            ctx.ui.notify("Usage: /schedule run <schedule-id>", "error");
            return;
          }
          await manualRunById(ctx, targetId);
          return;
        case "suspend":
          if (!targetId) {
            ctx.ui.notify("Usage: /schedule suspend <schedule-id>", "error");
            return;
          }
          await updateStatusById(ctx, targetId, "suspended");
          return;
        case "resume":
          if (!targetId) {
            ctx.ui.notify("Usage: /schedule resume <schedule-id>", "error");
            return;
          }
          await updateStatusById(ctx, targetId, "active");
          return;
        case "delete":
          if (!targetId) {
            ctx.ui.notify("Usage: /schedule delete <schedule-id>", "error");
            return;
          }
          await updateStatusById(ctx, targetId, "removed");
          return;
        case "restore":
          if (!targetId) {
            ctx.ui.notify("Usage: /schedule restore <schedule-id>", "error");
            return;
          }
          await updateStatusById(ctx, targetId, "active");
          return;
        case "help":
        default:
          ctx.ui.notify(usageText(), "info");
      }
    },
  });
}
