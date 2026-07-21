import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatHtml, formatMarkdown, formatTable, scanConfig, summary } from "../core.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-config-")), project = join(root, "project"), global = join(root, "global");
  await mkdir(join(project, "extensions", "same"), { recursive: true }); await mkdir(join(global, "extensions", "same"), { recursive: true });
  await mkdir(join(project, "extensions", "project-only"), { recursive: true }); await mkdir(join(global, "extensions", "global-only"), { recursive: true });
  await mkdir(join(project, "skills", "same-skill"), { recursive: true }); await mkdir(join(global, "skills", "same-skill"), { recursive: true });
  await writeFile(join(project, "extensions", "same", "index.ts"), "export default () => {};" ); await writeFile(join(global, "extensions", "same", "index.ts"), "export default () => {};" );
  await writeFile(join(project, "extensions", "project-only", "index.ts"), "x"); await writeFile(join(global, "extensions", "global-only", "index.ts"), "x");
  await writeFile(join(project, "skills", "same-skill", "SKILL.md"), "# same"); await writeFile(join(global, "skills", "same-skill", "SKILL.md"), "# changed");
  return { project, global };
}
test("lists every instance and marks one winner per resource", async () => { const report = await scanConfig(...Object.values(await fixture())); const s = summary(report); assert.equal(s.total, 6); assert.equal(s.kept, 4); assert.equal(s.removed, 2); assert.equal(report.rows.filter((row) => row.action === "remove").length, 2); assert.ok(report.rows.every((row) => row.path.startsWith("/"))); });
test("escapes report output", async () => { const report = await scanConfig(...Object.values(await fixture())); report.rows[0].name = "<unsafe>|name"; assert.match(formatMarkdown(report), /\\\|/); assert.match(formatHtml(report), /&lt;unsafe&gt;/); assert.match(formatHtml(report), /class="keep"/); assert.match(formatHtml(report), /class="remove"/); assert.match(formatTable(report), /ACTION/); });
