"""Real Pi PTY: reload old Mesh, queue Enter/Alt+Enter during local fake SSE.
No user credentials, production broker, workers or real provider inference.
"""
import fcntl, hashlib, http.server, json, os, pty, re, select, shutil, signal, socket, struct, tempfile, termios, threading, time, urllib.request
from pathlib import Path

root = Path(os.environ.get('MESH_QUEUE_TEST_ROOT', Path(__file__).resolve().parent.parent))
old_root = os.environ.get('MESH_QUEUE_OLD_ROOT')
home = Path(tempfile.mkdtemp(prefix='mesh-input-queue-tui-'))
agent, project = home / 'agent', home / 'project'
agent.mkdir(); project.mkdir()
(project / 'fixture.txt').write_text('LOCAL_TUI_TOOL_COMPLETED')
requests, errors = [], []
release = threading.Event()
class Provider(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_POST(self):
        try:
            assert self.path == '/v1/chat/completions'
            assert self.headers.get('Authorization') == 'Bearer FIXTURE_ONLY'
            requests.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
            number = len(requests)
            self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
            def send(value):
                self.wfile.write(('data: ' + json.dumps(value) + '\n\n').encode()); self.wfile.flush()
            send({'id': 'fixture', 'choices': [{'index': 0, 'delta': {'role': 'assistant', 'content': 'TUI_RUNNING' if number == 1 else f'TUI_RESPONSE_{number}'}}]})
            if number == 1:
                assert release.wait(12), 'held stream was never released'
                send({'id': 'fixture', 'choices': [{'index': 0, 'delta': {'tool_calls': [{'index': 0, 'id': 'read_fixture', 'type': 'function', 'function': {'name': 'read', 'arguments': '{"path":"fixture.txt"}'}}]}}]})
            send({'id': 'fixture', 'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'tool_calls' if number == 1 else 'stop'}]})
            send({'choices': [], 'usage': {'prompt_tokens': 10, 'completion_tokens': 2, 'total_tokens': 12}})
            self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
        except Exception as error: errors.append(str(error))
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Provider)
threading.Thread(target=server.serve_forever, daemon=True).start()
endpoint = f'http://127.0.0.1:{server.server_port}/v1'
(agent / 'models.json').write_text(json.dumps({'providers': {'queue-fixture': {'baseUrl': endpoint, 'api': 'openai-completions', 'apiKey': 'FIXTURE_ONLY', 'models': [{'id': 'local', 'reasoning': False, 'contextWindow': 128000, 'maxTokens': 1024, 'cost': {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0}}]}}}))
(agent / 'settings.json').write_text(json.dumps({'defaultProvider': 'queue-fixture', 'defaultModel': 'local', 'defaultThinkingLevel': 'off', 'autoRetry': {'enabled': False}, 'compaction': {'enabled': False}}))
# Optional old→new reload proof: replace only the isolated candidate entry point.
candidate = home / 'mesh-extension'
shutil.copytree(Path(old_root) if old_root else root, candidate)
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
env = dict(os.environ, TERM='xterm-256color', PI_CODING_AGENT_DIR=str(agent), PI_AGENT_MESH_HOME=str(home / 'mesh'), PI_AGENT_MESH_PORT=str(port), PI_SKIP_VERSION_CHECK='1', PI_OFFLINE='1')
pid, master = pty.fork()
if pid == 0:
    os.chdir(project)
    os.execvpe('pi', ['pi', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '--session-dir', str(home / 'sessions'), '--tools', 'read', '-e', str(candidate / 'index.ts')], env)
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 140, 0, 0))
output = b''
def pump(seconds):
    global output
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if select.select([master], [], [], 0.05)[0]:
            try: data = os.read(master, 65536)
            except OSError: break
            output += data
            if b'\x1b[6n' in data: os.write(master, b'\x1b[1;1R')
def screen(): return re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', output.decode('utf-8', 'replace'))
def wait(check, label):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        pump(0.05)
        if check(): return
    raise AssertionError(label + ': ' + screen()[-2500:])
def messages():
    return [record['message'] for file in (home / 'sessions').rglob('*.jsonl') for line in file.read_text().splitlines() if (record := json.loads(line)).get('type') == 'message']
try:
    pump(1.2)
    if old_root:
        assert 'current.abort();' in (candidate / 'index.ts').read_text()
        shutil.copy2(root / 'index.ts', candidate / 'index.ts')
        os.write(master, b'/reload\r')
        wait(lambda: 'Reloaded' in screen() or 'reloaded' in screen(), 'reload did not complete')
        pump(0.2)
    os.write(master, b'INITIAL_TUI_QUEUE_FIXTURE\r')
    wait(lambda: len(requests) == 1 and 'TUI_RUNNING' in screen(), 'initial local stream not active')
    os.write(master, b'STEER_TUI_QUEUE_FIXTURE\r')
    pump(0.15)
    os.write(master, b'FOLLOWUP_TUI_QUEUE_FIXTURE\x1b\r')
    pump(0.25)
    assert len(requests) == 1, 'queued messages started model work before the turn boundary'
    assert 'Operation aborted' not in screen(), 'ordinary native keyboard input aborted the operation'
    release.set()
    wait(lambda: len(requests) == 3 and len([m for m in messages() if m.get('role') == 'assistant']) == 3, 'queued work did not complete')
    bodies = [json.dumps(request['messages']) for request in requests]
    assert 'STEER_TUI_QUEUE_FIXTURE' in bodies[1] and 'LOCAL_TUI_TOOL_COMPLETED' in bodies[1]
    assert 'FOLLOWUP_TUI_QUEUE_FIXTURE' not in bodies[1], 'Alt+Enter was treated as steering'
    assert 'FOLLOWUP_TUI_QUEUE_FIXTURE' in bodies[2]
    assert [m['stopReason'] for m in messages() if m.get('role') == 'assistant'] == ['toolUse', 'stop', 'stop']
    assert not errors, errors
    assert not list(home.rglob('spec.json')), 'unexpected child execution specification'
    print('PASS: actual Pi Enter steering +Alt/Enter follow-up preserve stream/tool batch and drain in order; old→new /reload verified' if old_root else 'PASS: actual Pi Enter steering +Alt/Enter follow-up preserve stream/tool batch and drain in order; no provider inference')
finally:
    release.set()
    # Close our PTY before waiting: Darwin can otherwise retain an exiting session leader.
    os.close(master)
    try: os.kill(pid, signal.SIGTERM)
    except ProcessLookupError: pass
    time.sleep(0.2)
    try:
        waited, _ = os.waitpid(pid, os.WNOHANG)
        if waited == 0: os.kill(pid, signal.SIGKILL); os.waitpid(pid, 0)
    except (ProcessLookupError, ChildProcessError): pass
    try:
        cfg = json.loads((home / 'mesh/config.json').read_text())
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=1) as response: health = json.load(response)
        if health.get('instance') == hashlib.sha256(cfg['token'].encode()).hexdigest()[:16]: os.kill(int(health['pid']), signal.SIGTERM)
    except (OSError, ValueError, KeyError): pass
    server.shutdown(); server.server_close(); time.sleep(0.2)
    shutil.rmtree(home)
