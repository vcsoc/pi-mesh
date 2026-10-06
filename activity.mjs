// Presence remains idle/working/offline for compatibility; activity adds detail.
export function createActivity() {
  let running = false, phase = 'thinking';
  const tools = new Set(), waiting = new Set();
  const value = () => running ? (tools.size ? 'working' : phase) : waiting.size ? 'waiting' : 'idle';
  return {
    value,
    update(event, data) {
      const before = value();
      if (event === 'start') { running = true; phase = 'thinking'; }
      if (event === 'settled') { running = false; tools.clear(); }
      if (event === 'phase') phase = data === 'thinking' ? 'thinking' : 'working';
      if (event === 'tool-start') tools.add(data);
      if (event === 'tool-end') { tools.delete(data); phase = 'thinking'; }
      if (event === 'wait') for (const id of data || []) waiting.add(id);
      if (event === 'receive') waiting.delete(data);
      if (event === 'reset') { running = false; phase = 'thinking'; tools.clear(); waiting.clear(); }
      return before !== value();
    },
  };
}
