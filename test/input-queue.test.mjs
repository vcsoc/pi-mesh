import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Execute the actual registered input callback without starting a broker,
// loading the SDK, or launching workers. Pi owns the queue after "continue".
const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
const registration = source.match(/\tpi\.on\('input',[\s\S]*?\n\t\}\);/);
assert.ok(registration, 'ordinary input handler exists');

for (const busy of [true, false]) {
  for (const inputSource of ['interactive', 'rpc', 'extension']) {
    for (const text of ['Next request', '/mesh version', '']) {
      test(`input passes through without interrupting: busy=${busy}, source=${inputSource}, text=${JSON.stringify(text)}`, async () => {
        let handler;
        const current = {
          isIdle: () => !busy,
          abort: () => assert.fail('ordinary input must not abort active work'),
        };
        const sandbox = {
          ctx: undefined,
          pauseOwnedRuns: () => assert.fail('ordinary input must not pause child jobs'),
          pi: { on: (event, callback) => {
            assert.equal(event, 'input');
            handler = callback;
          } },
        };
        runInNewContext(registration[0].replace("'continue' as const", "'continue'"), sandbox);
        const result = await handler({ source: inputSource, text }, current);
        assert.equal(result.action, 'continue');
        assert.equal(sandbox.ctx, current);
      });
    }
  }
}
