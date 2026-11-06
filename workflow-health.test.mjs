import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
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
test('browser setup avoids package mirrors while retaining runtime validation and failure reporting',()=>{
  const source=workflow('monitor');
  const setup=source.slice(source.indexOf('      - name: Install browser runtime\n'),source.indexOf('      - name: Private heartbeat capability\n'));
  assert.doesNotMatch(setup,/--with-deps|\binstall-deps\b|\bapt(?:-get)?\b/,'runner libraries must not trigger mirror-dependent font installation');
  assert.match(setup,/run: npx playwright install chromium\n/);
  assert.match(source,/- name: Run browser probe\n        timeout-minutes: 3\n        run: node browser\.mjs/,'the real browser must still launch and validate its dependencies');
  assert.match(source,/- name: Signal an independent failure\n        if: failure\(\)/);
});

test('backup installer verifies the pinned archive before executing it and cleans failed downloads',()=>{
  const source=workflow('backup');
  const setup=source.match(/      - name: Install (?:Ubuntu|pinned) rclone\n[\s\S]*?        run: \|\n((?:          .*\n|\n)+)/)?.[1]
    .split('\n').map(line=>line.slice(10)).join('\n');
  assert.ok(setup,'backup dependency installer is present');
  assert.doesNotMatch(setup,/\bapt(?:-get)?\b/,'backup setup must not wait for a package mirror');
  const pin=setup.match(/checksum=([a-f0-9]{64})/);
  assert.ok(pin,'release archive has a fixed SHA256 pin');
  // A tiny zip containing only a harmless executable; no network, credentials or real backup.
  const archive=Buffer.from('UEsDBBQAAAAAAAAAIVC/7moMVAAAAFQAAAAhAAAAcmNsb25lLXYxLjc1LjItbGludXgtYW1kNjQvcmNsb25lIyEvYmluL3NoCmVjaG8gInJjbG9uZSBpbnN0YWxsZXIgdGVzdCBmaXh0dXJlIgp0b3VjaCAiJFJVTk5FUl9URU1QL3JjbG9uZS1leGVjdXRlZCIKUEsBAhQDFAAAAAAAAAAhUL/uagxUAAAAVAAAACEAAAAAAAAAAAAAAIABAAAAAHJjbG9uZS12MS43NS4yLWxpbnV4LWFtZDY0L3JjbG9uZVBLBQYAAAAAAQABAE8AAACTAAAAAAA=','base64');
  const digest=createHash('sha256').update(archive).digest('hex');
  for(const mode of ['valid','corrupt','transfer-failed']) {
    const root=mkdtempSync(join(tmpdir(),'gillette-rclone-installer-'));
    try {
      const bin=join(root,'bin');mkdirSync(bin);
      const fixture=join(root,'fixture.zip');writeFileSync(fixture,mode==='corrupt'?Buffer.from('bad archive'):archive);
      writeFileSync(join(bin,'curl'),'#!/bin/sh\nif [ "$TEST_TRANSFER_FAILURE" = 1 ]; then exit 22; fi\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = --output ]; then cp "$TEST_ARCHIVE" "$2"; exit 0; fi\n  shift\ndone\nexit 2\n',{mode:0o700});
      const result=spawnSync('bash',['-c',setup.replace(pin[1],digest)],{
        env:{...process.env,PATH:bin+':'+process.env.PATH,RUNNER_TEMP:root,TEST_ARCHIVE:fixture,TEST_TRANSFER_FAILURE:mode==='transfer-failed'?'1':'0'},
        encoding:'utf8',timeout:10_000
      });
      if(mode==='valid') {
        assert.equal(result.status,0,result.stderr);
        assert.match(result.stdout,/rclone installer test fixture/);
        assert.ok(existsSync(join(root,'gillette-backup-rclone','rclone')));
        assert.ok(existsSync(join(root,'rclone-executed')));
      } else {
        assert.notEqual(result.status,0,'failed download/integrity must stop installation');
        assert.equal(existsSync(join(root,'gillette-backup-rclone','rclone')),false);
        assert.equal(existsSync(join(root,'rclone-executed')),false);
      }
      assert.equal(existsSync(join(root,'gillette-backup-rclone','rclone.zip')),false,'archive is reaped on every exit');
    } finally {rmSync(root,{recursive:true,force:true});}
  }
  assert.match(source,/rclone:join\(e.RUNNER_TEMP,'gillette-backup-rclone','rclone'\)/,'backup uses the verified binary');
  assert.match(source,/'gillette-encrypted-backup','gillette-backup-rclone'/,'existing always-cleanup also removes the tool');
  assert.match(source,/- name: Install pinned rclone\n        timeout-minutes: 3/,'original setup deadline stays bounded');
});
