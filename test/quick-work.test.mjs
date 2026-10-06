import test from 'node:test';
import assert from 'node:assert/strict';
import { quickWorkRequest } from '../quick-work.mjs';

test('simple reviewer/scout commands map to one explicit work request without launching',()=>{
 const review=quickWorkRequest('review Check auth changes against the threat model.');
 assert.deepEqual(review,{action:'run',definition:{scope:'review',tasks:[{profile:'reviewer',task:'Check auth changes against the threat model.'}]}});
 assert.match(quickWorkRequest('SCOUT').definition.tasks[0].task,/Do not modify files/);
 assert.equal(quickWorkRequest('profiles'),null);
 assert.equal(quickWorkRequest('{"action":"preview"}'),null);
});
