// Real isolated HTTP services; synthetic catalogs only. No model or gateway calls.
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { policyMarkdown } from "../security/policy-schema.mjs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const free = async () => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
};
const wait = async (fn) => {
  for (let i = 0; i < 100; i++) {
    try {
      if (await fn()) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error("Fixture readiness timeout");
};
const root = mkdtempSync(join(tmpdir(), "security-management-web-"));
const project = join(root, "project");
mkdirSync(project);
const canonical = realpathSync(project);
const token = "a".repeat(64),
  headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
const meshPort = await free();
const models = [
  { id: "fixture/one", name: "One", thinkingLevels: ["off", "low"] },
  {
    id: "other/two",
    name: "Two <img src=x onerror=unsafe()>",
    thinkingLevels: ["off", "high"],
  },
];
const config = join(root, "mesh-config.json");
writeFileSync(
  config,
  JSON.stringify({
    host: "127.0.0.1",
    port: meshPort,
    token,
    dataDir: join(root, "mesh"),
  }),
);
const mesh = spawn(
  process.execPath,
  [
    new URL("../broker.mjs", import.meta.url).pathname,
    config,
  ],
  { stdio: "ignore" },
);
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  await wait(() =>
    fetch(`http://127.0.0.1:${meshPort}/health`).then((r) => r.ok),
  );
  const projectHash = createHash("sha256")
    .update("agent-mesh-project\0" + canonical)
    .digest("hex");
  const registration = {
    agentId: "agent-a",
    requestedName: "Alpha",
    cwd: canonical,
    projectHash,
    configSupport: true,
    model: "fixture/one",
    thinkingLevel: "off",
    modelCatalog: models.map((m) => ({ id: m.id, levels: m.thinkingLevels })),
  };
  const postMesh = (body) =>
    fetch(`http://127.0.0.1:${meshPort}/api/register`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  assert.equal((await postMesh(registration)).status, 200);
  for (const [product, port, cookie] of [
    ["mesh", meshPort, "mesh_session"],
  ]) {
    const base = `http://127.0.0.1:${port}`,
      context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
    await context.addCookies([
      {
        name: cookie,
        value: token,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
    const page = await context.newPage(),
      errors = [];
    let acceptDialogs = true;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) =>
      acceptDialogs ? dialog.accept() : dialog.dismiss(),
    );
    await page.goto(base);
    await page.locator("#security-workbench-open").click();
    await page.waitForFunction(() =>
      document.querySelector("#mw-state").textContent.includes("Draft loaded"),
    );
    assert.match(
      await page.locator("#security-workbench").textContent(),
      /Not enforced by this extension/,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Apply enforcement — unavailable" })
        .isDisabled(),
      true,
    );
    assert.equal((await fetch(base + "/api/security/draft")).status, 401);
    const denied = await fetch(base + "/api/security/draft", {
      method: "POST",
      headers: { ...headers, Origin: "https://evil.invalid" },
      body: JSON.stringify({
        scope: "",
        markdown: "bad",
        baseRevision: null,
        confirm: true,
      }),
    });
    assert.equal(denied.status, 403);
    await page.locator("#mw-add").click();
    assert.equal(await page.locator("#mw-save").isDisabled(), true);
    const host = page.getByRole("combobox", {
      name: "Rule 1 host",
      exact: true,
    });
    await host.fill("api.open");
    await host.press("ArrowDown");
    await host.press("Enter");
    assert.equal(await host.inputValue(), "api.openai.com");
    await page.locator('#mw-rules input[value="POST"]').check();
    const paths = page.getByRole("combobox", {
      name: "Rule 1 paths",
      exact: true,
    });
    await paths.fill("/v1/res");
    await paths.press("ArrowDown");
    await paths.press("Enter");
    assert.equal(await paths.inputValue(), "/v1/responses");
    await paths.press("ArrowDown");
    await paths.press("Escape");
    assert.equal(await page.locator("#security-workbench").isVisible(), true);
    await page.locator("#mw-validate").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#mw-state")
        .textContent.includes("Server validation passed"),
    );
    await page.locator("#mw-save").click();
    await page.waitForFunction(() =>
      document.querySelector("#mw-state").textContent.includes("Draft saved"),
    );
    const first = await fetch(base + "/api/security/draft", { headers }).then(
      (r) => r.json(),
    );
    assert.equal(first.canApply, false);
    assert.equal(first.draftOnly, true);
    assert.equal(
      first.policy.network_policies.approved_0.endpoints[0].enforcement,
      "enforce",
    );
    const conflict = await fetch(base + "/api/security/draft", {
      method: "POST",
      headers,
      body: JSON.stringify({
        scope: "",
        markdown: first.markdown,
        baseRevision: null,
        confirm: true,
      }),
    });
    assert.equal(conflict.status, 409);
    await page
      .locator("#mw-markdown")
      .fill(
        first.markdown.replace('"schemaVersion": 1', '"schemaVersion": 999'),
      );
    await page.locator("#mw-import-text").click();
    assert.match(
      await page.locator("#mw-errors").textContent(),
      /unsupported schema/,
    );
    assert.equal(await page.locator("#mw-save").isDisabled(), true);
    const imported =
      policyMarkdown({ schemaVersion: 1, workspace: "read-only", egress: [] }) +
      '\n<img src=x onerror="window.badImport=true">\n';
    await page
      .locator("#mw-import-file")
      .setInputFiles({
        name: "proposal.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(imported),
      });
    await page.waitForFunction(() =>
      document.querySelector("#mw-markdown").value.includes("badImport"),
    );
    assert.equal(await page.evaluate(() => window.badImport), undefined);
    assert.equal(await page.locator("#security-workbench img").count(), 0);
    acceptDialogs = false;
    await page.locator("#mw-close").click();
    assert.equal(await page.locator("#security-workbench").isVisible(), true);
    acceptDialogs = true;
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#mw-export").click();
    assert.equal(
      (await downloadPromise).suggestedFilename(),
      "openshell-policy-draft.md",
    );
    await page.locator("#mw-save").click();
    await page.waitForFunction(() =>
      document.querySelector("#mw-state").textContent.includes("Draft saved"),
    );
    await page.locator("#mw-history").selectOption(first.revision);
    await page.waitForFunction(() =>
      document
        .querySelector("#mw-state")
        .textContent.includes("Historical proposal"),
    );
    assert.equal(await page.locator("#mw-rules fieldset").count(), 1);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page
        .locator("#security-workbench")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
      "narrow policy dialog does not overflow horizontally",
    );
    await page.screenshot({
      path: `/tmp/${product}-security-management.png`,
      fullPage: true,
    });
    await page.locator("#mw-close").click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    {
      await postMesh(registration); // refresh availability without generation
      await page.locator("#agent-settings-open").click();
      await page.waitForFunction(
        () => !document.querySelector("#agent-config-model").disabled,
      );
      const provider = page.getByRole("combobox", {
        name: "Search Provider",
        exact: true,
      });
      await provider.fill("other");
      await provider.press("ArrowDown");
      await provider.press("Enter");
      const model = page.locator("#agent-config-model");
      await model.fill("two");
      await model.press("ArrowDown");
      await model.press("Enter");
      assert.equal(await model.inputValue(), "other/two");
      await page.locator("#agent-config-thinking").selectOption("high");
      await page.locator("#agent-config-reviewed").check();
      await page.locator("#agent-config-form button[type=submit]").click();
      await page.waitForFunction(() =>
        document
          .querySelector("#agent-config-status")
          .textContent.includes("Waiting"),
      );
    }
    assert.deepEqual(errors, [], product + " browser errors");
    await context.close();
  }
  console.log(
    "PASS: isolated real HTTP Mesh management UI — authenticated revisioned drafts, conflict rejection, shared validation, keyboard autocomplete, import/export, XSS/dirty guards, responsive layouts and exact agent configuration; no inference or gateway mutation.",
  );
} finally {
  await browser.close();
  if (mesh.exitCode === null) {
    mesh.kill("SIGTERM");
    await once(mesh, "exit");
  }
  rmSync(root, { recursive: true, force: true });
}
