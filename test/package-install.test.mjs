import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wait = async (check, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('package discovery timed out');
};
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(error => error ? reject(error) : resolve(port));
  });
});

// An isolated personal package declaration exercises Pi's real resource loader.
// No -e index.ts shortcut, model generation, production state or paid inference.
test('Pi discovers exactly one Mesh extension through its package manifest', async t => {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.pi, { extensions: ['./index.ts'] });
  assert.equal(manifest.repository.url, 'https://github.com/vcsoc/pi-mesh.git');
  for (const name of ['@earendil-works/pi-ai', '@earendil-works/pi-coding-agent', '@earendil-works/pi-tui', 'typebox']) {
    assert.equal(manifest.peerDependencies[name], '*');
    assert.equal(manifest.dependencies?.[name], undefined, 'host packages must not be installed twice');
  }
  const agentDir = await mkdtemp(path.join(os.tmpdir(), 'mesh-package-rpc-'));
  const home = path.join(agentDir, 'mesh');
  await writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({
    packages: [root], defaultProvider: 'mesh-package-fixture', defaultModel: 'unused'
  }));
  await writeFile(path.join(agentDir, 'models.json'), JSON.stringify({providers: {
    'mesh-package-fixture': { baseUrl: 'http://127.0.0.1:9/v1', api: 'openai-completions',
      apiKey: 'fixture-not-used', models: [{id: 'unused'}] }
  }}));
  const cli = process.env.PI_MESH_PI_CLI || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'npm', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js');
  const command = process.platform === 'win32' ? process.execPath : (process.env.PI_MESH_PI_BINARY || 'pi');
  const prefix = process.platform === 'win32' ? [cli] : [];
  const child = spawn(command, [...prefix, '--mode', 'rpc', '--no-session', '--no-skills',
    '--no-prompt-templates', '--no-context-files'], {
    cwd: agentDir,
    env: {...process.env, PI_CODING_AGENT_DIR: agentDir, PI_AGENT_MESH_HOME: home,
      PI_AGENT_MESH_PORT: String(await freePort()), PI_AGENT_NAME: 'Package Test Agent', PI_SKIP_VERSION_CHECK: '1'},
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stderr = '', buffer = '', spawnError;
  const events = [];
  child.on('error', error => { spawnError = error; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (;;) {
      const index = buffer.indexOf('\n');
      if (index < 0) break;
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      try { events.push(JSON.parse(line)); } catch { /* non-RPC console output */ }
    }
  });
  t.after(async () => {
    if (child.exitCode === null && !spawnError) {
      await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill('SIGTERM');
      });
    }
    try {
      const config = JSON.parse(await readFile(path.join(home, 'config.json'), 'utf8'));
      const health = await fetch(`http://127.0.0.1:${config.port}/health`).then(response => response.json());
      // This port/config/home belongs only to the fixture, never production.
      if (health.pid) process.kill(health.pid, 'SIGTERM');
    } catch { /* fixture may not have started */ }
    await rm(agentDir, {recursive: true, force: true, maxRetries: 8, retryDelay: 100});
  });
  const response = id => wait(() => {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`Pi exited: ${stderr}`);
    return events.find(event => event.type === 'response' && event.id === id);
  });
  child.stdin.write(JSON.stringify({id: 'commands', type: 'get_commands'}) + '\n');
  const commands = await response('commands');
  assert.equal(commands.success, true, stderr);
  const meshes = commands.data.commands.filter(command => command.name === 'mesh');
  assert.equal(meshes.length, 1, stderr);
  assert.equal(path.resolve(meshes[0].sourceInfo.path), path.join(root, 'index.ts'));
  assert.equal(meshes[0].source, 'extension');
  assert.equal(meshes[0].sourceInfo.origin, 'package');
  assert.equal(meshes[0].sourceInfo.scope, 'user');
  assert.equal(path.resolve(meshes[0].sourceInfo.baseDir), root);
  child.stdin.write(JSON.stringify({id: 'version', type: 'prompt', message: '/mesh version'}) + '\n');
  assert.equal((await response('version')).success, true, stderr);
  await wait(() => events.find(event => event.type === 'extension_ui_request'
    && event.method === 'notify' && event.message === `Agent Mesh v${manifest.version}`));
  const config = JSON.parse(await readFile(path.join(home, 'config.json'), 'utf8'));
  const state = await fetch(`http://127.0.0.1:${config.port}/api/state`, {
    headers: {Authorization: `Bearer ${config.token}`}
  }).then(response => response.json());
  assert.deepEqual(state.agents.map(agent => agent.name), ['Package Test Agent']);
  assert.doesNotMatch(stderr, /duplicate|failed to load extension/i);
});
