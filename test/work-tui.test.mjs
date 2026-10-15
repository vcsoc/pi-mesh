import test from "node:test";
import assert from "node:assert/strict";
import { createRequire, findPackageJSON } from "node:module";
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
  sdkRequire = createRequire(join(sdk, "package.json")),
  tuiPath = sdkRequire.resolve("@earendil-works/pi-tui");
const { createJiti } = await import(pathToFileURL(sdkRequire.resolve("jiti")).href);
const dependencyFile = (name, file) => {
  const base = sdkRequire.resolve.paths(name).find(dir => existsSync(join(dir, name, file)));
  if (!base) throw new Error(`Missing SDK dependency: ${name}`);
  return join(base, name, file);
};
const { visibleWidth, colorToHex, foregroundAnsi, parseColor } = await import(pathToFileURL(tuiPath).href);
const { Theme } = await import(pathToFileURL(join(sdk, 'dist/modes/interactive/theme/theme.js')).href);
const realTheme = mode => new Theme({
  accent: '#5b9dff', dim: '#888888', muted: '#888888', text: '#eeeeee', thinkingXhigh: '#5b9dff',
}, { selectedBg: '#222222' }, mode);
const loader = createJiti(import.meta.url, {
  alias: {
    "@earendil-works/pi-tui": tuiPath,
    "@earendil-works/pi-coding-agent": join(sdk, "dist/index.js"),
    "@earendil-works/pi-ai": dependencyFile("@earendil-works/pi-ai", "dist/index.js"),
    typebox: dependencyFile("typebox", "build/index.mjs"),
  },
});
const { workPicker, reviewWork, editTeamRequest } = await loader.import(
  join(root, "work-tui.ts"),
);
const { editProjectConfig } = await loader.import(join(root,'config-tui.ts'));
const { meshPanel } = await loader.import(join(root, "mesh-panel.ts"));
const { simpleTeam, simpleProposal } = await loader.import(
  join(root, "simple-team.ts"),
);
test('inline project config Cancel/Save keeps native editor focus, rejects invalid JSON and requires deliberate Save',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'mesh-config-tui-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const a=screen();a.ctx.cwd=dir;const cancel=editProjectConfig(a.ctx);a.component.handleInput('dirty');a.component.handleInput('\x1b');assert.equal(await cancel,undefined);assert.equal(existsSync(join(dir,'.pi','mesh','config.json')),false);
 const b=screen();b.ctx.cwd=dir;const save=editProjectConfig(b.ctx);assert.equal(b.component.focused,true);for(const width of [18,40,80])for(const line of b.component.render(width))assert(visibleWidth(line)<=width);b.component.handleInput('\t');assert.equal(b.component.focused,false);assert.match(b.component.render(80).join('\n'),/\[ Cancel \]/);b.component.handleInput('\t');b.component.handleInput('\r');assert.equal(await save,join(realpathSync(dir),'.pi','mesh','config.json'));assert.equal(JSON.parse(readFileSync(join(dir,'.pi','mesh','config.json'))).defaults.concurrency,'auto');
 const c=screen();c.ctx.cwd=dir;const invalid=editProjectConfig(c.ctx);const before=readFileSync(join(dir,'.pi','mesh','config.json'),'utf8');c.component.handleInput('notjson');c.component.handleInput('\t');c.component.handleInput('\t');c.component.handleInput('\r');assert.equal(c.closed,false);assert.equal(readFileSync(join(dir,'.pi','mesh','config.json'),'utf8'),before);c.component.handleInput('\x1b');assert.equal(await invalid,undefined);
});
const theme = { fg: (_c, s) => s, style: (s, _options) => s };
function screen(ctx = {}, activeTheme = theme) {
  let component, widget, customOptions, widgetOptions,
    closed = false;
  const tui = { terminal: { rows: 24 }, requestRender() {} };
  return {
    ctx: {
      mode: "tui",
      hasUI: true,
      ui: {
        setWidget: (_key, factory, options) => { widget = factory?.(); widgetOptions = options; },
        custom: async (factory, options) =>
          new Promise((done) => {
            customOptions = options;
            component = factory(tui, activeTheme, {}, (value) => {
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
      return widget || component;
    },
    get overlay() { return component; },
    get customOptions() { return customOptions; },
    get widgetOptions() { return widgetOptions; },
    get widget() { return widget; },
    get closed() {
      return closed;
    },
    get customOptions() {
      return customOptions;
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

test("large approval plans keep both actions visible while scrolling details and resizing", async () => {
  const f = screen();
  const large = { ...summary, steps: [{ parallel: true, tasks: Array.from({ length: 40 }, (_, i) => ({ ...summary.steps[0].tasks[0], id: `worker-${i}`, lane: `worker-${i}`, task: `Worker ${i} summary. ${"Exact instruction ".repeat(200)}END-OF-TASK-${i}` })) }] };
  const result = reviewWork(f.ctx, large);
  assert.match(f.component.render(80).join("\n"), /MESH EXECUTION REVIEW/);
  for (const rows of [12, 24, 50]) {
    f.tui.terminal.rows = rows;
    for (const width of [24, 80, 100]) {
      for (let i = 0; i < 100; i++) f.component.handleInput("\x1b[6~");
      const output = f.component.render(width);
      assert.equal(output.length, Math.floor(rows / 2));
      assert.match(output.join("\n"), /\[ Cancel \]/);
      if (width >= 38) assert.match(output.join("\n"), /Accept/);
      assert.ok(output.every(line => visibleWidth(line) <= width));
    }
  }
  f.component.handleInput("\x1b[F");
  assert.match(f.component.render(80).join("\n"), /END-OF-TASK-39/);
  assert.equal(f.closed, false);
  f.component.handleInput("\t");
  f.component.handleInput("\t");
  assert.equal(f.closed, false);
  f.component.handleInput("\r");
  assert.equal(await result, "approve");
});

test("an unreadably small approval viewport cannot start work and recovers after resize", async () => {
  const f = screen();
  f.tui.terminal.rows = 8;
  const result = reviewWork(f.ctx, summary);
  f.component.render(16);
  f.component.handleInput("\t");
  f.component.handleInput("\t");
  f.component.handleInput("\r");
  assert.equal(f.closed, false);
  f.tui.terminal.rows = 24;
  assert.match(f.component.render(80).join("\n"), /\[ Accept \]/);
  f.component.handleInput("\r");
  assert.equal(await result, "approve");
});

test("readable review defaults to cancel/back, scrolls, requires deliberate action and supports abort/RPC", async () => {
  let f = screen(),
    result = reviewWork(f.ctx, summary);
  const text = f.component.render(80).join("\n");
  assert.match(text, /MESH EXECUTION REVIEW/);
  const bordered = f.component.render(80);
  assert.equal(bordered.length, 12);
  assert.match(bordered[0], /^╭.*MESH EXECUTION REVIEW.*╮$/);
  assert.match(bordered.at(-1), /^╰─+╯$/);
  for (const line of bordered.slice(1, -1)) {
    assert.match(line, /^│.*│$/);
    assert.equal(visibleWidth(line), 80);
  }
  assert.deepEqual(f.overlay.render(80), []);
  assert.equal(f.customOptions.overlay, true);
  assert.equal(f.widgetOptions.placement, 'aboveEditor');
  assert.match(text, /\[ Cancel \].*Reject.*Accept/);
  assert.doesNotMatch(text, /\x1b\]|\x07/);
  f.component.handleInput("\r");
  assert.equal(await result, "cancel");
  f = screen();
  result = reviewWork(f.ctx, summary, undefined, true);
  f.component.handleInput("\x1b[C");
  f.component.handleInput("\r");
  assert.equal(await result, "back");
  assert.equal(f.widget, undefined);
  f = screen();
  result = reviewWork(f.ctx, summary);
  f.component.handleInput("\x1b[6~");
  for (const line of f.component.render(24))
    assert.ok(visibleWidth(line) <= 24);
  f.component.handleInput("\t");
  f.component.handleInput("\x1b[C");
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

test('review border is blue and actions keep distinct colors with bold selected state', async () => {
  const styles = [];
  const renderer = realTheme('truecolor');
  const f = screen({}, { ...theme, style: (text, options) => {
    styles.push({ text, ...options, fg: colorToHex(options.fg) });
    return renderer.style(text, options);
  } });
  const pending = reviewWork(f.ctx, summary);
  f.component.render(80);
  assert.ok(styles.filter(s => /[╭╮╰╯│]/.test(s.text)).every(s => s.fg === '#5b9dff'));
  assert.ok(styles.some(s => s.text === '[ Cancel ]' && s.fg === '#e5b84b' && s.bold));
  assert.ok(styles.some(s => s.text.includes('Reject') && s.fg === '#f07575' && !s.bold));
  assert.ok(styles.some(s => s.text.includes('Accept') && s.fg === '#65ce8a' && !s.bold));
  styles.length = 0;
  f.overlay.handleInput('\x1b[D');
  f.component.render(24);
  assert.ok(styles.some(s => s.text === '[ Accept ]' && s.fg === '#65ce8a' && s.bold));
  f.overlay.handleInput('\x1b');
  assert.equal(await pending, 'cancel');
});

test('review renders with actual Pi theme in truecolor and 256color without throwing', async () => {
  for (const mode of ['truecolor', '256color']) {
    for (const readOnly of [false, true]) {
      const f = screen({}, realTheme(mode));
      const pending = reviewWork(f.ctx, summary, undefined, false, readOnly);
      for (const rows of [12, 24, 40]) {
        f.tui.terminal.rows = rows;
        for (const width of [0, 1, 2, 12, 24, 38, 80]) {
          for (let action = 0; action < 3; action++) {
            const lines = f.component.render(width);
            for (const line of lines) assert.ok(visibleWidth(line) <= width);
            if (width === 80) {
              assert.ok(lines[0].includes(foregroundAnsi(parseColor('#5b9dff'), mode)));
              assert.ok(lines.join('\n').includes(foregroundAnsi(parseColor('#e5b84b'), mode)));
              if (!readOnly) {
                for (const hex of ['#f07575', '#65ce8a'])
                  assert.ok(lines.join('\n').includes(foregroundAnsi(parseColor(hex), mode)));
              }
            }
            f.overlay.handleInput('\x1b[C');
          }
        }
      }
      f.overlay.handleInput('\x1b');
      assert.equal(await pending, 'cancel');
      assert.equal(f.widget, undefined);
    }
  }
});

test('execution review arrows scroll independently, cycle actions, resize and clean up', async () => {
  const f = screen();
  const pending = reviewWork(f.ctx, summary);
  const initial = f.component.render(80).join('\n');
  f.overlay.handleInput('\x1b[B');
  assert.match(f.component.render(80).join('\n'), /Lines 2-/);
  assert.match(f.component.render(80).join('\n'), /\[ Cancel \]/);
  f.overlay.handleInput('\x1b[D');
  assert.match(f.component.render(80).join('\n'), /\[ Accept \]/);
  f.overlay.handleInput('\x1b[C');
  assert.match(f.component.render(80).join('\n'), /\[ Cancel \]/);
  for (const rows of [12, 24, 40, 80]) {
    f.tui.terminal.rows = rows;
    const lines = f.component.render(30);
    assert.equal(lines.length, Math.floor(rows / 2));
    for (const line of lines) assert.ok(visibleWidth(line) <= 30);
  }
  for (const width of [0, 1, 2, 12, 24, 38, 80]) {
    const lines = f.component.render(width);
    for (const line of lines) assert.ok(visibleWidth(line) <= width);
    if (width >= 2) {
      assert.ok(lines[0].startsWith('╭') && lines[0].endsWith('╮'));
      assert.ok(lines.at(-1).startsWith('╰') && lines.at(-1).endsWith('╯'));
      for (const line of lines) assert.equal(visibleWidth(line), width);
    }
  }
  for (let i = 0; i < 1000; i++) f.overlay.handleInput('\x1b[B');
  assert.match(f.component.render(80).join('\n'), /Required values:/);
  assert.notEqual(f.component.render(80).join('\n'), initial);
  f.overlay.handleInput('\x1b');
  assert.equal(await pending, 'cancel');
  assert.equal(f.widget, undefined);
  const reject = screen();
  const rejected = reviewWork(reject.ctx, summary);
  reject.overlay.handleInput('\x1b[C'); reject.overlay.handleInput('\r');
  assert.equal(await rejected, 'cancel', 'Reject never starts a tool-origin workflow');
});

function scripted(actions, editors = []) {
  const notices = [];
  let widget;
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      notify: (message) => notices.push(message),
      editor: async () => editors.shift(),
      confirm: async () => false,
      setWidget: (_key, factory) => { widget = factory?.(); },
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
            component = widget || component;
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

test('review demo accepts only a sample and cannot reach a worker boundary', async () => {
  const { registerWork } = await loader.import(join(root, 'work.ts'));
  const command = registerWork({ registerTool() {}, on() {} },
    () => { throw new Error('Demo must not access run storage'); },
    async () => { throw new Error('Demo must not connect'); },
    () => { throw new Error('Demo must not request execution connection'); });
  for (const [arrows, label] of [[0, 'Cancel'], [1, 'Reject'], [2, 'Accept']]) {
    const f = scripted([component => {
      assert.match(component.render(100).join('\n'), /MESH EXECUTION REVIEW/);
      for (let i=0; i<arrows; i++) component.handleInput('\x1b[C');
      component.handleInput('\r');
    }]);
    f.ctx.cwd = '/sample/project';
    await command('review-demo', f.ctx);
    assert.ok(f.notices.includes(`Review demo closed: ${label}. No work started.`));
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
      `import {writeFileSync} from 'node:fs';export const canonicalProject=x=>'fixture-project', projectHash=x=>'fixture', resolveSDKFile=()=> 'fixture-sdk';export function launchRun(directory,spec){writeFileSync(${JSON.stringify(evidence)},JSON.stringify(spec.plan));return {id:'mock-boundary',state:'not-executed'};}export const waitRun=()=>{throw Error('Unexpected wait')},resumeSpecification=()=>{throw Error('Unexpected resume')},integrationEvidence=()=>{},runVerification=()=>{},updateMission=()=>{},listMissions=()=>[],runEvents=()=>[],listRuns=()=>[];`,
    );
    const isolated = createJiti(import.meta.url, {
      alias: {
        "@earendil-works/pi-tui": tuiPath,
        "@earendil-works/pi-coding-agent": join(sdk, "dist/index.js"),
        "@earendil-works/pi-ai": dependencyFile("@earendil-works/pi-ai", "dist/index.js"),
        typebox: dependencyFile("typebox", "build/index.mjs"),
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
    const compact = registeredTool.renderResult(probe, { expanded: false, isPartial: false }, theme).render(100);
    assert.ok(compact.length <= 12);
    assert.match(compact.join("\n"), /Budget:/);
    assert.match(compact.join("\n"), /scout|developer/);
    assert.doesNotMatch(compact.join("\n"), /"tasks":|Role instructions:/);
    const expanded = registeredTool.renderResult(probe, { expanded: true, isPartial: false }, theme).render(100);
    assert.match(expanded.join("\n"), /Exact model: fixture\/one/);
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
