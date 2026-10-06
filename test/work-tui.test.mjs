import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  existsSync,
  realpathSync,
  readFileSync,
  mkdtempSync,
  rmSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { teamWorkRequest } from "../team-work.mjs";
import { workflowReviewLines } from "../work-review.mjs";
import { compileWorkflow, loadProfiles } from "../workflow.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function sdkRoot() {
  if (process.env.PI_SDK_ROOT) return process.env.PI_SDK_ROOT;
  let file;
  try {
    file = createRequire(import.meta.url).resolve(
      "@earendil-works/pi-coding-agent",
    );
  } catch {
    file = realpathSync(
      execFileSync("volta", ["which", "pi"], { encoding: "utf8" }).trim(),
    );
  }
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
    const pkg = join(dir, "package.json");
    if (
      existsSync(pkg) &&
      JSON.parse(readFileSync(pkg, "utf8")).name ===
        "@earendil-works/pi-coding-agent"
    )
      return dir;
  }
  throw new Error("Set PI_SDK_ROOT to the installed Pi package");
}
const sdk = sdkRoot(),
  tuiPath = join(sdk, "node_modules/@earendil-works/pi-tui/dist/index.js");
const { createJiti } = await import(
  pathToFileURL(join(sdk, "node_modules/jiti/lib/jiti.mjs")).href
);
const { visibleWidth } = await import(pathToFileURL(tuiPath).href);
const loader = createJiti(import.meta.url, {
  alias: {
    "@earendil-works/pi-tui": tuiPath,
    "@earendil-works/pi-coding-agent": join(sdk, "dist/index.js"),
    "@earendil-works/pi-ai": join(
      sdk,
      "node_modules/@earendil-works/pi-ai/dist/index.js",
    ),
    typebox: join(sdk, "node_modules/typebox/build/index.mjs"),
  },
});
const { workPicker, reviewWork, editTeamRequest } = await loader.import(
  join(root, "work-tui.ts"),
);
const { meshPanel } = await loader.import(join(root, "mesh-panel.ts"));
const { simpleTeam, simpleProposal } = await loader.import(
  join(root, "simple-team.ts"),
);
const theme = { fg: (_c, s) => s };
function screen(ctx = {}) {
  let component,
    closed = false;
  const tui = { terminal: { rows: 24 }, requestRender() {} };
  return {
    ctx: {
      mode: "tui",
      hasUI: true,
      ui: {
        custom: async (factory) =>
          new Promise((done) => {
            component = factory(tui, theme, {}, (value) => {
              closed = true;
              component?.dispose?.();
              done(value);
            });
            component.focused = true;
          }),
        ...ctx,
      },
    },
    tui,
    get component() {
      return component;
    },
    get closed() {
      return closed;
    },
  };
}
const options = (home) => {
  const profiles = loadProfiles(home, home);
  return {
    profiles,
    currentModel: "fixture/one",
    models: ["fixture/one", "fixture/two"],
    validate: (definition) =>
      compileWorkflow(definition, profiles, {
        activeTools: ["read", "bash", "edit", "write"],
        currentModel: "fixture/one",
        availableModels: ["fixture/one", "fixture/two"],
        agentDir: home,
      }),
  };
};
const summary = {
  project: "/safe/project",
  isolation: "shared",
  background: true,
  thinkingLevel: "off",
  limits: {
    spawns: 4,
    tokens: 20000,
    concurrency: 1,
    estimatedCost: 2,
    childDeadlineMs: 1000,
  },
  steps: [
    {
      parallel: false,
      retries: 0,
      tasks: [
        {
          id: "build",
          role: "developer",
          lane: "main",
          model: "fixture/one",
          tools: ["read", "edit"],
          task: "Inspect 漢字 🌟 safely\x1b]52;c;bad\x07",
          acceptance: [
            {
              type: "json",
              required: ["verdict"],
              equals: { verdict: "pass" },
            },
          ],
        },
      ],
    },
  ],
};

test("team builder is deterministic and bounded; compiler resolves exact profiles/models and preserves gates", () => {
  const home = mkdtempSync(join(tmpdir(), "mesh-team-schema-"));
  try {
    const input = teamWorkRequest("Fix tests");
    assert.deepEqual(input, teamWorkRequest("Fix tests"));
    const plan = options(home).validate(input.definition);
    assert.equal(plan.maxCost, 10);
    assert.equal(plan.stages.length, 4);
    assert.equal(plan.isolation, "worktree");
    assert.deepEqual(
      plan.stages.slice(1).map((s) => s.tasks[0].acceptance[0].equals),
      [{ verdict: "pass" }, { verdict: "pass" }, { verdict: "pass" }],
    );
    assert.throws(() => teamWorkRequest(" "));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("native picker filters, preserves focus, handles Unicode/narrow resize and cancels safely", async () => {
  const f = screen();
  const result = workPicker(f.ctx, "Choose\x1b[31m model", [
    { value: "one", label: "Other model" },
    { value: "two", label: "模型 fixture two" },
  ]);
  const c = f.component;
  assert.equal(c.focused, true);
  c.handleInput("fixture");
  assert.match(c.render(50).join("\n"), /fixture two/);
  assert.doesNotMatch(c.render(50).join("\n"), /Other model/);
  f.tui.terminal.rows = 12;
  const rows = c.render(22);
  assert.ok(rows.length <= 12);
  for (const row of rows) assert.ok(visibleWidth(row) <= 22);
  c.handleInput("\r");
  assert.equal(await result, "two");
  const cancelled = workPicker(f.ctx, "Again", [
    { value: "one", label: "One" },
  ]);
  f.component.handleInput("\x1b");
  assert.equal(await cancelled, undefined);
});

test("readable review defaults to cancel/back, scrolls, requires deliberate action and supports abort/RPC", async () => {
  let f = screen(),
    result = reviewWork(f.ctx, summary);
  const text = f.component.render(80).join("\n");
  assert.match(text, /NOT integrated/);
  assert.doesNotMatch(text, /\x1b\]|\x07/);
  f.component.handleInput("\r");
  assert.equal(await result, "cancel");
  f = screen();
  result = reviewWork(f.ctx, summary, undefined, true);
  f.component.handleInput("\r");
  assert.equal(await result, "back");
  f = screen();
  result = reviewWork(f.ctx, summary);
  f.component.handleInput("\x1b[6~");
  for (const line of f.component.render(24))
    assert.ok(visibleWidth(line) <= 24);
  f.component.handleInput("\t");
  f.component.handleInput("\r");
  assert.equal(await result, "approve");
  f = screen();
  const abort = new AbortController();
  result = reviewWork(f.ctx, summary, abort.signal);
  abort.abort();
  assert.equal(await result, "cancel");
  assert.equal(
    await reviewWork(
      {
        mode: "rpc",
        hasUI: true,
        ui: {
          confirm: async (_title, message) => {
            assert.match(message, /Exact model: fixture\/one/);
            return false;
          },
        },
      },
      summary,
    ),
    "cancel",
  );
  assert.equal(
    await reviewWork({ mode: "json", hasUI: false }, summary),
    "cancel",
  );
  const continuous = workflowReviewLines({
    ...summary,
    continuation: { untilComplete: true },
    limits: { ...summary.limits, estimatedCost: null },
  }).join("\n");
  assert.match(continuous, /NO TOTAL SPENDING CEILING/);
  assert.match(continuous, /NOT total ceilings/);
});

function scripted(actions, editors = []) {
  const notices = [];
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      notify: (message) => notices.push(message),
      editor: async () => editors.shift(),
      confirm: async () => false,
      custom: async (factory) =>
        new Promise((done, reject) => {
          let component;
          try {
            component = factory(
              { terminal: { rows: 36 }, requestRender() {} },
              theme,
              {},
              done,
            );
            const action = actions.shift();
            assert.ok(action, "Unexpected extra screen");
            if (typeof action === "function") action(component);
            else {
              component.handleInput(action);
              component.handleInput("\r");
            }
          } catch (error) {
            reject(error);
          }
        }),
    },
  };
  return { ctx, notices };
}

test("composer changes exact model/task/budgets without mutating input or dropping acceptance", async () => {
  const home = mkdtempSync(join(tmpdir(), "mesh-team-edit-"));
  try {
    const original = teamWorkRequest("Fix tests"),
      before = structuredClone(original);
    const f = scripted(
      [
        "implement",
        "Exact model",
        "fixture/two",
        "implement",
        "Task instructions",
        "Estimated-cost",
        "Token budget",
        "Review execution",
      ],
      ["Only approved changes", "3", "4000"],
    );
    const result = await editTeamRequest(f.ctx, original, options(home));
    assert.deepEqual(original, before);
    assert.equal(result.definition.stages[1].tasks[0].model, "fixture/two");
    assert.equal(
      result.definition.stages[1].tasks[0].task,
      "Only approved changes",
    );
    assert.equal(result.definition.maxCost, 3);
    assert.equal(result.definition.maxTokens, 4000);
    assert.deepEqual(
      result.definition.stages[1].tasks[0].acceptance,
      original.definition.stages[1].tasks[0].acceptance,
    );
    options(home).validate(result.definition);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("invalid limits cannot proceed, cancel returns no plan, non-TUI never silently approves", async () => {
  const home = mkdtempSync(join(tmpdir(), "mesh-team-invalid-"));
  try {
    const f = scripted(["Token budget", "Review execution", "Cancel"], ["-1"]);
    assert.equal(
      await editTeamRequest(f.ctx, teamWorkRequest("Fix tests"), options(home)),
      undefined,
    );
    assert.ok(f.notices.some((n) => n.includes("token budget")));
    await assert.rejects(
      () =>
        editTeamRequest({ mode: "rpc" }, teamWorkRequest("Fix"), options(home)),
      /requires interactive/,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("team command cancellation and edited review do not launch a runner or create run state", async () => {
  const home = mkdtempSync(join(tmpdir(), "mesh-team-command-")),
    old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = home;
  try {
    const { registerWork } = await loader.import(join(root, "work.ts"));
    const pi = {
      registerTool() {},
      on() {},
      getActiveTools: () => ["read", "bash", "edit", "write"],
      getThinkingLevel: () => "off",
    };
    const command = registerWork(
      pi,
      () => join(home, "state"),
      async () => {},
      () => ({ base: "http://127.0.0.1:9", token: "unused" }),
    );
    const f = scripted([
      (component) => {
        for (let i = 0; i < 4; i++) component.handleInput("\x1b[B");
        component.handleInput("\r");
      },
      "Current project",
      (component) => {
        component.handleInput("\x1b[A");
        component.handleInput("\x1b[A");
        component.handleInput("\r");
      },
      "fixture/two",
      (component) => {
        assert.match(component.render(120).join("\n"), /fixture\/two/);
        component.handleInput("\x1b");
      },
    ]);
    Object.assign(f.ctx, {
      cwd: home,
      model: { provider: "fixture", id: "one" },
      modelRegistry: {
        getAvailable: async () => [
          { provider: "fixture", id: "one" },
          { provider: "fixture", id: "two" },
        ],
      },
      getSystemPrompt: () => "Fixture only",
      sessionManager: { getSessionId: () => "fixture" },
    });
    await command("team Fix tests", f.ctx);
    assert.ok(f.notices.some((n) => n.includes("Team cancelled")));
    assert.equal(existsSync(join(home, "state", "runs")), false);
    assert.equal(
      readdirSync(home).filter((x) => x.endsWith(".jsonl")).length,
      0,
    );
  } finally {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = old;
    rmSync(home, { recursive: true, force: true });
  }
});

test("preflight errors preserve the draft, and adding/removing a worker is explicitly reviewed", async () => {
  const home = mkdtempSync(join(tmpdir(), "mesh-team-preflight-"));
  try {
    const f = scripted(
      [
        "Review execution",
        "Workspace",
        "shared",
        "Add a worker",
        "scout",
        "extra-1",
        "Remove worker",
        "Review execution",
      ],
      ["Inspect only"],
    );
    f.ctx.ui.confirm = async (title) => {
      assert.match(title, /acceptance gates/);
      return true;
    };
    const result = await editTeamRequest(f.ctx, teamWorkRequest("Fix tests"), {
      ...options(home),
      preflight: async (definition) => {
        if (definition.isolation === "worktree")
          throw new Error("Fixture dirty tree — choose deliberately");
      },
    });
    assert.ok(f.notices.some((n) => n.includes("dirty tree")));
    assert.equal(result.definition.isolation, "shared");
    assert.equal(result.definition.stages.length, 4);
    assert.equal(
      result.definition.stages[3].tasks[0].acceptance[0].equals.verdict,
      "pass",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("installed continuation settings are visible, not silently converted, and editable to bounded spending", async () => {
  const home = mkdtempSync(join(tmpdir(), "mesh-team-continuation-"));
  try {
    const input = teamWorkRequest("Fix tests");
    input.definition.untilComplete = true;
    input.definition.maxCost = null;
    const f = scripted([
      (component) => {
        assert.match(
          component.render(120).join("\n"),
          /NO TOTAL SPENDING CEILING/,
        );
        component.handleInput("Continuation");
        component.handleInput("\r");
      },
      "Bounded",
      "Review execution",
    ]);
    const result = await editTeamRequest(f.ctx, input, options(home));
    assert.equal(input.definition.untilComplete, true);
    assert.equal(input.definition.maxCost, null);
    assert.equal(result.definition.untilComplete, false);
    assert.equal(result.definition.maxCost, 10);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("history-style panel has safe Change default, clear actions, width-safe resize and cancellation", async () => {
  const f = screen(),
    rows = [
      {
        id: "task",
        label: "Task",
        value: "漢字 🌟",
        detail: "A bounded request",
      },
      { id: "model", label: "Model", value: "fixture/one" },
    ];
  let pending = meshPanel(f.ctx, "Mesh", rows);
  let rendered = f.component.render(64);
  assert.match(rendered.join("\n"), /╭.*Mesh.*╮/);
  assert.match(rendered.join("\n"), /\[ Change \].*Cancel.*Accept/);
  f.component.handleInput("\r");
  assert.deepEqual(await pending, { action: "change", row: "task" });
  pending = meshPanel(f.ctx, "Mesh", rows);
  f.component.handleInput("\t");
  f.component.handleInput("\t");
  for (const width of [20, 36, 100])
    for (const line of f.component.render(width))
      assert.ok(visibleWidth(line) <= width);
  assert.match(f.component.render(20).join("\n"), /Accept/);
  f.component.handleInput("\x1b[B");
  f.component.handleInput("\r");
  assert.equal((await pending).action, "change", "moving rows disarms Accept");
  pending = meshPanel(f.ctx, "Mesh", rows);
  f.component.handleInput("\x1b");
  assert.equal((await pending).action, "cancel");
});

test("simple proposals use finite bounded defaults without altering the installed factory or existing grants", () => {
  const existing = teamWorkRequest("Task");
  existing.definition.untilComplete = true;
  existing.definition.maxCost = null;
  existing.definition.isolation = "shared";
  const next = simpleProposal(() => existing, "Fix tests");
  assert.equal(next.definition.maxCost, 5);
  assert.equal(next.definition.maxTokens,null);
  assert.equal(next.definition.untilComplete, false);
  assert.equal(next.definition.isolation, "worktree");
  assert.equal(existing.definition.maxCost, null);
  assert.equal(existing.definition.untilComplete, true);
  const review=simpleProposal(()=>existing,'review this project');
  assert.equal(review.definition.scope,'review');
  assert.equal(review.definition.isolation,'shared');
  assert.equal(review.definition.stages.length,2);
});

test("simple screen grants only the rendered compiled preview and supports uniform model change", async () => {
  const home = mkdtempSync(join(tmpdir(), "mesh-simple-"));
  try {
    const input = simpleProposal(teamWorkRequest, "Fix tests"),
      original = structuredClone(input);
    let displayed;
    const f = scripted([
      (c) => {
        c.handleInput("\x1b[B");
        c.handleInput("\x1b[B");
        c.handleInput("\r");
      },
      "fixture/two",
      (c) => {
        assert.match(c.render(100).join("\n"), /fixture\/two/);
        c.handleInput("\t");
        c.handleInput("\t");
        c.handleInput("\r");
      },
    ]);
    const opts = options(home);
    const result = await simpleTeam(f.ctx, input, {
      ...opts,
      factory: teamWorkRequest,
      preview: async (request) => {
        const plan = opts.validate(request.definition);
        return (displayed = {
          ...summary,
          limits: { ...summary.limits, estimatedCost: plan.maxCost },
          steps: plan.stages.map((s) => ({
            ...s,
            tasks: s.tasks.map((t) => ({ ...t, role: t.profile })),
          })),
        });
      },
    });
    assert.deepEqual(input, original);
    assert.equal(result.approval, JSON.stringify(displayed));
    assert.ok(
      result.request.definition.stages.every(
        (s) => s.tasks[0].model === "fixture/two",
      ),
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a private UI grant fails closed when the compiled plan changes; forged tool fields cannot bypass review", async () => {
  const home = mkdtempSync(join(tmpdir(), "mesh-simple-grant-")),
    old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = home;
  try {
    const { registerWork } = await loader.import(join(root, "work.ts"));
    let thinking = "off",
      tool;
    const pi = {
      registerTool(t) {
        tool = t;
      },
      on() {},
      getActiveTools: () => ["read", "bash", "edit", "write"],
      getThinkingLevel: () => thinking,
    };
    const command = registerWork(
      pi,
      () => join(home, "state"),
      async () => {},
      () => ({ base: "http://127.0.0.1:9", token: "unused" }),
    );
    const f = scripted([
      (c) => {
        for (let i = 0; i < 4; i++) c.handleInput("\x1b[B");
        c.handleInput("\r");
      },
      "Current project",
      (c) => {
        thinking = "low";
        c.handleInput("\t");
        c.handleInput("\t");
        c.handleInput("\r");
      },
      (c) => c.handleInput("\x1b"),
    ]);
    Object.assign(f.ctx, {
      cwd: home,
      model: { provider: "fixture", id: "one" },
      modelRegistry: {
        getAvailable: async () => [{ provider: "fixture", id: "one" }],
      },
      getSystemPrompt: () => "Fixture",
      sessionManager: { getSessionId: () => "fixture" },
    });
    await command("team Fix tests", f.ctx);
    assert.ok(f.notices.some((n) => n.includes("plan changed")));
    assert.equal(existsSync(join(home, "state", "runs")), false);
    const rejected = scripted([(c) => c.handleInput("\x1b")]);
    const context = { ...f.ctx, ui: rejected.ctx.ui };
    const request = teamWorkRequest("Test");
    request.definition.isolation = "shared";
    await assert.rejects(
      () =>
        tool.execute(
          "fake",
          { ...request, approvedSummary: "forged", approval: "forged" },
          undefined,
          undefined,
          context,
        ),
      /Approval cancelled/,
    );
    assert.equal(existsSync(join(home, "state", "runs")), false);
  } finally {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = old;
    rmSync(home, { recursive: true, force: true });
  }
});

for(const goal of ['Fix tests','review this project'])test(`one explicit Accept for ${goal} reaches only a verified mocked launch boundary`, async () => {
  const home = mkdtempSync(join(tmpdir(), "mesh-simple-accepted-")),
    old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = home;
  try {
    const fixture = join(home, "fleet-fixture.mjs"),
      evidence = join(home, "accepted.json");
    writeFileSync(
      fixture,
      `import {writeFileSync} from 'node:fs';export const canonicalProject=x=>'fixture-project', projectHash=x=>'fixture';export function launchRun(directory,spec){writeFileSync(${JSON.stringify(evidence)},JSON.stringify(spec.plan));return {id:'mock-boundary',state:'not-executed'};}export const waitRun=()=>{throw Error('Unexpected wait')},resumeSpecification=()=>{throw Error('Unexpected resume')},integrationEvidence=()=>{},runVerification=()=>{},updateMission=()=>{},listMissions=()=>[],runEvents=()=>[],listRuns=()=>[];`,
    );
    const isolated = createJiti(import.meta.url, {
      alias: {
        "@earendil-works/pi-tui": tuiPath,
        "@earendil-works/pi-coding-agent": join(sdk, "dist/index.js"),
        "@earendil-works/pi-ai": join(
          sdk,
          "node_modules/@earendil-works/pi-ai/dist/index.js",
        ),
        typebox: join(sdk, "node_modules/typebox/build/index.mjs"),
        [join(root, "fleet.mjs")]: fixture,
        "./fleet.mjs": fixture,
      },
    });
    const fixtureWork = join(home, "work-fixture.ts");
    writeFileSync(
      fixtureWork,
      readFileSync(join(root, "work.ts"), "utf8").replace(
        /from '(\.\/[^']+)'/g,
        (_match, relative) =>
          `from ${JSON.stringify(relative === "./fleet.mjs" ? fixture : resolve(root, relative))}`,
      ),
    );
    const { registerWork } = await isolated.import(fixtureWork);
    let registeredTool;
    const command = registerWork(
      {
        registerTool(tool) {
          registeredTool = tool;
        },
        on() {},
        getActiveTools: () => ["read", "bash", "edit", "write"],
        getThinkingLevel: () => "off",
      },
      () => join(home, "state"),
      async () => {},
      () => ({ base: "http://127.0.0.1:9", token: "unused" }),
    );
    const f = scripted([
      (c) => {
        for (let i = 0; i < 4; i++) c.handleInput("\x1b[B");
        c.handleInput("\r");
      },
      "Current project",
      (c) => {
        assert.match(c.render(100).join("\n"), /\$5 estimated/);
        c.handleInput("\t");
        c.handleInput("\t");
        c.handleInput("\r");
      },
    ]);
    Object.assign(f.ctx, {
      cwd: home,
      model: { provider: "fixture", id: "one" },
      modelRegistry: {
        getAvailable: async () => [{ provider: "fixture", id: "one" }],
      },
      getSystemPrompt: () => "Fixture",
      sessionManager: { getSessionId: () => "fixture" },
    });
    const probe = await registeredTool.execute(
      "preview",
      { ...teamWorkRequest("Probe"), action: "preview" },
      undefined,
      undefined,
      f.ctx,
    );
    assert.equal(
      probe.details.result.project,
      "fixture-project",
      "Refuse to test acceptance unless the work module actually uses the fake runtime",
    );
    await command(`team ${goal}`, f.ctx);
    const accepted = JSON.parse(readFileSync(evidence, "utf8"));
    assert.equal(accepted.maxCost, 5);
    assert.equal(accepted.isolation, "shared");
    assert.equal(accepted.stages.length, goal.startsWith('review')?2:4);
    if(goal.startsWith('review')){
      assert.equal(accepted.scope,'review');
      for(const task of accepted.stages.flatMap(s=>s.tasks)){
        assert.equal(task.write,false);
        assert.ok(task.tools.every(t=>['read','grep','find','ls'].includes(t)));
        assert.equal(task.extensions.length,0);
      }
    }
    assert.ok(f.notices.some((n) => n.includes("mock-boundary")));
    assert.equal(existsSync(join(home, "state", "runs")), false);
  } finally {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = old;
    rmSync(home, { recursive: true, force: true });
  }
});
