import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadGraph, compactWays, mainComponent } from '../src/osm.js';

test('OSM ways become a routable graph split at intersections, respecting one-ways', () => {
  const g = (pts) => pts.map(([lat, lon]) => ({ lat, lon }));
  const ways = compactWays({ elements: [
    // Two-way street A-B-C, crossed at B by a one-way street D->B->E
    { type: 'way', id: 1, nodes: [1, 2, 3], geometry: g([[45.46, 9.18], [45.46, 9.19], [45.46, 9.20]]), tags: { highway: 'primary', name: 'Corso Test' } },
    { type: 'way', id: 2, nodes: [4, 2, 5], geometry: g([[45.45, 9.19], [45.46, 9.19], [45.47, 9.19]]), tags: { highway: 'secondary', oneway: 'yes', maxspeed: '30' } },
    { type: 'way', id: 3, nodes: [8, 9], geometry: g([[45.50, 9.30], [45.501, 9.30]]), tags: { highway: 'tertiary' } }, // isolated
    { type: 'node', id: 99 },
  ] });
  assert.equal(ways.length, 3);
  const net = buildRoadGraph(ways);
  assert.equal(net.edges.length, 5); // way 1 and way 2 each split at node 2
  const corso = net.edges.filter((e) => e.name === 'Corso Test');
  assert.equal(corso.length, 2);
  assert.ok(corso.every((e) => !e.oneway && e.speed === 50 && e.type === 'arterial'));
  const oneway = net.edges.filter((e) => e.oneway);
  assert.equal(oneway.length, 2);
  assert.ok(oneway.every((e) => e.speed === 30 && e.name === 'Unnamed road'));
  // One-way edges are only traversable forwards
  const b = net.edges.find((e) => e.name === 'Corso Test').b;
  const outOfB = net.adj.get(b).map((x) => net.edges[x.e]);
  assert.equal(outOfB.filter((e) => e.oneway).length, 1);
  assert.equal(mainComponent(net).length, 5);
});
