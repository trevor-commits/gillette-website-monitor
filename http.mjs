import {lookup} from 'node:dns/promises';
const failures=[];
try{await lookup('gillettewsc.com');}catch{failures.push('dns');}
for(const [path,needle] of [['/','Send quote request'],['/api/health?ready=1&monitor=1','"ok":true']])try{
 const r=await fetch('https://gillettewsc.com'+path,{redirect:'error',signal:AbortSignal.timeout(15000)});
 if(r.status!==200 || !(await r.text()).includes(needle))failures.push(path==='/'?'homepage':'readiness');
}catch{failures.push(path==='/'?'https_homepage':'https_readiness');}
if(process.env.FORCE_FAILURE==='true')failures.push('isolated_observer_fixture');
const result={checkedAt:new Date().toISOString(),failures,leadPosts:0,scope:'Public DNS/TLS/homepage/full readiness; independent of website runtime and Mac'};
const url=process.env.HEALTHCHECKS_HTTP_PING_URL;
if(!/^https:\/\/hc-ping\.com\/[0-9a-f-]{36}$/.test(url||''))throw Error('Private heartbeat configuration missing or invalid');
try{const r=await fetch(url+(failures.length?'/fail':''),{method:'POST',body:failures.length?'independent website checks failed':'independent website checks passed',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();result.independentHeartbeat='accepted';}
catch{failures.push('independent_heartbeat');}
console.log(JSON.stringify(result,null,2));if(failures.length)process.exitCode=1;
