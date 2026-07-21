import { createReadStream } from "node:fs";
import { opendir } from "node:fs/promises";
import { createInterface } from "node:readline";

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const localDate = (year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) => new Date(year, month - 1, day, hour, minute, second, millisecond);
const validLocalDate = (date, parts) => date.getFullYear() === parts.year && date.getMonth() + 1 === parts.month && date.getDate() === parts.day && date.getHours() === parts.hour && date.getMinutes() === parts.minute;

export async function findSessionFiles(root) {
  const files = [];
  async function visit(directory) {
    let handle;
    try { handle = await opendir(directory); } catch { return; }
    for await (const entry of handle) {
      const fullPath = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(fullPath);
    }
  }
  await visit(root);
  return files.sort();
}

function normalizeUsage(value) {
  const cost = value?.cost || {};
  return {
    input: number(value?.input), output: number(value?.output), cacheRead: number(value?.cacheRead), cacheWrite: number(value?.cacheWrite),
    totalTokens: number(value?.totalTokens) || number(value?.input) + number(value?.output) + number(value?.cacheRead) + number(value?.cacheWrite),
    costInput: number(cost.input), costOutput: number(cost.output), costCacheRead: number(cost.cacheRead), costCacheWrite: number(cost.cacheWrite), costTotal: number(cost.total) || number(cost.input) + number(cost.output) + number(cost.cacheRead) + number(cost.cacheWrite)
  };
}

function recordFromEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const timestampFallback = Date.parse(entry.timestamp || "");
  if (entry.type === "message" && entry.message?.usage) {
    const message = entry.message;
    const timestamp = number(message.timestamp) || timestampFallback;
    if (!Number.isFinite(timestamp)) return null;
    if (message.role === "assistant") return { key: message.responseId ? `response:${message.responseId}` : `entry:${entry.id}:${timestamp}:${message.provider}:${message.model}`, provider: String(message.provider || "unknown"), model: String(message.model || "unknown"), timestamp, usage: normalizeUsage(message.usage), source: "assistant" };
    if (message.role === "toolResult") return { key: `nested:${entry.id}:${timestamp}`, provider: String(message.provider || message.details?.provider || "nested"), model: String(message.model || message.details?.model || "unknown"), timestamp, usage: normalizeUsage(message.usage), source: "nested" };
  }
  if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage) {
    if (!Number.isFinite(timestampFallback)) return null;
    return { key: `summary:${entry.id}:${timestampFallback}`, provider: String(entry.provider || "summary"), model: String(entry.model || "unknown"), timestamp: timestampFallback, usage: normalizeUsage(entry.usage), source: entry.type };
  }
  return null;
}

export async function collectUsage(files) {
  const records = [], seen = new Set();
  for (const file of files) {
    let input;
    try { input = createReadStream(file, { encoding: "utf8" }); } catch { continue; }
    const lines = createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.includes('"usage"')) continue;
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        const record = recordFromEntry(entry);
        if (!record || seen.has(record.key)) continue;
        seen.add(record.key); records.push(record);
      }
    } catch { /* Ignore files removed or truncated during the scan. */ }
  }
  return records.sort((a, b) => a.timestamp - b.timestamp);
}

function parseDateToken(token, end) {
  if (!/^\d{6}(?:\d{4})?$/.test(token)) throw new Error(`Invalid date: ${token}. Use YYMMDD or YYMMDDHHmm.`);
  const detailed = token.length === 10;
  const parts = { year: 2000 + Number(token.slice(0, 2)), month: Number(token.slice(2, 4)), day: Number(token.slice(4, 6)), hour: detailed ? Number(token.slice(6, 8)) : end ? 23 : 0, minute: detailed ? Number(token.slice(8, 10)) : end ? 59 : 0 };
  const date = localDate(parts.year, parts.month, parts.day, parts.hour, parts.minute, end ? 59 : 0, end ? 999 : 0);
  if (!validLocalDate(date, parts)) throw new Error(`Invalid calendar date: ${token}.`);
  return { value: date.getTime(), precision: detailed ? "minute" : "day" };
}

function startOfToday(now) { return localDate(now.getFullYear(), now.getMonth() + 1, now.getDate()).getTime(); }
function periodRange(period, now) {
  const end = now.getTime();
  if (period === "today") return { start: startOfToday(now), end, label: `Today (${formatDate(startOfToday(now))} – now)` };
  if (period === "week") { const date = new Date(startOfToday(now)); const day = date.getDay() || 7; date.setDate(date.getDate() - day + 1); return { start: date.getTime(), end, label: `This week (${formatDate(date.getTime())} – now)` }; }
  const start = localDate(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  return { start, end, label: `This month (${formatDate(start)} – now)` };
}

export function parseUsageArgs(raw, now = new Date()) {
  const tokens = raw.trim() ? raw.trim().split(/\s+/) : [];
  let exportType = null;
  if (["--md", "--html"].includes(tokens.at(-1)?.toLowerCase())) exportType = tokens.pop().slice(2).toLowerCase();
  if (tokens.some((token) => ["--md", "--html"].includes(token.toLowerCase()))) throw new Error("--md or --html must be the final argument.");
  let model = null;
  if (tokens[0]?.startsWith("@")) { model = tokens.shift().slice(1).trim(); if (!model) throw new Error("A model name must follow @."); }
  if (tokens.length === 1 && tokens[0].toLowerCase() === "models") { if (model) throw new Error("/usage models does not accept a model filter."); return { mode: "models", model: null, exportType, start: -Infinity, end: Infinity, label: "All recorded usage" }; }
  if (tokens.length === 0) return { mode: "usage", model, exportType, ...periodRange("today", now) };
  if (tokens.length === 1 && ["today", "week", "month"].includes(tokens[0].toLowerCase())) return { mode: "usage", model, exportType, ...periodRange(tokens[0].toLowerCase(), now) };
  if (tokens.length === 2) {
    const start = parseDateToken(tokens[0], false), end = parseDateToken(tokens[1], true);
    if (start.precision !== end.precision) throw new Error("Both dates must use the same precision.");
    if (start.value > end.value) throw new Error("The start date must not be after the end date.");
    return { mode: "usage", model, exportType, start: start.value, end: end.value, label: `${formatDateTime(start.value, start.precision)} – ${formatDateTime(end.value, end.precision)}` };
  }
  throw new Error("Usage: /usage [@model] [today|week|month|YYMMDD YYMMDD|YYMMDDHHmm YYMMDDHHmm] [--md|--html]");
}

const modelKey = (provider, model) => `${provider}/${model}`;
const matchesModel = (record, filter) => !filter || record.model.toLowerCase() === filter.toLowerCase() || modelKey(record.provider, record.model).toLowerCase() === filter.toLowerCase();
export function aggregateUsage(records, query, availableModels = []) {
  const rows = new Map();
  const ensure = (provider, model) => {
    const key = modelKey(provider, model);
    if (!rows.has(key)) rows.set(key, { key, provider, model, available: false, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costInput: 0, costOutput: 0, costCacheRead: 0, costCacheWrite: 0, costTotal: 0, firstUsed: null, lastUsed: null });
    return rows.get(key);
  };
  if (query.mode === "models" || query.model) for (const model of availableModels) { const row = ensure(String(model.provider), String(model.id)); row.available = true; }
  for (const record of records) {
    if (record.timestamp < query.start || record.timestamp > query.end || !matchesModel(record, query.model)) continue;
    const row = ensure(record.provider, record.model), usage = record.usage;
    row.requests++; row.input += usage.input; row.output += usage.output; row.cacheRead += usage.cacheRead; row.cacheWrite += usage.cacheWrite; row.totalTokens += usage.totalTokens; row.costInput += usage.costInput; row.costOutput += usage.costOutput; row.costCacheRead += usage.costCacheRead; row.costCacheWrite += usage.costCacheWrite; row.costTotal += usage.costTotal; row.firstUsed = row.firstUsed === null ? record.timestamp : Math.min(row.firstUsed, record.timestamp); row.lastUsed = row.lastUsed === null ? record.timestamp : Math.max(row.lastUsed, record.timestamp);
  }
  let result = [...rows.values()];
  if (query.mode !== "models") result = result.filter((row) => row.requests > 0 || (query.model && (row.model.toLowerCase() === query.model.toLowerCase() || row.key.toLowerCase() === query.model.toLowerCase())));
  return result.sort((a, b) => b.costTotal - a.costTotal || b.totalTokens - a.totalTokens || a.key.localeCompare(b.key));
}

export function totals(rows) { return rows.reduce((sum, row) => { for (const key of ["requests", "input", "output", "cacheRead", "cacheWrite", "totalTokens", "costInput", "costOutput", "costCacheRead", "costCacheWrite", "costTotal"]) sum[key] += row[key]; return sum; }, { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costInput: 0, costOutput: 0, costCacheRead: 0, costCacheWrite: 0, costTotal: 0 }); }
export const formatInteger = (value) => Math.round(value).toLocaleString("en-US");
export const formatCost = (value) => `$${value < 0.01 ? value.toFixed(6) : value.toFixed(4)}`;
export function formatDate(timestamp) { return new Date(timestamp).toLocaleDateString("en-CA"); }
export function formatDateTime(timestamp, precision = "minute") { const date = new Date(timestamp); return precision === "day" ? formatDate(timestamp) : `${formatDate(timestamp)} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`; }
const escapeMd = (value) => String(value).replace(/\|/g, "\\|");
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export function formatMarkdown(report) {
  const total = totals(report.rows), generated = new Date(report.generatedAt).toLocaleString();
  const lines = [`# Pi Usage Report`, "", `- **Period:** ${report.label}`, `- **Model filter:** ${report.model ? `\`${escapeMd(report.model)}\`` : "All models"}`, `- **Generated:** ${generated}`, `- **Session files scanned:** ${report.fileCount}`, "", "| Model | Available | Requests | Input | Output | Cache read | Cache write | Total tokens | Cost |", "|---|:---:|---:|---:|---:|---:|---:|---:|---:|"];
  for (const row of report.rows) lines.push(`| ${escapeMd(row.key)} | ${row.available ? "Yes" : "—"} | ${formatInteger(row.requests)} | ${formatInteger(row.input)} | ${formatInteger(row.output)} | ${formatInteger(row.cacheRead)} | ${formatInteger(row.cacheWrite)} | ${formatInteger(row.totalTokens)} | ${formatCost(row.costTotal)} |`);
  lines.push(`| **Total** |  | **${formatInteger(total.requests)}** | **${formatInteger(total.input)}** | **${formatInteger(total.output)}** | **${formatInteger(total.cacheRead)}** | **${formatInteger(total.cacheWrite)}** | **${formatInteger(total.totalTokens)}** | **${formatCost(total.costTotal)}** |`, "", report.rows.length ? "" : "_No matching usage records._", "");
  return lines.join("\n");
}

export function formatHtml(report) {
  const total = totals(report.rows), body = report.rows.map((row) => `<tr><td>${escapeHtml(row.key)}</td><td>${row.available ? "Yes" : "—"}</td><td>${formatInteger(row.requests)}</td><td>${formatInteger(row.input)}</td><td>${formatInteger(row.output)}</td><td>${formatInteger(row.cacheRead)}</td><td>${formatInteger(row.cacheWrite)}</td><td>${formatInteger(row.totalTokens)}</td><td>${formatCost(row.costTotal)}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pi Usage Report</title><style>:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}body{max-width:1400px;margin:40px auto;padding:0 24px;background:#111;color:#eee}h1{margin-bottom:4px}.meta{color:#aaa;margin-bottom:24px}.card{overflow:auto;border:1px solid #333;border-radius:10px}table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{padding:10px 12px;border-bottom:1px solid #2b2b2b;text-align:right}th{position:sticky;top:0;background:#1c1c1c;color:#9fb5ff}th:first-child,td:first-child{text-align:left}tfoot{font-weight:800;background:#181818}@media(prefers-color-scheme:light){body{background:#f6f7f5;color:#171917}.meta{color:#667}.card{border-color:#d8dcd8}th{background:#eef1ee;color:#2859d8}th,td{border-color:#dde1dd}tfoot{background:#f0f2f0}}</style></head><body><h1>Pi Usage Report</h1><div class="meta">${escapeHtml(report.label)} · ${report.model ? `Model: ${escapeHtml(report.model)} · ` : ""}${report.fileCount} session files · Generated ${escapeHtml(new Date(report.generatedAt).toLocaleString())}</div><div class="card"><table><thead><tr><th>Model</th><th>Available</th><th>Requests</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th><th>Total tokens</th><th>Cost</th></tr></thead><tbody>${body || '<tr><td colspan="9">No matching usage records.</td></tr>'}</tbody><tfoot><tr><td>Total</td><td></td><td>${formatInteger(total.requests)}</td><td>${formatInteger(total.input)}</td><td>${formatInteger(total.output)}</td><td>${formatInteger(total.cacheRead)}</td><td>${formatInteger(total.cacheWrite)}</td><td>${formatInteger(total.totalTokens)}</td><td>${formatCost(total.costTotal)}</td></tr></tfoot></table></div></body></html>`;
}
