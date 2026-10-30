// Private, finite D1 -> authenticated encryption -> approved Drive folder backup.
import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,renameSync,statSync,realpathSync} from 'node:fs';
import {join,resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile,execFileSync} from 'node:child_process';

const magic=Buffer.from('GWSCB1');
export function seal(sql,key){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(magic);
  const bytes=Buffer.concat([cipher.update(gzipSync(sql)),cipher.final()]);
  return Buffer.concat([magic,iv,cipher.getAuthTag(),bytes]);
}
export function unseal(bytes,key){
  if(bytes.length<35||!bytes.subarray(0,6).equals(magic))throw Error('Invalid backup format');
  const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(6,18));
  cipher.setAAD(magic);cipher.setAuthTag(bytes.subarray(18,34));
  return gunzipSync(Buffer.concat([cipher.update(bytes.subarray(34)),cipher.final()]));
}
export function expiredSnapshots(files,now=Date.now()){
  // Only this task's exact timestamped backup names; never generic remote deletion.
  return files.filter(f=>/^leads-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.gwsc$/.test(f.Name)
    && Date.parse(f.Name.slice(6,-5).replace(/T(\d{2})-(\d{2})-(\d{2})Z$/,'T$1:$2:$3Z'))<now-30*86400000);
}
export const d1SchemaSql="SELECT m.name,m.type,m.sql,(SELECT json_group_array(name) FROM pragma_table_info(m.name)) AS columns FROM sqlite_schema m WHERE (m.name NOT GLOB 'sqlite_*' OR m.name='sqlite_sequence') AND m.name NOT GLOB '_cf_*' AND m.sql IS NOT NULL ORDER BY m.type,m.name";
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const identifier=value=>'"'+value.replaceAll('"','""')+'"';
export function d1SnapshotSql(schema){
  // The discovery read only builds identifiers. Schema, counts and all data below
  // are fetched in ONE SELECT, so concurrent writes cannot mix table snapshots.
  const tables=[];
  for(const table of schema.filter(x=>x.type==='table')){
    const columns=JSON.parse(table.columns);if(!columns.length||columns.some(x=>typeof x!=='string'))throw Error('Invalid D1 schema');
    const target=identifier(table.name),name=literal(table.name);
    // Hex text preserves embedded NULs and Unicode; SQLite quote preserves
    // integer precision, NULL, real and blob literals without a JS conversion.
    const cells=columns.map(column=>{
      // Redact in D1, before any row bytes reach a runner, local file or Drive.
      if(table.name==='leads' && ['submitter_ip','submitter_ip_expires_at'].includes(column)) return literal('NULL');
      const c=identifier(column);
      return `CASE typeof(${c}) WHEN 'text' THEN 'CAST(X'''||hex(${c})||''' AS TEXT)' ELSE quote(${c}) END`;
    });
    const row=literal(`INSERT INTO ${target} (${columns.map(identifier).join(',')}) VALUES (`)+"||"+cells.join("||','||")+"||');'";
    tables.push(name,`json_object('count',(SELECT CAST(count(*) AS TEXT) FROM ${target}),'rows',json((SELECT json_group_array(${row}) FROM ${target})))`);
  }
  const sql=`SELECT json_object('schema',json((SELECT json_group_array(json_object('name',m.name,'type',m.type,'sql',m.sql,'columns',m.columns)) FROM (${d1SchemaSql}) m)),'tables',json_object(${tables.join(',')})) AS snapshot`;
  // ponytail: one bounded read snapshot; upgrade when JSON approaches 1.5 MiB
  // or the query reaches 100 KB. Failure warns and retains the prior good copy.
  if(Buffer.byteLength(sql)>100000)throw Error('D1 snapshot query exceeds reviewed 100 KB limit');
  return sql;
}
export async function exportD1Sql(accountId,databaseId,token){
  if(!/^[a-f0-9]{32}$/.test(accountId)||!/^[-a-f0-9]{36}$/.test(databaseId)||!token.trim())throw Error('Invalid D1 export configuration');
  const query=async sql=>{
    let response;
    try{response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+token.trim(),'content-type':'application/json'},body:JSON.stringify({sql,params:[]}),signal:AbortSignal.timeout(30000)});}
    catch{throw Error('D1 read request failed');}
    if(!response.ok||!response.body)throw Error('D1 read rejected');
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>64*1024*1024)throw Error('D1 read exceeds reviewed 64 MiB limit');chunks.push(chunk);}
    let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{throw Error('Invalid D1 read response');}
    if(!body.success||body.result?.length!==1||!body.result[0].success||!Array.isArray(body.result[0].results))throw Error('D1 read rejected');
    return body.result[0].results;
  };
  const schema=await query(d1SchemaSql);if(!schema.some(x=>x.type==='table'))throw Error('D1 schema missing');
  const rows=await query(d1SnapshotSql(schema));
  if(rows.length!==1||typeof rows[0].snapshot!=='string'||Buffer.byteLength(rows[0].snapshot)>1.5*1024*1024)throw Error('D1 snapshot exceeds reviewed 1.5 MiB limit or is incomplete');
  const snapshot=JSON.parse(rows[0].snapshot);
  const canonical=items=>JSON.stringify(items.map(({name,type,sql,columns})=>({name,type,sql,columns})).sort((a,b)=>a.name.localeCompare(b.name)));
  if(canonical(snapshot.schema)!==canonical(schema))throw Error('D1 schema changed during backup');
  if(Object.keys(snapshot.tables).length!==schema.filter(x=>x.type==='table').length)throw Error('Incomplete D1 snapshot');
  const inserts=[];let sequences=[];
  for(const table of schema.filter(x=>x.type==='table')){
    const result=snapshot.tables[table.name],data=result?.rows;
    if(!Array.isArray(data)||data.some(x=>typeof x!=='string')||result.count!==String(data.length))throw Error('D1 snapshot row count mismatch');
    if(table.name==='sqlite_sequence')sequences=['DELETE FROM sqlite_sequence;',...data];else inserts.push(...data);
  }
  const tables=schema.filter(x=>x.type==='table'&&x.name!=='sqlite_sequence').map(x=>x.sql+';');
  const remaining=schema.filter(x=>x.type!=='table').map(x=>x.sql+';');
  return Buffer.from(['PRAGMA defer_foreign_keys=TRUE;',...tables,...inserts,...sequences,...remaining,''].join('\n'));
}
function privateRead(path){
  const s=statSync(path);if(!s.isFile()||(s.mode&0o077))throw Error('Private file permissions required');
  return readFileSync(path);
}
async function configuredSnapshot(config){
  if(!config.cloudflareTokenFile)throw Error('Privacy-filtered export requires the approved D1 Read credential');
  return exportD1Sql(config.cloudflareAccountId,config.cloudflareDatabaseId,privateRead(config.cloudflareTokenFile).toString());
}
function privateOutput(config,output){
  const root=realpathSync(config.privateDirectory),parent=realpathSync(dirname(resolve(output)));
  if((statSync(root).mode&0o077) || !(parent===root || parent.startsWith(root+sep)) || (statSync(parent).mode&0o077))throw Error('Output must remain inside the private backup directory');
  return resolve(output);
}
export async function snapshot(configPath,output){
  const config=JSON.parse(privateRead(configPath));
  const target=privateOutput(config,output);
  writeFileSync(target,await configuredSnapshot(config),{mode:0o600,flag:'wx'});
}
const hash=b=>createHash('sha256').update(b).digest('hex');
const restorePython=`import sqlite3,sys,json
db=sqlite3.connect(':memory:')
db.executescript(open(sys.argv[1]).read())
assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
assert db.execute('PRAGMA foreign_key_check').fetchone() is None
for t in ['leads','monitor_alerts']: db.execute('SELECT count(*) FROM '+t).fetchone()
assert {'client_uuid','tracking_id','payload'}.issubset({r[1] for r in db.execute('PRAGMA table_info(leads)')})
print(json.dumps({'integrity':'ok','leadRows':db.execute('SELECT count(*) FROM leads').fetchone()[0],'schemaCompatible':True}))`;

export async function backup(configPath){
  process.umask(0o077);
  const config=JSON.parse(privateRead(configPath)),root=config.privateDirectory;
  if(!root||!config.driveFolderId||config.expectedEmail!=='trevor@gillettewsc.com'||!config.cloudflareTokenFile)throw Error('Reviewed privacy-filtered backup configuration required');
  mkdirSync(root,{recursive:true,mode:0o700});
  const key=privateRead(config.keyFile);if(key.length!==32)throw Error('Invalid recovery key');
  const ping=privateRead(config.heartbeatFile).toString().trim();
  if(!/^https:\/\/hc-ping\.com\/[0-9a-f-]{36}$/.test(ping))throw Error('Invalid heartbeat destination');
  const lock=join(root,'running');mkdirSync(lock,{mode:0o700});
  const owner={pid:process.pid,start:execFileSync('/bin/ps',['-p',String(process.pid),'-o','lstart=']).toString().trim(),owner:config.owner||'Gillette website backup',purpose:'approved encrypted lead backup',port:null,stop:'finite process exits; only its exact child handle is timed out',retention:'finite scheduled run; child processes reaped',children:[]};
  const saveOwner=()=>writeFileSync(join(root,'process.json'),JSON.stringify(owner,null,2),{mode:0o600});saveOwner();
  const run=(name,exe,args,extraEnv={})=>new Promise((resolve,reject)=>{
    if(exe===config.rclone)args=['--config',config.rcloneConfig,...args];
    const child=execFile(exe,args,{cwd:config.repository,timeout:180000,maxBuffer:8*1024*1024,env:{...process.env,WRANGLER_SEND_METRICS:'false',...extraEnv}},(error,stdout,stderr)=>{
      const row=owner.children.find(x=>x.pid===child.pid);if(row)row.state='closed/reaped';saveOwner();
      if(error){writeFileSync(join(root,'last-command-error.log'),stdout+'\n'+stderr,{mode:0o600});reject(Error(name+' failed'));}else resolve(stdout);
    });
    if(child.pid){let start='exited before identity read';try{start=execFileSync('/bin/ps',['-p',String(child.pid),'-o','lstart=']).toString().trim();}catch{}owner.children.push({pid:child.pid,start,purpose:name,state:'running',stop:'execFile timeout on owned child handle'});saveOwner();}
  });
  const work=mkdtempSync(join(root,'work-'));
  const signal=async failed=>{const r=await fetch(ping+(failed?'/fail':''),{method:'POST',body:failed?'encrypted website backup failed':'encrypted website backup verified',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Independent backup heartbeat failed');};
  const receipt={checkedAt:new Date().toISOString(),ok:false,notifications:0,liveDatabaseModified:false};
  try{
    // Refresh only existing Drive authorization, then verify account and private destination.
    await run('Drive credential refresh',config.rclone,['about',config.driveRemote+':','--json']);
    const conf=privateRead(config.rcloneConfig).toString();
    const section=conf.split(new RegExp('^\\['+config.driveRemote+'\\]\\s*$','m'))[1]?.split(/^\[/m)[0];
    const token=JSON.parse(/^\s*token\s*=\s*(.+)$/m.exec(section||'')?.[1]||'{}').access_token;
    if(!token)throw Error('Existing Drive credential unavailable');
    const driveRead=async path=>{const r=await fetch('https://www.googleapis.com/drive/v3/'+path,{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Drive authorization read failed');return r.json();};
    const about=await driveRead('about?fields=user(emailAddress)');
    if(about.user?.emailAddress!==config.expectedEmail)throw Error('Drive account mismatch');
    const folder=await driveRead('files/'+encodeURIComponent(config.driveFolderId)+'?fields=id,mimeType,permissions(type,role,emailAddress)');
    if(folder.mimeType!=='application/vnd.google-apps.folder'||folder.permissions?.length!==1||folder.permissions[0].role!=='owner'||folder.permissions[0].emailAddress!==config.expectedEmail)throw Error('Backup destination must remain private to business owner');
    const sqlPath=join(work,'leads.sql');
    writeFileSync(sqlPath,await configuredSnapshot(config),{mode:0o600});
    const restored=JSON.parse(await run('isolated SQLite restore','/usr/bin/python3',['-c',restorePython,sqlPath]));
    const sql=readFileSync(sqlPath),bytes=seal(sql,key);
    const name='leads-'+new Date().toISOString().slice(0,19).replaceAll(':','-')+'Z.gwsc';
    // Retain the validated encrypted candidate even if independent upload fails.
    const encrypted=join(root,name),downloaded=join(work,'download.gwsc');writeFileSync(encrypted,bytes,{mode:0o600});
    receipt.name=name;
    const remote=config.driveRemote+':'+name,scope=['--drive-root-folder-id',config.driveFolderId,'--retries','1','--low-level-retries','2'];
    await run('encrypted Drive upload',config.rclone,['copyto',encrypted,remote,...scope]);
    await run('independent Drive download',config.rclone,['copyto',remote,downloaded,...scope]);
    const returned=readFileSync(downloaded);if(hash(returned)!==hash(bytes)||!unseal(returned,key).equals(sql))throw Error('Downloaded backup failed verification');
    await signal(false);
    Object.assign(receipt,{ok:true,name,sha256:hash(bytes),bytes:bytes.length,...restored,independentHeartbeat:'accepted'});
    writeFileSync(join(root,'last-good.json.next'),JSON.stringify(receipt,null,2),{mode:0o600});renameSync(join(root,'last-good.json.next'),join(root,'last-good.json'));
    // Trash only old task snapshots after a verified replacement. Drive trash stays recoverable.
    const files=JSON.parse(await run('backup retention inventory',config.rclone,['lsjson',config.driveRemote+':',...scope]));
    for(const file of expiredSnapshots(files)){
      await run('recoverable backup retention',config.rclone,['deletefile',config.driveRemote+':'+file.Name,'--drive-use-trash=true',...scope]);
      rmSync(join(root,file.Name),{force:true});
    }
    writeFileSync(join(root,'last-run.json'),JSON.stringify(receipt,null,2),{mode:0o600});return receipt;
  }catch(error){
    receipt.ok=false;
    receipt.error=error.message;try{await signal(true);receipt.independentHeartbeat='failure accepted';}catch{receipt.independentHeartbeat='failed; missing-output deadline remains active';}
    writeFileSync(join(root,'last-run.json'),JSON.stringify(receipt,null,2),{mode:0o600});throw Error(receipt.error);
  }finally{rmSync(work,{recursive:true,force:true});rmSync(lock,{recursive:true,force:true});owner.retention='closed/reaped';saveOwner();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv[2]==='--restore'){
      const config=JSON.parse(privateRead(process.argv[3])),output=privateOutput(config,process.argv[5]);
      writeFileSync(output,unseal(privateRead(process.argv[4]),privateRead(config.keyFile)),{mode:0o600,flag:'wx'});
      console.log('Decrypted into private isolated restore file; production unchanged.');
    }else if(process.argv[2]==='--snapshot'){
      await snapshot(process.argv[3],process.argv[4]);
      console.log('Privacy-filtered snapshot saved privately; production unchanged.');
    }else console.log(JSON.stringify(await backup(process.argv[2])));
  }catch{console.error('Website backup failed; inspect private last-run.json and independent warning.');process.exitCode=1;}
}
