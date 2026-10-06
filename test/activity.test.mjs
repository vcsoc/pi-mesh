import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivity } from '../activity.mjs';
test('live activity respects overlapping tools and pending peer replies', () => {
 const a=createActivity();assert.equal(a.value(),'idle');
 a.update('start');assert.equal(a.value(),'thinking');
 a.update('tool-start','one');a.update('tool-start','two');assert.equal(a.value(),'working');
 a.update('tool-end','one');assert.equal(a.value(),'working');
 a.update('tool-end','two');assert.equal(a.value(),'thinking');
 a.update('wait',['peer']);a.update('settled');assert.equal(a.value(),'waiting');
 a.update('receive','other');assert.equal(a.value(),'waiting');
 a.update('receive','peer');assert.equal(a.value(),'idle');
 a.update('wait',['peer']);a.update('reset');assert.equal(a.value(),'idle');
});
test('unchanged streaming phases do not send per-token heartbeats',()=>{
 const a=createActivity();assert.equal(a.update('start'),true);
 assert.equal(a.update('phase','thinking'),false);
 assert.equal(a.update('phase','working'),true);
 assert.equal(a.update('phase','working'),false);
});
