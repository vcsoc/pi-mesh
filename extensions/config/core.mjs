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
async function entry(root, kind, name, source) {
  const files = kind === "extension" ? [join(source, "index.ts"), join(source, "package.json")] : [join(source, "SKILL.md")];
  const hashes = []; for (const file of files) { const hash = await digest(file); if (hash) hashes.push(hash); }
  let modified = null; try { modified = (await stat(files[0])).mtimeMs; } catch {}
  return { kind, name, source, present: hashes.length > 0, hash: hashes.join(":"), modified };
}
async function scanExtensions(root, kind) { const base = join(root, "extensions"), result = []; for (const name of await directories(base)) result.push(await entry(root, "extension", name, join(base, name))); return result; }
async function scanSkills(root, project = false) {
  const result = [], base = join(root, "skills");
  for (const name of await directories(base)) { const item = await entry(root, "skill", name, join(base, name)); if (item.present) result.push(item); }
  if (!project) for (const pack of await directories(join(root, "packages"))) for (const name of await directories(join(root, "packages", pack, "skills"))) { const item = await entry(root, "skill", name, join(root, "packages", pack, "skills", name)); if (item.present && !result.some((x) => x.name === name)) result.push(item); }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
export async function scanConfig(projectRoot, globalRoot) {
  const [projectExtensions, globalExtensions, projectSkills, globalSkills] = await Promise.all([scanExtensions(projectRoot), scanExtensions(globalRoot), scanSkills(projectRoot, true), scanSkills(globalRoot)]);
  const rows = [];
  for (const kind of ["extension", "skill"]) {
    const left = (kind === "extension" ? projectExtensions : projectSkills), right = (kind === "extension" ? globalExtensions : globalSkills), names = new Set([...left, ...right].map((x) => x.name));
    for (const name of [...names].sort()) {
      const project = left.find((x) => x.name === name), global = right.find((x) => x.name === name), key = `${kind}:${name}`;
      let status = project && global ? (project.hash === global.hash ? "identical" : "different") : project ? "project-only" : "global-only";
      const recommendation = BEST.get(key) || (status === "project-only" ? "project" : "global");
      rows.push({ kind, name, status, recommendation, projectPath: project?.source || "—", globalPath: global?.source || "—", projectHash: project?.hash || "—", globalHash: global?.hash || "—" });
    }
  }
  return { generatedAt: Date.now(), projectRoot: resolve(projectRoot), globalRoot: resolve(globalRoot), rows };
}
export function summary(report) { return { total: report.rows.length, identical: report.rows.filter((r) => r.status === "identical").length, different: report.rows.filter((r) => r.status === "different").length, projectOnly: report.rows.filter((r) => r.status === "project-only").length, globalOnly: report.rows.filter((r) => r.status === "global-only").length }; }
const md = (v) => String(v).replace(/\|/g, "\\|");
const html = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function formatMarkdown(report) { const s = summary(report), lines = [`# Pi Configuration Comparison`, ``, `- **Project:** \`${md(report.projectRoot)}\``, `- **Harness:** \`${md(report.globalRoot)}\``, `- **Generated:** ${new Date(report.generatedAt).toLocaleString()}`, `- **Summary:** ${s.total} entries; ${s.identical} identical, ${s.different} different, ${s.projectOnly} project-only, ${s.globalOnly} harness-only.`, ``, `| Kind | Name | Status | Keep | Project path | Harness path |`, `|---|---|---|---|---|---|`]; for (const r of report.rows) lines.push(`| ${r.kind} | ${md(r.name)} | ${r.status} | **${r.recommendation}** | \`${md(r.projectPath)}\` | \`${md(r.globalPath)}\` |`); return lines.join("\n") + "\n"; }
export function formatHtml(report) { const s = summary(report), body = report.rows.map((r) => `<tr class="keep-${r.recommendation}"><td>${r.kind}</td><td>${html(r.name)}</td><td>${r.status}</td><td><b>${r.recommendation}</b></td><td><code>${html(r.projectPath)}</code></td><td><code>${html(r.globalPath)}</code></td></tr>`).join(""); return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pi Configuration Comparison</title><style>body{font:14px system-ui;margin:2rem;background:#111;color:#eee}table{border-collapse:collapse;width:100%;background:#181818}th,td{padding:8px;border:1px solid #444;text-align:left;vertical-align:top}th{color:#9fb5ff}.keep-project,.keep-global{color:#79e28a}code{overflow-wrap:anywhere}a{color:#9fb5ff}</style></head><body><h1>Pi Configuration Comparison</h1><p>${html(report.projectRoot)} ↔ ${html(report.globalRoot)} · ${s.total} entries; ${s.identical} identical, ${s.different} different, ${s.projectOnly} project-only, ${s.globalOnly} harness-only.</p><table><thead><tr><th>Kind</th><th>Name</th><th>Status</th><th>Keep</th><th>Project path</th><th>Harness path</th></tr></thead><tbody>${body}</tbody></table></body></html>`; }
export const recommendedPath = (row) => row.recommendation === "project" ? row.projectPath : row.globalPath;
export const formatTable = (report) => { const headers = ["KIND", "NAME", "STATUS", "KEEP", "PATH"]; const rows = report.rows.map((r) => [r.kind, r.name, r.status, r.recommendation, recommendedPath(r)]); const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length))); const line = (r) => r.map((v, i) => v.padEnd(widths[i])).join("  "); return [line(headers), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n"); };
