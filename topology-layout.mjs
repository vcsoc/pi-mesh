// Pure deterministic project layout: no force simulation or DOM measurements.
const order = (a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)) || String(a.id).localeCompare(String(b.id));
const identity = agent => agent.projectHash || agent.cwd || `unassigned:${agent.id}`;
export function neighbourhoodLayout(agents, channels) {
  const positions = new Map(), groups = new Map(), parentLinks = [];
  for (const agent of [...agents].sort(order)) {
    const key = identity(agent);
    if (!groups.has(key)) groups.set(key, { key, label: agent.projectName || agent.cwd || 'Unassigned project', agents: [], channels: [] });
    groups.get(key).agents.push(agent);
  }
  const byAgent = new Map(agents.map(agent => [agent.id, agent]));
  for (const channel of channels) {
    const counts = new Map();
    for (const agent of agents) if ((agent.channels || []).some(name => String(name).toLowerCase() === String(channel.name).toLowerCase() || (channel.aliases || []).some(alias => String(alias).toLowerCase() === String(name).toLowerCase()))) {
      const key = identity(agent); counts.set(key, (counts.get(key) || 0) + 1);
    }
    const key = channel.userOnly || !counts.size ? 'shared-channels' : [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    if (!groups.has(key)) groups.set(key, { key, label: 'Shared channels', agents: [], channels: [] });
    groups.get(key).channels.push(channel);
  }
  const regions = [];
  for (const group of [...groups.values()].sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key))) {
    const local = new Map(), leaders = group.agents.filter(agent => agent.role === 'orchestrator' && !agent.parentAgentId);
    // Legacy participants without roles remain visible; fallback grouping is not a parent claim.
    if (!leaders.length && group.agents.length) leaders.push(group.agents[0]);
    const families = new Map(leaders.map(agent => [agent.id, { leader: agent, children: [] }]));
    for (const agent of group.agents) {
      if (families.has(agent.id)) continue;
      const parent = byAgent.get(agent.parentAgentId);
      const family = families.get(parent?.id) || families.get(leaders[0]?.id);
      family?.children.push(agent);
      if (parent && identity(parent) === group.key) parentLinks.push([`agent:${parent.id}`, `agent:${agent.id}`]);
    }
    let cursor = 40, maxBottom = 100;
    const channelRows = Math.ceil(group.channels.length / 4), familyTop = 100 + channelRows * 76;
    for (const family of families.values()) {
      const nodes = [{ id: `agent:${family.leader.id}`, x: 0, y: 0, z: 0 }];
      let ring = 1, slot = 0;
      for (const child of family.children) {
        let point;
        do {
          const capacity = ring * 8, angle = slot * 2 * Math.PI / capacity;
          point = { id: `agent:${child.id}`, x: Math.cos(angle) * ring * 230, y: Math.sin(angle) * ring * 190, z: 0 };
          if (++slot === capacity) { ring++; slot = 0; }
        } while (nodes.some(node => Math.abs(node.x - point.x) < 160 && Math.abs(node.y - point.y) < 76));
        nodes.push(point);
      }
      const minX = Math.min(...nodes.map(node => node.x)), maxX = Math.max(...nodes.map(node => node.x));
      const minY = Math.min(...nodes.map(node => node.y)), maxY = Math.max(...nodes.map(node => node.y));
      for (const node of nodes) local.set(node.id, { ...node, x: cursor + 80 + node.x - minX, y: familyTop + 30 + node.y - minY });
      cursor += maxX - minX + 240;
      maxBottom = Math.max(maxBottom, familyTop + maxY - minY + 120);
    }
    group.channels.forEach((channel, index) => local.set(`channel:${channel.name}`, { id: `channel:${channel.name}`, x: 120 + (index % 4) * 180, y: 90 + Math.floor(index / 4) * 76, z: 0 }));
    regions.push({ key: group.key, label: group.label, members: group.agents.length, width: Math.max(300, cursor, Math.min(4, group.channels.length) * 180 + 80), height: Math.max(maxBottom, familyTop + 50), local });
  }
  const area = regions.reduce((sum, region) => sum + (region.width + 80) * (region.height + 80), 0);
  const target = Math.max(1000, Math.sqrt(area) * 1.25);
  let x = 40, y = 40, rowHeight = 0, width = 240;
  for (const region of regions) {
    if (x > 40 && x + region.width > target) { x = 40; y += rowHeight + 100; rowHeight = 0; }
    region.x = x; region.y = y;
    for (const [key, point] of region.local) positions.set(key, { ...point, x: point.x + x, y: point.y + y, project: region.key });
    delete region.local;
    x += region.width + 100; rowHeight = Math.max(rowHeight, region.height); width = Math.max(width, x);
  }
  return { positions, regions, parentLinks, width, height: y + rowHeight + 60, orbits: [] };
}
