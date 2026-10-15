import { isDeepStrictEqual } from 'node:util';
import { compileWorkflow } from './workflow.mjs';
import { plain } from './work-review.mjs';

export const DEMO_MAX_AGENTS = 64;
export const DEMO_CONCURRENCY = DEMO_MAX_AGENTS;
export const DEMO_USAGE = `Usage: /mesh demo <agents> (1–${DEMO_MAX_AGENTS}; all requested agents concurrently; 15-second deadline each). Real model calls and normal Mesh logs; interactive approval required. Provider delays become decision blockers, never false PASS.`;
const roles = ['scout', 'reviewer', 'auditor'];
const contract = 'Mesh smoke test only. Complete the assigned tiny in-memory task and return strict JSON only. Do not use tools, read or write project files, run shell commands, browse, install, delegate, change configuration, commit or push. Return results through your final task output; the Mesh supervisor collects and reports them. Then stop.';

export const DEMO_SYSTEM_PROMPT = contract;

export function demoCount(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > DEMO_MAX_AGENTS) throw new Error(DEMO_USAGE);
  return Number(value);
}

export function demoCases(value) {
  const count = demoCount(value);
  return Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1, id = `demo-${String(ordinal).padStart(3, '0')}`;
    const text = `mesh-${ordinal}`;
    const variants = [
      { task: `Calculate ${17 + index} + 25. Return result as a number.`, expected: 42 + index },
      { task: `Reverse the string ${JSON.stringify(text)}. Return result as a string.`, expected: [...text].reverse().join('') },
      { task: 'Alphabetically sort ["pear","apple","banana"]. Return result as the comma-separated string "apple,banana,pear" (not an array).', expected: 'apple,banana,pear' },
    ];
    return { id, profile: roles[index % roles.length], ...variants[index % variants.length] };
  });
}

export function demoWorkRequest(value) {
  const count = demoCount(value), cases = demoCases(count), stages = [];
  {
    stages.push({ parallel: true, retries: 0, tasks: cases.map(item => ({
      id: item.id, profile: item.profile,
      task: `${contract}\n${item.task}\nReturn exactly one JSON object with task=${JSON.stringify(item.id)}, result, and status="done". No Markdown or extra text.`,
      dependsOn: [], extensions: [], extensionTools: [],
      acceptance: [{ type: 'json', required: ['task', 'result', 'status'], equals: { task: item.id, result: item.expected, status: 'done' }, types: { task: 'string', result: typeof item.expected, status: 'string' } }],
    })) });
  }
  return { action: 'run', background: true, definition: {
    scope: 'demo', demoCount: count, stages, isolation: 'shared', context: 'fresh',
    concurrency: count, timeoutMs: 15000,
    maxCalls: count, maxTokens: null, maxCost: Math.max(1, count * .25),
    untilComplete: false, watchdog: false,
  } };
}

// Reserved, immutable scope: neither user profiles nor JSON edits can turn a
// demo into project work, add extensions/gates, increase concurrency or retry.
export function compileDemoWorkflow(definition, options) {
  const count = demoCount(definition.demoCount), expected = demoWorkRequest(count).definition;
  if (!isDeepStrictEqual(definition, expected)) throw new Error('Demo scope is fixed. Use /mesh demo <agents>; custom work needs a separately approved workflow.');
  const profiles = Object.fromEntries(roles.map(role => [role, { write: false, tools: [], prompt: contract }]));
  const plan = compileWorkflow(definition, profiles, options);
  return { ...plan, scope: 'demo', demoCount: count };
}

export function demoReport(run, spec) {
  const deadlineMs=spec.plan.timeoutMs||15000,enforceElapsed=spec.plan.failurePolicy==='escalate';
  const cases = demoCases(spec.plan.demoCount), rows = new Map((run.steps || []).map(row => [row.id, row]));
  const results = cases.map(item => {
    const row = rows.get(item.id); let output;
    try { output = JSON.parse(row?.output); } catch { /* Missing/malformed output is not accepted. */ }
    const passed = row?.state === 'completed' && (!enforceElapsed || Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0 && row.elapsedMs <= deadlineMs) && row.acceptance?.length === 1 && row.acceptance[0].passed === true &&
      output?.task === item.id && output?.status === 'done' && isDeepStrictEqual(output?.result, item.expected);
    return { item, row, output, passed: !!passed };
  });
  const accepted = results.filter(result => result.passed).length;
  const pass = run.state === 'completed' && accepted === cases.length && run.steps.length === cases.length;
  return plain([
    `Mesh demo ${run.id}: ${pass ? 'PASS' : 'NOT VERIFIED / INCOMPLETE'}`,
    `Runtime: ${run.state}${run.error ? ` — ${run.error}` : ''}. Agents requested: ${cases.length}; started: ${(run.steps || []).length}; accepted: ${accepted}/${cases.length}.`,
    ...results.map(({ item, row, output, passed }) => `${item.id} · ${row?.name || row?.agentId || 'not registered'} (${item.profile}) · ${row?.state || 'not started'} · ${passed ? 'PASS' : 'FAIL'} · result=${JSON.stringify(output?.result)?.slice(0,240) ?? 'missing'}; expected=${JSON.stringify(item.expected)}`),
    'No workspace tools, child extensions or command gates. Normal model usage, Mesh/session logs and handoffs are retained; this is not an OS sandbox or a zero-cost dry run.',
    `Inspect: /mesh jobs {"action":"inspect","id":"${run.id}"}. Blocked work awaits an explicit decision; no automatic retries or history replay.`,
    `Approved child deadline: ${deadlineMs/1000} seconds${enforceElapsed?' including setup':' runtime (legacy grant)'}. Provider latency is not guaranteed; deadline breaches cannot pass.`,
  ].join('\n'));
}
