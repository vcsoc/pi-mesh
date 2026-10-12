"""Actual Pi PTY: configure a synthetic Mesh team and CANCEL. Never approve or generate."""
import codecs, fcntl, hashlib, json, os, pty, re, select, shutil, signal, socket, struct, tempfile, termios, time, urllib.request
from pathlib import Path

import pyte

root = Path(os.environ.get('MESH_TEST_EXTENSION_ROOT', Path(__file__).resolve().parent.parent))
home = Path(tempfile.mkdtemp(prefix='mesh-team-pty-'))
agent = home / 'agent'
agent.mkdir()
sdk = Path(os.environ['PI_SDK_ROOT'])
sdk_version = json.loads((sdk / 'package.json').read_text())['version']
(agent / 'sdk').mkdir()
(agent / 'sdk' / sdk_version).symlink_to(sdk.parents[2], target_is_directory=True)
(agent / 'models.json').write_text(json.dumps({'providers': {'fixture': {'baseUrl': 'http://127.0.0.1:9/v1', 'api': 'openai-completions', 'apiKey': 'fixture-unused', 'models': [{'id': 'one', 'reasoning': False}, {'id': 'two', 'reasoning': False}]}}}))
(agent / 'settings.json').write_text(json.dumps({'defaultProvider': 'fixture', 'defaultModel': 'one', 'defaultThinkingLevel': 'off'}))
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
env = dict(os.environ, TERM='xterm-256color', PI_CODING_AGENT_DIR=str(agent), PI_AGENT_MESH_HOME=str(home / 'mesh'), PI_AGENT_MESH_PORT=str(port), PI_SKIP_VERSION_CHECK='1', PI_OFFLINE='1')
pid, master = pty.fork()
if pid == 0:
    os.chdir(home)
    os.execvpe('pi', ['pi', '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '-e', str(root / 'index.ts')], env)
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 140, 0, 0))
output = b''
screen = pyte.Screen(140, 36)
stream = pyte.Stream(screen)
decoder = codecs.getincrementaldecoder('utf-8')('replace')
def visible():
    return '\n'.join(screen.display)
def pump(seconds):
    global output
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if select.select([master], [], [], 0.1)[0]:
            try: data = os.read(master, 65536)
            except OSError: break
            output += data
            stream.feed(decoder.decode(data))
            if b'\x1b[6n' in data: os.write(master, b'\x1b[1;1R')
def text():
    return re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', output.decode('utf-8', 'replace'))
def choose(query, expected):
    global output
    output = b''
    encoded = query.encode()
    os.write(master, (b'\x1b[200~' + encoded + b'\x1b[201~' if len(encoded) > 1000 else encoded) + b'\r')
    pump(0.7)
    assert expected in text(), f'Expected {expected}; refusing further input. Received: {text()[-3000:]}'
try:
    pump(3)
    choose('/mesh', 'What should Mesh do?')
    os.write(master, b'\x1b')
    pump(0.5)
    choose('/mesh team Verify the fixture only', 'Mesh · new team')
    assert 'Change' in text() and 'Cancel' in text() and 'Accept' in text(), 'Missing simple actions'
    assert '$5 estimated' in text() and 'Bounded run' in text(), 'New task defaults are not finite/bounded'
    assert '╭' in text() and '╰' in text(), 'Expected history-style boxed UI'
    assert 'Review only' in text() and 'inspect only' in text(), 'Review request received writing scope'
    # Arrow selection edits fields directly; no search/menu required for the main panel.
    choose('\x1b[B\x1b[B', 'Model for the team')
    choose('fixture/two', 'Mesh · new team')
    choose('\x1b[B', 'Spending limit')
    choose('$2', 'Mesh · new team')
    assert '$2 estimated' in text(), 'Cost edit was not retained'
    choose('\x1b[B', 'Where should the team review files?')
    choose('Current project', 'Mesh · new team')
    choose('\x1b[B\x1b[B', 'Mesh · advanced (optional)')
    os.write(master, b'\x1b')
    pump(0.4)
    choose('\x1b[B', 'Mesh work: exact details')
    assert 'NOT integrated' in text(), 'Missing sandbox limitation'
    for _ in range(15):
        os.write(master, b'\x1b[6~')
        pump(0.05)
    assert 'Exact model: fixture/two' in text(), 'Edited model missing from compiled details'
    assert 'APPROVE & START' not in text(), 'Read-only details must not expose a second approval action'
    choose('\t', 'Mesh · new team')
    assert 'fixture/two' in text(), 'Model edit was lost returning from details'
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 64, 0, 0))
    screen.resize(lines=24, columns=64)
    os.kill(pid, signal.SIGWINCH)
    pump(0.3)
    os.write(master, b'\x1b')
    pump(0.7)
    assert 'no work started' in text(), 'Cancel did not finish safely'
    assert not list(home.rglob('spec.json')), 'Unexpected worker specification created'
    definition = {'mode': 'parallel', 'isolation': 'shared', 'maxCost': 2, 'tasks': [
        {'profile': 'reviewer', 'lane': name, 'task': f'Inspect {name} only. ' + 'Exact scoped instruction. ' * 30}
        for name in ('database-license', 'timezone', 'localization', 'database-models-costs')
    ]}
    choose('/mesh jobs ' + json.dumps({'action': 'run', 'definition': definition}), 'Mesh work approval')
    assert '[Cancel]' in visible() and '[Approve & start]' in visible(), visible()
    assert 'Budget: up to $2' in visible(), visible()
    os.write(master, b'd')
    pump(0.4)
    assert 'Mesh work: exact details' in visible(), visible()
    for _ in range(30):
        os.write(master, b'\x1b[6~')
        pump(0.01)
    assert '[Cancel]' in visible() and '[Approve & start]' in visible(), visible()
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 12, 40, 0, 0))
    screen.resize(lines=12, columns=40)
    os.kill(pid, signal.SIGWINCH)
    pump(0.5)
    assert '[Cancel]' in visible() and '[Approve & start]' in visible(), visible()
    Path('/tmp/mesh-approval-visible.txt').write_text(visible())
    os.write(master, b'\x1b')
    pump(0.7)
    assert not list(home.rglob('spec.json')), 'Cancel unexpectedly launched a worker'
    # Synthetic metadata only: exercise the actual Pi footer without a runner,
    # execution spec, approval or provider request.
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 140, 0, 0))
    screen.resize(lines=36, columns=140)
    os.kill(pid, signal.SIGWINCH)
    run_id = '11111111-1111-4111-8111-111111111111'
    run_dir = home / 'mesh/data/runs' / run_id
    run_dir.mkdir(parents=True)
    state = {'id': run_id, 'project': str(home.resolve()), 'createdAt': '2026-10-02T00:00:00Z', 'heartbeat': int(time.time()*1000), 'state': 'paused', 'steps': [], 'usage': {'tokens': 42, 'cost': 0.01}}
    (run_dir / 'state.json').write_text(json.dumps(state))
    output = b''
    pump(6)
    assert 'Mesh 11111111' in text() and 'PAUSED' in text(), 'Background footer did not restore paused metadata'
    state['state'] = 'completed'
    (run_dir / 'state.json').write_text(json.dumps(state))
    output = b''
    pump(2)
    assert 'FINISHED' in text() and 'see results' in text(), 'Footer did not update to terminal state'
    assert not list(home.rglob('spec.json')), 'Unexpected worker specification created'
    Path('/tmp/mesh-simple-tui.txt').write_text(text())
    print('PASS: actual history-style Mesh TUI, read-only scope, model/budget edits, Advanced/details, resize/Cancel and live native footer paused/finished updates; no worker/model generation')
finally:
    try: os.kill(pid, signal.SIGTERM)
    except ProcessLookupError: pass
    time.sleep(0.3)
    try:
        waited, _ = os.waitpid(pid, os.WNOHANG)
        if waited == 0:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
    except (ProcessLookupError, ChildProcessError): pass
    try:
        cfg = json.loads((home / 'mesh/config.json').read_text())
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=1) as response: health = json.load(response)
        if health.get('instance') == hashlib.sha256(cfg['token'].encode()).hexdigest()[:16]:
            os.kill(int(health['pid']), signal.SIGTERM)
    except (OSError, ValueError, KeyError): pass
    os.close(master)
    time.sleep(0.2)
    shutil.rmtree(home)
