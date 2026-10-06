import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export const profiles = Object.freeze({
 orchestrator: { write: false, prompt: 'Plan and coordinate the assigned scope. Identify dependencies and report verified outcomes. Do not recursively spawn agents.' },
 developer: { write: true, prompt: 'Implement the assigned change, preserve unrelated files, verify behavior, and report evidence. Do not commit or push without explicit authorization.' },
 tester: { write: true, prompt: 'Develop and run focused tests for the assigned scope. Distinguish mocked from live evidence and report failures without masking them.' },
 architect: { write: false, prompt: 'Design the solution and document constraints, boundaries, migration risks and acceptance criteria. Do not edit.' },
 scout: { write: false, prompt: 'Inspect the codebase. Identify relevant files, execution paths, risks and unanswered questions. Do not edit.' },
 reviewer: { write: false, prompt: 'Review correctness, security, regressions and tests. Report concrete findings with file references. Do not edit.' },
 advisor: { write: false, prompt: 'Challenge the proposed approach. Explain tradeoffs and uncertainties. Do not edit.' },
 researcher: { write: false, prompt: 'Research using the supplied local documents. Cite exact sources and distinguish evidence from inference. External web access is unavailable unless the parent supplies sources. Do not edit.' },
 auditor: { write: false, prompt: 'Audit whether claims are supported by the supplied evidence. Report unsupported claims and missing tests. Do not edit.' },
 worker: { write: true, prompt: 'Implement only the explicitly assigned scope. Preserve unrelated changes, run relevant checks, and report files changed, evidence and unresolved decisions. Do not commit or push unless specifically authorized.' },
 delegate: { write: false, prompt: 'Complete the assigned analysis task and return a concise evidence-backed answer. Do not edit.' },
});

export function createJobs({ directory, createSession, notify = () => {}, concurrency = 3, budget = 64 }) {
 const jobs = new Map(), queue = []; let active = 0, count = 0, closed = false;
 const publicJob = job => ({ id: job.id, profile: job.profile, task: job.task, state: job.state, startedAt: job.startedAt, finishedAt: job.finishedAt, output: job.output, error: job.error, usage: job.usage });
 async function persist(job) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `${job.id}.json`), temp = file + '.tmp';
  await writeFile(temp, JSON.stringify(publicJob(job), null, 2), { mode: 0o600 }); await rename(temp, file);
 }
 function pump() {
  while (!closed && active < concurrency && queue.length) {
   const job = queue.shift(); if (job.cancelled) continue;
   active++; void execute(job).finally(() => { active--; pump(); });
  }
 }
 async function execute(job) {
  let session, unsubscribe, timer;
  try {
   job.state = 'running'; job.startedAt = new Date().toISOString(); await persist(job); notify(publicJob(job));
   timer = setTimeout(() => { job.cancelled = true; job.error = 'Runtime deadline exceeded'; void session?.abort(); }, job.timeout);
   session = await createSession(profiles[job.profile]); job.session = session;
   if (job.cancelled || closed) throw new Error(job.error || 'Cancelled');
   unsubscribe = session.subscribe(event => {
    if (event.type === 'message_end' && event.message?.role === 'assistant' && event.message.usage) job.usage = event.message.usage;
   });
   await session.prompt(job.task);
   if (job.cancelled || closed) throw new Error(job.error || 'Cancelled');
   const last = [...session.messages].reverse().find(m => m.role === 'assistant');
   if (last?.stopReason === 'error' || last?.stopReason === 'aborted') throw new Error(last.errorMessage || 'Child run failed');
   job.output = String(session.getLastAssistantText() || '').slice(-32000); job.state = 'completed';
  } catch (error) { job.error = error.message; job.state = job.cancelled || closed ? 'cancelled' : 'failed'; }
  finally {
   clearTimeout(timer); unsubscribe?.(); session?.dispose(); job.session = undefined;
   job.finishedAt = new Date().toISOString();
   try { await persist(job); } catch (error) { job.state = 'failed'; job.error = `Cannot save job evidence: ${error.message}`; }
   notify(publicJob(job)); job.resolve(publicJob(job));
  }
 }
 function get(id) { const job=jobs.get(id); if (!job) throw new Error('Unknown job in this Pi session'); return job; }
 return {
  start({ profile = 'scout', task, timeout = 600000 }) {
   if (closed) throw new Error('Job manager is closed');
   if (!Object.hasOwn(profiles, profile)) throw new Error('Unknown role profile');
   if (typeof task !== 'string' || !task.trim() || task.length > 32000) throw new Error('Task must contain 1–32000 characters');
   if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 1800000) throw new Error('Runtime must be 1 second to 30 minutes');
   if (++count > budget) throw new Error('Session child-spawn budget exhausted');
   const job = { id: randomUUID(), profile, task, state: 'queued', timeout, output: '' };
   job.done = new Promise(resolve => { job.resolve = resolve; }); jobs.set(job.id, job); queue.push(job); pump();
   return { id: job.id, done: job.done };
  },
  list: () => [...jobs.values()].map(publicJob),
  wait: id => get(id).done,
  async steer(id, message) { const job = get(id); if (!job.session || job.state !== 'running') throw new Error('Job is not running'); if (typeof message !== 'string' || !message.trim() || message.length > 12000) throw new Error('Invalid steering message'); await job.session.steer(message); return { id, queued: true }; },
  async stop(id) {
   const job = get(id); if (!['running','queued'].includes(job.state)) return publicJob(job);
   job.cancelled = true;
   if (job.state === 'queued') { job.state = 'cancelled'; job.finishedAt = new Date().toISOString(); await persist(job); job.resolve(publicJob(job)); notify(publicJob(job)); }
   else await job.session?.abort();
   return job.done;
  },
  async close() { closed = true; await Promise.all([...jobs.values()].filter(j=>['queued','running'].includes(j.state)).map(j=>this.stop(j.id))); },
 };
}
