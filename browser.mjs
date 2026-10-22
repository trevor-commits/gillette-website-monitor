// Non-submitting production probe. No CAPTCHA solving, lead POST, email or customer values.
import {chromium} from 'playwright';
import {writeFileSync,mkdirSync,readFileSync,statSync,statfsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const base=process.argv[2] || 'https://gillettewsc.com';
const fixture=process.argv[3] || '';
if(new URL(base).origin!=='https://gillettewsc.com')throw Error('Only the reviewed production origin is allowed');
if(!['','form_script','address_provider','challenge_script','analytics_script'].includes(fixture))throw Error('Unknown dependency fixture');
mkdirSync('tmp/playwright',{recursive:true});
const record={owner:process.env.GILLETTE_PROBE_OWNER || 'manual:website-operator',purpose:'non-submitting website dependency probe',stop:'BrowserServer.close()',retention:'stop in finally'};
record.nodePid=process.pid;record.nodeStartIdentity=execFileSync('ps',['-p',String(process.pid),'-o','lstart=']).toString().trim();
let browser,server;
const result={checkedAt:new Date().toISOString(),origin:base,fixture,failures:[],leadPosts:0,dependencies:{},analyticsReceipt:'not-observed',rum:{observed:false,fields:[],syntheticQueryIncluded:false,formValuesIncluded:false}};
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{
  const force=setTimeout(()=>{void server?.kill();},5000);force.unref();
  try{await server?.close();record.retention='closed/reaped after '+signal;}
  finally{clearTimeout(force);writeFileSync('tmp/playwright/browser-health-process.json',JSON.stringify(record,null,2));process.exit(143);}
});
try {
  const disk=statfsSync('.');if(disk.bavail*disk.bsize<100*1024*1024)throw Error('Insufficient temporary space');
  server=await chromium.launchServer({headless:true});
  const child=server.process();record.pid=child.pid;record.port=new URL(server.wsEndpoint()).port;
  record.startIdentity=execFileSync('ps',['-p',String(child.pid),'-o','lstart=']).toString().trim();
  writeFileSync('tmp/playwright/browser-health-process.json',JSON.stringify(record,null,2));
  browser=await chromium.connect(server.wsEndpoint());
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
  const page=await context.newPage();
  await page.route('**/api/lead',route=>{result.leadPosts++;return route.abort();});
  if(fixture==='form_script')await page.route('**/_astro/*.js',route=>route.abort());
  if(fixture==='address_provider')await page.route('https://maps.googleapis.com/**',route=>route.abort());
  if(fixture==='challenge_script')await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js',route=>route.fulfill({contentType:'application/javascript',body:'/* Broken HTTP-200 dependency fixture. */'}));
  if(fixture==='analytics_script')await page.route('https://cloud.umami.is/script.js',route=>route.abort());
  page.on('request',request=>{
    if(new URL(request.url()).pathname==='/cdn-cgi/rum')try{
      const body=request.postDataJSON();result.rum.observed=true;result.rum.fields=[...new Set([...result.rum.fields,...Object.keys(body)])];
      result.rum.syntheticQueryIncluded ||= JSON.stringify(body).includes('synthetic-privacy-probe');
      result.rum.formValuesIncluded ||= JSON.stringify(body).includes('Synthetic monitor; not submitted');
    }catch{/* Record no raw payload or private values. */}
  });
  page.on('response',async response=>{
    const url=new URL(response.url());
    if(url.hostname==='maps.googleapis.com' && url.pathname==='/maps/api/js')result.dependencies.addressScript=response.status();
    if(url.hostname==='challenges.cloudflare.com' && url.pathname.endsWith('/api.js'))result.dependencies.challengeScript=response.status();
    if(url.hostname==='cloud.umami.is' && url.pathname==='/script.js')result.dependencies.analyticsScript=response.status();
    if(url.hostname==='gateway.umami.is' && url.pathname==='/api/send')try{
      const body=await response.json();result.analyticsReceipt=body?.beep==='boop'?'bot-filtered':body?.cache?'recorded-token':'accepted-unconfirmed';
    }catch{result.analyticsReceipt='invalid-response';}
  });
  const response=await page.goto(base+'/?privacy_probe=synthetic-privacy-probe',{waitUntil:'networkidle',timeout:30000});
  if(response?.status()!==200)result.failures.push('homepage');
  if(!await page.locator('#quote-form button[type=submit]').isEnabled())result.failures.push('form_script');
  await page.locator('.service-options input').first().check();
  if(await page.locator('#service-count').textContent()!=='1 service selected')result.failures.push('form_script');
  await page.locator('[name=firstName]').fill('Synthetic monitor; not submitted');
  await page.locator('[name=firstName]').press('Tab');
  await page.locator('#address').fill('Sacramento City Hall');
  try{await page.locator('#address-results [role=option]').first().waitFor({timeout:15000});result.dependencies.addressSuggestions=true;}catch{result.dependencies.addressSuggestions=false;result.failures.push('address_provider');}
  try {await page.waitForFunction(()=>typeof window.turnstile?.render==='function' && (document.querySelector('.cf-turnstile iframe') || document.querySelector('[name="cf-turnstile-response"]')),{},{timeout:15000});result.dependencies.challengeInitialized=true;}
  catch {result.dependencies.challengeInitialized=false;}
  if(result.dependencies.challengeScript!==200 || !result.dependencies.challengeInitialized || (await page.locator('#security-status').textContent()).includes('unavailable'))result.failures.push('challenge_provider');
  if(result.dependencies.analyticsScript!==200)result.failures.push('analytics_script');
  // Bot filtering is transport reachability only; a separate human/provider receipt is required.
  if(!['recorded-token','bot-filtered'].includes(result.analyticsReceipt))result.failures.push('analytics_endpoint');
  result.analyticsState=await page.evaluate(()=>window.siteAnalyticsStatus || 'legacy-uninstrumented');
  result.overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  if(result.overflow)result.failures.push('mobile_overflow');
  await page.locator('#quote-form').evaluate(form=>form.reset());
  await page.screenshot({path:'tmp/playwright/browser-health-mobile.png',fullPage:true});
  await page.goto(base+'/terms/',{waitUntil:'networkidle',timeout:30000});
  const health=await context.request.get(base+'/api/health?ready=1&monitor=1');result.readiness=health.status();
  if(health.status()!==200)result.failures.push('readiness');
  if(result.leadPosts)result.failures.push('unexpected_lead_post');
  await context.close();
}catch{
  result.failures.push('probe_execution');
}finally{
  try{await browser?.close();}catch{result.failures.push('browser_disconnect');}
  try{await server?.close();record.retention='closed/reaped';record.closedAt=new Date().toISOString();}catch{record.retention='cleanup_failed';result.failures.push('browser_cleanup');}
  writeFileSync('tmp/playwright/browser-health-process.json',JSON.stringify(record,null,2));
  writeFileSync('tmp/playwright/browser-health.json',JSON.stringify(result,null,2)+'\n');
}
// launchd runs a finite daily probe. A separate hosted deadline warns if the Mac/job stops.
// Only fixed public health categories leave the machine; the capability stays private.
if(process.env.GILLETTE_BROWSER_HEARTBEAT_FILE) {
  const file=process.env.GILLETTE_BROWSER_HEARTBEAT_FILE;
  try {
    if(statSync(file).mode & 0o077)throw Error('Heartbeat file must be private');
    const url=readFileSync(file,'utf8').trim();
    if(!/^https:\/\/hc-ping\.com\/[0-9a-f-]{36}$/.test(url))throw Error('Unexpected heartbeat destination');
    const response=await fetch(url+(result.failures.length?'/fail':''),{method:'POST',body:result.failures.length?'browser dependency check failed':'browser dependency checks passed',signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw Error('Heartbeat not accepted');
    result.independentHeartbeat='accepted';
    writeFileSync(join(dirname(file),'browser-last-run.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
    if(!result.failures.length)writeFileSync(join(dirname(file),'browser-last-good.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  }catch{result.failures.push('independent_heartbeat');result.independentHeartbeat='failed; hosted deadline remains active';}
  writeFileSync('tmp/playwright/browser-health.json',JSON.stringify(result,null,2)+'\n');
}
console.log(JSON.stringify(result,null,2));
if(result.failures.length)process.exitCode=1;
