"""Render the Mesh review in the compiled Pi app; no provider calls or workers."""
import fcntl, json, os, pty, re, select, shutil, signal, struct, tempfile, termios, time
from pathlib import Path

root = Path(os.environ.get('MESH_TEST_EXTENSION_ROOT', Path(__file__).resolve().parent.parent))
home = Path(tempfile.mkdtemp(prefix='mesh-review-colors-'))
agent = home / 'agent'
agent.mkdir()
(agent / 'models.json').write_text(json.dumps({'providers': {'fixture': {'baseUrl': 'http://127.0.0.1:9/v1', 'api': 'openai-completions', 'apiKey': 'unused', 'models': [{'id': 'one', 'reasoning': False}]}}}))
(agent / 'settings.json').write_text(json.dumps({'defaultProvider': 'fixture', 'defaultModel': 'one'}))
extension = home / 'review.ts'
extension.write_text('import { reviewWork } from ' + json.dumps(str(root / 'work-tui.ts')) + ';\n' + '''export default function(pi) {
  pi.registerCommand('review-colors', { handler: async (_args, ctx) => {
    const result = await reviewWork(ctx, {
      project: '/fixture', isolation: 'shared', background: true, thinkingLevel: 'off',
      limits: { spawns: 1, tokens: 1000, concurrency: 1, estimatedCost: 1, childDeadlineMs: 1000 },
      steps: [{ parallel: false, retries: 0, tasks: [{ id: 'fixture', role: 'reviewer',
        lane: 'main', model: 'fixture/one', tools: ['read'], task: 'Render only', acceptance: [] }] }]
    });
    ctx.ui.notify('Review closed: ' + result + '; no work started', 'info');
  }});
}
''')
env = dict(os.environ, TERM='xterm-256color', COLORTERM='truecolor', PI_CODING_AGENT_DIR=str(agent), PI_SKIP_VERSION_CHECK='1', PI_OFFLINE='1')
pid, master = pty.fork()
if pid == 0:
    os.chdir(home)
    os.execvpe('pi', ['pi', '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '-e', str(extension)], env)
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 120, 0, 0))
output = b''
def pump(seconds):
    global output
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if select.select([master], [], [], 0.1)[0]:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            output += data
            if b'\x1b[6n' in data:
                os.write(master, b'\x1b[1;1R')
def text():
    return re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', output.decode('utf-8', 'replace'))
try:
    pump(2)
    for arrows, expected in [(0, 'cancel'), (1, 'cancel'), (2, 'approve')]:
        output = b''
        os.write(master, b'/review-colors\r')
        pump(0.7)
        assert 'MESH EXECUTION REVIEW' in text(), text()[-3000:]
        assert all(label in text() for label in ['Cancel', 'Reject', 'Accept'])
        for rgb in [b'91;157;255', b'229;184;75', b'240;117;117', b'101;206;138']:
            assert b'\x1b[38;2;' + rgb + b'm' in output, 'Missing color ' + str(rgb)
        for _ in range(arrows):
            os.write(master, b'\x1b[C')
            pump(0.1)
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 44, 0, 0))
        os.kill(pid, signal.SIGWINCH)
        pump(0.2)
        os.write(master, b'\r')
        pump(0.4)
        assert 'Review closed: ' + expected in text(), text()[-3000:]
        assert 'Unknown theme color' not in text()
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 120, 0, 0))
        os.kill(pid, signal.SIGWINCH)
    assert not (agent / 'crashes.json').exists(), 'Pi recorded a crash'
    print('PASS: compiled Pi review renders exact colors, resizes, and closes all three actions; no workers/provider calls')
finally:
    # Closing the PTY first prevents an exiting session-leader wait cycle on Darwin.
    os.close(master)
    try:
        os.kill(pid, signal.SIGTERM)
        time.sleep(0.2)
        waited, _ = os.waitpid(pid, os.WNOHANG)
        if waited == 0:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
    except (ProcessLookupError, ChildProcessError):
        pass
    shutil.rmtree(home)
