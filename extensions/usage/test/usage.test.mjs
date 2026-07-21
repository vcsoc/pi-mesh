import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { aggregateUsage, collectUsage, findSessionFiles, formatHtml, formatMarkdown, parseUsageArgs, totals } from '../core.mjs';

const now = new Date(2026, 6, 17, 14, 30, 0);
const usage = (total = 1) => ({ input: 10, output: 5, cacheRead: 3, cacheWrite: 2, totalTokens: 20, cost: { input: .1, output: .2, cacheRead: .03, cacheWrite: .02, total } });

test('parses periods, model filters, inclusive dates, and terminal export flags', () => {
  const today = parseUsageArgs('@gpt-5.6-sol today --md', now);
  assert.equal(today.model, 'gpt-5.6-sol'); assert.equal(today.exportType, 'md'); assert.equal(new Date(today.start).getHours(), 0);
  const week = parseUsageArgs('week', now); assert.equal(new Date(week.start).getDay(), 1);
  const month = parseUsageArgs('month --html', now); assert.equal(new Date(month.start).getDate(), 1); assert.equal(month.exportType, 'html');
  const days = parseUsageArgs('260701 260717', now); assert.equal(new Date(days.start).getDate(), 1); assert.equal(new Date(days.end).getHours(), 23); assert.equal(new Date(days.end).getMilliseconds(), 999);
  const minutes = parseUsageArgs('@openai/gpt 2607171200 2607171230', now); assert.equal(minutes.model, 'openai/gpt'); assert.equal(new Date(minutes.end).getSeconds(), 59);
  assert.equal(parseUsageArgs('models --md', now).mode, 'models');
  assert.throws(() => parseUsageArgs('--md today', now), /final argument/);
  assert.throws(() => parseUsageArgs('260731 260701', now), /start date/);
  assert.throws(() => parseUsageArgs('260230 260301', now), /calendar date/);
});

test('aggregates per model, filters exact model ids, and includes available zero-use models', () => {
  const records = [
    { provider: 'openai', model: 'gpt-a', timestamp: now.getTime(), usage: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2, totalTokens: 20, costInput: .1, costOutput: .2, costCacheRead: .03, costCacheWrite: .02, costTotal: .35 } },
    { provider: 'other', model: 'gpt-a', timestamp: now.getTime(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, costInput: 0, costOutput: 0, costCacheRead: 0, costCacheWrite: 0, costTotal: .01 } }
  ];
  const query = parseUsageArgs('@gpt-a today', now), rows = aggregateUsage(records, query, [{ provider: 'openai', id: 'gpt-a' }, { provider: 'openai', id: 'unused' }]);
  assert.equal(rows.length, 2); assert.equal(totals(rows).totalTokens, 22); assert.equal(rows.find((row) => row.key === 'openai/gpt-a').available, true);
  const models = aggregateUsage(records, parseUsageArgs('models', now), [{ provider: 'openai', id: 'unused' }]);
  assert.ok(models.find((row) => row.key === 'openai/unused' && row.requests === 0));
});

test('streams session JSONL, captures assistant usage, and deduplicates forked response ids', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pi-usage-')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'a')); const entry = { type: 'message', id: 'one', timestamp: now.toISOString(), message: { role: 'assistant', provider: 'openai', model: 'gpt-test', responseId: 'response-1', timestamp: now.getTime(), usage: usage(.35) } };
  await writeFile(path.join(root, 'a', 'one.jsonl'), `${JSON.stringify({ type: 'session' })}\n${JSON.stringify(entry)}\n`);
  await writeFile(path.join(root, 'two.jsonl'), `${JSON.stringify(entry)}\n{invalid\n`);
  const files = await findSessionFiles(root), records = await collectUsage(files);
  assert.equal(files.length, 2); assert.equal(records.length, 1); assert.equal(records[0].model, 'gpt-test'); assert.equal(records[0].usage.totalTokens, 20);
});

test('renders escaped standalone markdown and HTML reports', () => {
  const row = { key: 'provider/model|x', available: true, requests: 1, input: 10, output: 5, cacheRead: 3, cacheWrite: 2, totalTokens: 20, costInput: .1, costOutput: .2, costCacheRead: .03, costCacheWrite: .02, costTotal: .35 };
  const report = { label: '<Today>', model: null, rows: [row], generatedAt: now.getTime(), fileCount: 2 };
  assert.match(formatMarkdown(report), /model\\\|x/); assert.match(formatMarkdown(report), /\*\*20\*\*/);
  const html = formatHtml(report); assert.match(html, /<!doctype html>/); assert.match(html, /&lt;Today&gt;/); assert.match(html, /provider\/model\|x/);
});
