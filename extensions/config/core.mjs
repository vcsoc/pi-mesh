import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const BEST = new Map([
  ["extension:auto-lint", "global"], ["extension:prompt-history", "global"],
  ["extension:gitnexus-mcp", "global"], ["extension:git-hud", "project"],
  ["extension:work-controller", "project"], ["extension:goal", "project"],
  ["skill:testit", "global"], ["skill:goal", "project"],
]);
const safeRead = async (path) => { try { return await readFile(path); } catch { return null; } };
async function digest(path) { const data = await safeRead(path); return data ? createHash("sha256").update(data).digest("hex").slice(0, 12) : null; }
async function directories(path) { try { return (await readdir(path, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return []; } }
async function entry(kind, name, source, scope, origin = scope) {
  const files = kind === "extension" ? [join(source, "index.ts"), join(source, "index.js"), join(source, "package.json")] : [join(source, "SKILL.md")];
  const hashes = []; for (const file of files) { const hash = await digest(file); if (hash) hashes.push(hash); }
  let modified = null; try { modified = (await stat(files[0])).mtimeMs; } catch {}
  return { kind, name, source, scope, origin, present: hashes.length > 0, hash: hashes.join(":"), modified };
}
async function scanExtensions(root, scope) { const base = join(root, "extensions"), result = []; for (const name of await directories(base)) { const item = await entry("extension", name, join(base, name), scope); if (item.present) result.push(item); } return result; }
async function scanSkills(root, scope, includePackages = false) {
  const result = [], base = join(root, "skills");
  for (const name of await directories(base)) { const item = await entry("skill", name, join(base, name), scope, "skills"); if (item.present) result.push(item); }
  if (includePackages) for (const pack of await directories(join(root, "packages"))) for (const name of await directories(join(root, "packages", pack, "skills"))) { const item = await entry("skill", name, join(root, "packages", pack, "skills", name), scope, `package:${pack}`); if (item.present) result.push(item); }
  return result;
}
function buildRows(kind, project, global) {
  const groups = new Map();
  for (const item of [...project, ...global]) { if (!groups.has(item.name)) groups.set(item.name, []); groups.get(item.name).push(item); }
  const rows = [];
  for (const [name, instances] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const key = `${kind}:${name}`, preferredScope = BEST.get(key) || (instances.some((item) => item.scope === "global") ? "global" : "project");
    const preferred = instances.filter((item) => item.scope === preferredScope), winner = preferred[0] || instances[0];
    const scopes = new Set(instances.map((item) => item.scope)), hashes = new Set(instances.map((item) => item.hash));
    const status = scopes.size === 1 ? `${preferredScope}-only` : hashes.size === 1 ? "identical" : "different";
    for (const item of instances) rows.push({ kind, name, scope: item.scope, origin: item.origin, path: item.source, hash: item.hash || "—", modified: item.modified, status, action: item === winner ? "keep" : "remove", keepPath: winner.source, reason: item === winner ? (instances.length === 1 ? "only instance" : "recommended instance") : "duplicate or superseded instance" });
  }
  return rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || (a.action === "keep" ? -1 : 1) || a.path.localeCompare(b.path));
}
export async function scanConfig(projectRoot, globalRoot) {
  const [projectExtensions, globalExtensions, projectSkills, globalSkills] = await Promise.all([scanExtensions(projectRoot, "project"), scanExtensions(globalRoot, "global"), scanSkills(projectRoot, "project"), scanSkills(globalRoot, "global", true)]);
  const rows = [...buildRows("extension", projectExtensions, globalExtensions), ...buildRows("skill", projectSkills, globalSkills)];
  return { generatedAt: Date.now(), projectRoot: resolve(projectRoot), globalRoot: resolve(globalRoot), rows };
}
export function summary(report) {
  return {
    total: report.rows.length,
    kept: report.rows.filter((r) => r.action === "keep").length,
    removed: report.rows.filter((r) => r.action === "remove").length,
    identical: report.rows.filter((r) => r.status === "identical").length,
    different: report.rows.filter((r) => r.status === "different").length,
    projectOnly: report.rows.filter((r) => r.status === "project-only").length,
    globalOnly: report.rows.filter((r) => r.status === "global-only").length,
  };
}
const md = (v) => String(v).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
const html = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function formatMarkdown(report) {
  const s = summary(report), lines = [`# Pi Configuration Inventory`, ``, `- **Project:** \`${md(report.projectRoot)}\``, `- **Harness:** \`${md(report.globalRoot)}\``, `- **Generated:** ${new Date(report.generatedAt).toLocaleString()}`, `- **Summary:** ${s.total} instances; **${s.kept} keep**, **${s.removed} remove**; ${s.identical} identical, ${s.different} different.`, ``, `| Kind | Name | Scope | Action | Origin | Path | Hash | Comparison |`, `|---|---|---|---|---|---|---|---|`];
  for (const r of report.rows) lines.push(`| ${r.kind} | ${md(r.name)} | ${r.scope} | **${r.action.toUpperCase()}** | ${md(r.origin)} | \`${md(r.path)}\` | \`${md(r.hash)}\` | ${r.status} |`);
  return lines.join("\n") + "\n";
}
export function formatHtml(report) {
  const s = summary(report), body = report.rows.map((r) => `<tr class="${r.action === "keep" ? "keep" : "remove"}"><td>${r.kind}</td><td>${html(r.name)}</td><td>${r.scope}</td><td><b>${r.action.toUpperCase()}</b></td><td>${html(r.origin)}</td><td><code>${html(r.path)}</code></td><td><code>${html(r.hash)}</code></td><td>${r.status}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pi Configuration Inventory</title><style>body{font:14px system-ui;margin:2rem;background:#111;color:#eee}table{border-collapse:collapse;width:100%;background:#181818}th,td{padding:8px;border:1px solid #444;text-align:left;vertical-align:top}th{color:#9fb5ff}.keep{color:#79e28a}.remove{color:#777}code{overflow-wrap:anywhere}</style></head><body><h1>Pi Configuration Inventory</h1><p>${html(report.projectRoot)} ↔ ${html(report.globalRoot)} · ${s.total} instances · <strong>${s.kept} keep</strong> · ${s.removed} remove.</p><table><thead><tr><th>Kind</th><th>Name</th><th>Scope</th><th>Action</th><th>Origin</th><th>Path</th><th>Hash</th><th>Comparison</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
}
export const recommendedPath = (row) => row.keepPath;
export const formatTable = (report) => {
  const headers = ["KIND", "NAME", "SCOPE", "ACTION", "PATH"], rows = report.rows.map((r) => [r.kind, r.name, r.scope, r.action, r.path]);
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length))), line = (r) => r.map((v, i) => v.padEnd(widths[i])).join("  ");
  return [line(headers), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
};
