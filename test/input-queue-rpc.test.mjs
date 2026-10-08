import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Real Pi CLI + Mesh, real SDK transport, synthetic local SSE only. Never use
// the user's agents, broker, credentials, projects, gateway or a paid provider.
const extensionRoot = process.env.MESH_QUEUE_TEST_ROOT || fileURLToPath(new URL('..', import.meta.url));
const pause = ms => new Promise(done => setTimeout(done, ms));
async function wait(check, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await pause(15);
  }
  throw new Error(`Timed out: ${label}`);
}
async function freePort() {
  const server = net.createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'mesh-input-queue-'));
  const agent = join(directory, 'agent'), project = join(directory, 'project'), home = join(directory, 'mesh');
  mkdirSync(agent); mkdirSync(project);
  writeFileSync(join(project, 'fixture.txt'), 'LOCAL_TOOL_COMPLETED');
  const requests = [], events = [];
  let release, prematurelyClosed = false, released = false;
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(request.headers.authorization, 'Bearer FIXTURE_ONLY');
      let text = '';
      for await (const chunk of request) text += chunk;
      requests.push(JSON.parse(text));
      const number = requests.length;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = value => response.write('data: ' + JSON.stringify(value) + '\n\n');
      send({ id: `fixture-${number}`, choices: [{ index: 0, delta: { role: 'assistant', content: number === 1 ? 'Working without cancellation. ' : `RESPONSE_${number}` } }] });
      if (number === 1) {
        response.on('close', () => { if (!released) prematurelyClosed = true; });
        await new Promise(done => { release = done; });
        if (response.destroyed) return;
        send({ id: 'fixture-1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'read_fixture', type: 'function', function: { name: 'read', arguments: '{"path":"fixture.txt"}' } }] } }] });
      }
      send({ id: `fixture-${number}`, choices: [{ index: 0, delta: {}, finish_reason: number === 1 ? 'tool_calls' : 'stop' }] });
      send({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } });
      response.end('data: [DONE]\n\n');
    } catch (error) {
      events.push({ type: 'fixture_error', error: error.message });
      response.destroy();
    }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  writeFileSync(join(agent, 'models.json'), JSON.stringify({ providers: { 'queue-fixture': {
    baseUrl: endpoint, api: 'openai-completions', apiKey: 'FIXTURE_ONLY',
    models: [{ id: 'local', reasoning: false, contextWindow: 128000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  } } }));
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ autoRetry: { enabled: false }, compaction: { enabled: false } }));
  const port = await freePort();
  const windowsCli = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js');
  const child = spawn(process.platform === 'win32' ? process.execPath : 'pi', [
    ...(process.platform === 'win32' ? [windowsCli] : []), '--mode', 'rpc', '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files',
    '--provider', 'queue-fixture', '--model', 'local', '--thinking', 'off', '--tools', 'read',
    '-e', resolve(extensionRoot, 'index.ts'),
  ], { cwd: project, env: { ...process.env, PI_CODING_AGENT_DIR: agent, PI_AGENT_MESH_HOME: home,
    PI_AGENT_MESH_PORT: String(port), PI_AGENT_NAME: 'Queue fixture', PI_SKIP_VERSION_CHECK: '1', PI_OFFLINE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', stderr = '', sequence = 0;
  child.stderr.on('data', data => { stderr += data; });
  child.stdout.on('data', data => {
    buffer += data;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      try { events.push(JSON.parse(line)); } catch { /* Diagnostics are captured separately. */ }
    }
  });
  async function command(type, data = {}) {
    const id = `queue-${++sequence}`;
    child.stdin.write(JSON.stringify({ id, type, ...data }) + '\n');
    const result = await wait(() => events.find(event => event.type === 'response' && event.id === id), `${type} response: ${stderr}`);
    assert.equal(result.success, true, result.error || stderr);
    return result.data;
  }
  t.after(async () => {
    released = true; release?.();
    child.stdin.end();
    if (child.exitCode === null) {
      await Promise.race([new Promise(done => child.once('exit', done)), pause(2000)]);
      if (child.exitCode === null) child.kill('SIGTERM');
      await wait(() => child.exitCode !== null || child.signalCode !== null, 'fixture Pi shutdown', 5000);
    }
    // Only the isolated configured broker, never production or an arbitrary PID.
    if (existsSync(join(home, 'config.json'))) {
      const config = JSON.parse(readFileSync(join(home, 'config.json')));
      const health = await fetch(`http://127.0.0.1:${port}/health`).then(response => response.json()).catch(() => null);
      const { createHash } = await import('node:crypto');
      if (health?.pid && health.instance === createHash('sha256').update(config.token).digest('hex').slice(0, 16)) {
        try { process.kill(health.pid, 'SIGTERM'); } catch { /* Already exited. */ }
        await wait(() => fetch(`http://127.0.0.1:${port}/health`).then(() => false).catch(() => true), 'fixture broker shutdown');
      }
    }
    server.closeAllConnections();
    await new Promise(done => server.close(done));
    rmSync(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  });
  const initial = await command('get_state');
  assert.equal(initial.model.provider, 'queue-fixture');
  assert.equal(initial.model.baseUrl, endpoint);
  const config = JSON.parse(readFileSync(join(home, 'config.json')));
  // A synthetic owned run proves ordinary input doesn't enqueue pause controls.
  // No worker, immutable grant or model run is launched by this fixture row.
  const run = join(config.dataDir, 'runs', randomUUID());
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'state.json'), JSON.stringify({ id: run.split(/[\\/]/).at(-1), parentId: initial.sessionId,
    project: realpathSync(project), state: 'running', heartbeat: Date.now(), createdAt: new Date().toISOString(), steps: [], workspaces: [] }));
  return { events, requests, command, run, released: () => prematurelyClosed,
    release: () => { released = true; release(); } };
}

for (const direct of [false, true]) {
  test(`real Pi preserves active stream/tool batch then steering and follow-up (${direct ? 'direct RPC' : 'prompt streamingBehavior'})`, async t => {
    const f = await fixture(t);
    assert.equal((await f.command('prompt', { message: 'INITIAL_QUEUE_FIXTURE' })).disposition, 'started');
    await wait(() => f.events.some(event => event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta'), 'active first stream');
    const steering = direct
      ? await f.command('steer', { message: 'STEER_QUEUE_FIXTURE' })
      : await f.command('prompt', { message: 'STEER_QUEUE_FIXTURE', streamingBehavior: 'steer' });
    assert.equal(steering.disposition, 'queued');
    const follow = direct
      ? await f.command('follow_up', { message: 'FOLLOWUP_QUEUE_FIXTURE' })
      : await f.command('prompt', { message: 'FOLLOWUP_QUEUE_FIXTURE', streamingBehavior: 'followUp' });
    assert.equal(follow.disposition, 'queued');
    await pause(100);
    const busy = await f.command('get_state');
    assert.equal(busy.isStreaming, true, 'original generation is still running');
    assert.equal(busy.pendingMessageCount, 2);
    assert.equal(f.released(), false, 'native queue must not abort the in-flight provider stream');
    assert.equal(f.requests.length, 1, 'queued messages must not start another request before the boundary');
    assert.equal(existsSync(join(f.run, 'controls')) ? readdirSync(join(f.run, 'controls')).length : 0, 0, 'no owned-run pause queued');
    f.release();
    await wait(() => f.events.some(event => event.type === 'agent_settled'), 'all queued work settles');
    const messages = (await f.command('get_messages')).messages;
    assert.equal(f.requests.length, 3, 'initial work → steering → follow-up');
    const bodies = f.requests.map(request => JSON.stringify(request.messages));
    assert.match(bodies[1], /STEER_QUEUE_FIXTURE/);
    assert.match(bodies[1], /LOCAL_TOOL_COMPLETED/);
    assert.doesNotMatch(bodies[1], /FOLLOWUP_QUEUE_FIXTURE/);
    assert.match(bodies[2], /FOLLOWUP_QUEUE_FIXTURE/);
    assert.deepEqual(messages.filter(message => message.role === 'assistant').map(message => message.stopReason), ['toolUse', 'stop', 'stop']);
    assert.equal(f.events.some(event => event.type === 'fixture_error'), false);
    assert.equal(f.released(), false);
    const idle = await f.command('get_state');
    assert.equal(idle.isStreaming, false); assert.equal(idle.pendingMessageCount, 0);
  });
}
test('real Pi still honours an explicit abort command', async t => {
  const f = await fixture(t);
  await f.command('prompt', { message: 'INITIAL_EXPLICIT_ABORT_FIXTURE' });
  await wait(() => f.events.some(event => event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta'), 'active stream');
  await f.command('abort');
  const messages = (await f.command('get_messages')).messages;
  assert.equal(messages.filter(message => message.role === 'assistant').at(-1).stopReason, 'aborted');
  assert.equal((await f.command('get_state')).isStreaming, false);
});
