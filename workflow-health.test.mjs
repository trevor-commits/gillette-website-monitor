import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const workflow=name=>readFileSync(new URL(`.github/workflows/${name}.yml`,import.meta.url),'utf8');
for(const name of ['monitor','backup']) {
  const source=workflow(name);
  const warning=source.slice(source.indexOf('      - name: Signal an independent failure\n'));
  const code=warning.match(/        run: \|\n((?:          .*\n|\n)+)/)?.[1].split('\n').map(line=>line.slice(10)).join('\n').trim().split('\n').slice(1,-1).join('\n');
  test(`${name}: setup/probe failures use the existing independent warning capability`,async()=>{
    assert.ok(code,'failure signal is present');assert.match(warning,/if: failure\(\)/);
    for(const [url,ok,expectedCalls] of [
      ['https://hc-ping.com/00000000-0000-0000-0000-000000000000',true,1],
      ['https://hc-ping.com/00000000-0000-0000-0000-000000000000',false,1],
      ['https://untrusted.invalid/private',true,0],['',true,0]
    ]) {
      const calls=[];
      const result=runInNewContext(`(async()=>{${code}})()`,{process:{env:{PING_URL:url}},AbortSignal,
        fetch:async(target,options)=>{calls.push({target,body:options.body});return {ok};}});
      if(ok&&expectedCalls)await result;else await assert.rejects(result);
      assert.equal(calls.length,expectedCalls);
      if(calls.length){assert.equal(calls[0].target,url+'/fail');assert.ok(!calls[0].body.includes(url));}
    }
    assert.match(source,/if: always\(\)/,'private capabilities clean up even on failure');
    assert.doesNotMatch(source,/pull_request:|push:|^  schedule:/m,'no automatic routine CI or duplicate clock');
  });
}
test('bounded dependency and execution steps leave the warning/cleanup path within the job',()=>{
  const browser=workflow('monitor'),backup=workflow('backup');
  for(const [name,limit] of [['Install browser packages',2],['Install browser runtime',3],['Run browser probe',3]])
    assert.ok(browser.includes(`- name: ${name}\n        timeout-minutes: ${limit}`),name);
  assert.match(backup,/- name: Export, encrypt, upload and independently verify\n        timeout-minutes: 4/);
});
