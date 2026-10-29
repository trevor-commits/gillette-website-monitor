import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{dispatchScheduled} from './workflow-clock.mjs';

const time=Date.parse('2026-10-29T18:40:00Z'),env={GITHUB_ACTIONS_TOKEN:'synthetic'};
for(const [cron,workflow,inputs] of [['40 */6 * * *','backup.yml',{}],['11 */6 * * *','monitor.yml',{runBrowser:true}]]) {
  test(`${workflow}: only the fixed main job is dispatched`,async()=>{
    const calls=[];
    const result=await dispatchScheduled({cron,scheduledTime:time},env,async(url,options)=>{
      calls.push({url,options});
      return calls.length===1?Response.json({workflow_runs:[]}):Response.json({workflow_run_id:1});
    });
    assert.equal(result.state,'dispatched');assert.equal(calls.length,2);
    assert.equal(calls[1].url,`https://api.github.com/repos/trevor-commits/gillette-website-monitor/actions/workflows/${workflow}/dispatches`);
    assert.deepEqual(JSON.parse(calls[1].options.body),{ref:'main',inputs:{...inputs,clockSlot:new Date(time).toISOString()}});
    assert.equal(calls[1].options.redirect,'error');
  });
}
test('known slot does not dispatch again',async()=>{
  let calls=0;
  const result=await dispatchScheduled({cron:'40 */6 * * *',scheduledTime:time},env,async()=>{
    calls++;return Response.json({workflow_runs:[{display_title:`Encrypted website backup — clock ${new Date(time).toISOString()}`} ]});
  });
  assert.equal(calls,1);assert.equal(result.state,'already-dispatched');
});
test('rejects unknown schedules and absent credentials before network access',async()=>{
  const never=()=>{throw Error('Unexpected network access');};
  await assert.rejects(dispatchScheduled({cron:'* * * * *',scheduledTime:time},env,never),/Unrecognized/);
  await assert.rejects(dispatchScheduled({cron:'40 */6 * * *',scheduledTime:NaN},env,never),/Unrecognized/);
  await assert.rejects(dispatchScheduled({cron:'40 */6 * * *',scheduledTime:time},{},never),/credential missing/);
  assert.equal(worker.fetch().status,404);
});
test('inventory failures fail closed',async()=>{
  for(const response of [new Response('',{status:403}),Response.json({})]) {
    let calls=0;
    await assert.rejects(dispatchScheduled({cron:'40 */6 * * *',scheduledTime:time},env,async()=>{calls++;return response;}));
    assert.equal(calls,1);
  }
});
test('failed or ambiguous dispatch is not retried',async()=>{
  for(const ambiguous of [false,true]) {
    let calls=0;
    await assert.rejects(dispatchScheduled({cron:'40 */6 * * *',scheduledTime:time},env,async()=>{
      if(++calls===1)return Response.json({workflow_runs:[]});
      if(ambiguous)throw Error('request timed out');
      return new Response('',{status:503});
    }));
    assert.equal(calls,2);
  }
});
