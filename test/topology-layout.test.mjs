import test from 'node:test';
import assert from 'node:assert/strict';
import { neighbourhoodLayout } from '../topology-layout.mjs';
const fixture = (projects = 5, children = 12) => Array.from({ length: projects }, (_, project) => [
  { id: `orc-${project}`, name: `Orchestrator ${project}`, role: 'orchestrator', projectHash: `hash-${project}`, projectName: `Project ${project}`, channels: [`project-${project}`] },
  ...Array.from({ length: children }, (_, index) => ({ id: `child-${project}-${index}`, name: `Worker ${index}`, role: 'reviewer', parentAgentId: `orc-${project}`, projectHash: `hash-${project}`, projectName: `Project ${project}`, channels: [`project-${project}`, 'user'] })),
]).flat();
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
test('project neighbourhoods and every label are separate; verified children link to their own parent', () => {
  const agents = fixture(), channels = Array.from({ length: 5 }, (_, index) => ({ name: `project-${index}` }));
  channels.push({ name: 'user', userOnly: true });
  const layout = neighbourhoodLayout(agents, channels), nodes = [...layout.positions.values()];
  assert.equal(nodes.length, agents.length + channels.length);
  assert.equal(layout.parentLinks.length, 60);
  for (const [index, region] of layout.regions.entries()) {
    for (const other of layout.regions.slice(index + 1)) assert.equal(overlaps(region, other), false);
    for (const node of nodes.filter(node => node.project === region.key)) {
      assert.ok(node.x >= region.x + 70 && node.x <= region.x + region.width - 60);
      assert.ok(node.y >= region.y + 65 && node.y + 50 <= region.y + region.height);
    }
  }
  for (const [index, node] of nodes.entries()) for (const other of nodes.slice(index + 1))
    assert.ok(Math.abs(node.x - other.x) >= 152 || Math.abs(node.y - other.y) >= 60);
  const reversed = neighbourhoodLayout([...agents].reverse(), channels);
  assert.deepEqual([...layout.positions].sort(), [...reversed.positions].sort());
});
test('identical project names stay separate and missing parents do not invent child relationships', () => {
  const agents = fixture(2, 1).map(agent => ({ ...agent, projectName: 'same', parentAgentId: 'missing' }));
  const layout = neighbourhoodLayout(agents, []);
  assert.equal(layout.regions.length, 2);
  assert.equal(layout.parentLinks.length, 0);
  assert.equal(layout.positions.size, agents.length);
  assert.equal(neighbourhoodLayout([], []).positions.size, 0);
});
test('large neighbourhood layout completes without an iterative force simulation', () => {
  const start = performance.now(), layout = neighbourhoodLayout(fixture(20, 24), []);
  assert.equal(layout.positions.size, 500);
  assert.ok(performance.now() - start < 500, '500 agents should lay out within a conservative 500ms budget');
});
