// The clock dispatches existing jobs; it never receives backup data or recovery keys.
const repository='trevor-commits/gillette-website-monitor';
const jobs={
  '11 */6 * * *':{workflow:'monitor.yml',title:'Website browser monitor',inputs:{runBrowser:true}},
  '40 */6 * * *':{workflow:'backup.yml',title:'Encrypted website backup',inputs:{}},
};

export async function dispatchScheduled(event,env,fetcher=fetch) {
  const job=jobs[event.cron];
  if(!job || !Number.isFinite(event.scheduledTime))throw Error('Unrecognized schedule');
  if(!env.GITHUB_ACTIONS_TOKEN)throw Error('Scoped Actions credential missing');
  const clockSlot=new Date(event.scheduledTime).toISOString();
  const headers={authorization:`Bearer ${env.GITHUB_ACTIONS_TOKEN}`,accept:'application/vnd.github+json','content-type':'application/json','user-agent':'gillette-workflow-clock','x-github-api-version':'2026-03-10'};
  const base=`https://api.github.com/repos/${repository}/actions/workflows/${job.workflow}`;
  // Avoid replaying an already-observed slot. Never retry an ambiguous dispatch.
  // ponytail: simultaneous duplicate cron deliveries can race; add durable claims if a duplicate slot is observed.
  const prior=await fetcher(base+'/runs?event=workflow_dispatch&branch=main&per_page=20',{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!prior.ok)throw Error(`Workflow inventory rejected: ${prior.status}`);
  const data=await prior.json();
  if(!Array.isArray(data.workflow_runs))throw Error('Invalid workflow inventory');
  const title=`${job.title} — clock ${clockSlot}`;
  if(data.workflow_runs.some(run=>run.display_title===title))return {workflow:job.workflow,clockSlot,state:'already-dispatched'};
  const response=await fetcher(base+'/dispatches',{method:'POST',headers,redirect:'error',body:JSON.stringify({ref:'main',inputs:{...job.inputs,clockSlot}}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(`Workflow dispatch rejected: ${response.status}`);
  return {workflow:job.workflow,clockSlot,state:'dispatched'};
}

export default {
  async scheduled(event,env) { console.log(JSON.stringify(await dispatchScheduled(event,env))); },
  fetch() { return new Response('Not found',{status:404}); },
};
