"""Actual native Pi inline config Cancel/Escape/Save; isolated project, no providers/broker."""
import fcntl, json, os, pty, re, select, shutil, signal, struct, subprocess, tempfile, termios, time
from pathlib import Path
root = Path(os.environ.get('MESH_TEST_EXTENSION_ROOT', Path(__file__).resolve().parent.parent))
home = Path(tempfile.mkdtemp(prefix='mesh-config-tui-'))
agent = home / 'agent'; agent.mkdir()
(agent / 'models.json').write_text(json.dumps({'providers': {'fixture': {'baseUrl': 'http://127.0.0.1:9/v1', 'api': 'openai-completions', 'apiKey': 'unused', 'models': [{'id': 'one', 'reasoning': False}]}}}))
(agent / 'settings.json').write_text(json.dumps({'defaultProvider': 'fixture', 'defaultModel': 'one'}))
extension = home / 'config.ts'
extension.write_text('import {editProjectConfig} from ' + json.dumps(str(root / 'config-tui.ts')) + ';\n' + '''export default function(pi) {
 let sequence=0;
 pi.registerCommand('fixture-config', {handler:async(_args,ctx)=>{const result=await editProjectConfig(ctx);ctx.ui.notify((result?'FIXTURE SAVED':'FIXTURE CANCELLED')+' '+(++sequence),'info')}});
}''')
# Resolve the actual installed entrypoint, not a Volta shim owning a grandchild PTY.
cli = os.environ.get('MESH_PI_CLI_FILE')
if not cli and shutil.which('volta'):
 try: cli = subprocess.check_output(['volta','which','pi'],text=True,stderr=subprocess.DEVNULL).strip()
 except subprocess.CalledProcessError: pass
cli = cli or shutil.which('pi')
with open(cli,'rb') as executable: node_script = b'node' in executable.read(100).split(b'\n')[0]
command = [subprocess.check_output(['node','-p','process.execPath'],text=True).strip(),cli] if node_script else [cli]
env = dict(os.environ, TERM='xterm-256color', COLORTERM='truecolor', PI_CODING_AGENT_DIR=str(agent), PI_SKIP_VERSION_CHECK='1', PI_OFFLINE='1')
pid, master = pty.fork()
if pid == 0:
 os.chdir(home); os.execvpe(command[0], command + ['--no-session','--no-extensions','--no-skills','--no-prompt-templates','--no-context-files','-e',str(extension)], env)
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 120, 0, 0))
output = b''
def pump(seconds):
 global output
 end = time.monotonic()+seconds
 while time.monotonic()<end:
  if select.select([master],[],[],0.1)[0]:
   try: data=os.read(master,65536)
   except OSError: break
   output += data
   if b'\x1b[6n' in data: os.write(master,b'\x1b[1;1R')
def text(): return re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',output.decode('utf-8','replace'))
try:
 pump(2)
 path=home/'.pi'/'mesh'/'config.json'
 for choice in ['cancel','escape','invalid','save']:
  output=b'';os.write(master,b'/fixture-config\r');pump(0.7)
  assert 'MESH PROJECT CONFIG' in text(), text()[-3000:]
  assert 'Cancel' in text() and 'Save' in text(), text()[-3000:]
  assert not path.exists(), 'Opening or cancelling must not save'
  if choice=='cancel': os.write(master,b'\t');pump(0.12);os.write(master,b'\r')
  elif choice=='escape': os.write(master,b'\x1b')
  else:
   if choice=='invalid':os.write(master,b'x');pump(0.12)
   else:fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',24,44,0,0));os.kill(pid,signal.SIGWINCH);pump(0.2)
   os.write(master,b'\t');pump(0.12);os.write(master,b'\t');pump(0.12);os.write(master,b'\r')
   if choice=='invalid':
    pump(0.5);assert not path.exists();assert 'FIXTURE SAVED' not in text();os.write(master,b'\x1b')
  pump(0.6)
  assert ('FIXTURE SAVED' if choice=='save' else 'FIXTURE CANCELLED') in text(),text()[-3000:]
 assert json.loads(path.read_text())['defaults']['concurrency']=='auto'
 assert 'Unknown theme color' not in text()
 assert not (agent/'crashes.json').exists()
 print('PASS: actual Pi inline project config shows Cancel/Save, cancels without writes, rejects invalid JSON, resizes and deliberately saves; no workers/provider calls', flush=True)
finally:
 os.close(master)
 try:
  os.kill(pid,signal.SIGTERM);time.sleep(0.3)
  exited,_=os.waitpid(pid,os.WNOHANG)
  if exited==0:os.kill(pid,signal.SIGKILL);os.waitpid(pid,0)
 except (ProcessLookupError,ChildProcessError):pass
 shutil.rmtree(home)
