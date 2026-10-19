import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
export const pause=ms=>new Promise(r=>setTimeout(r,ms));
export function tunnelUrl(text){return text.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\b/)?.[0]||null;}
export function configuration(env){
 const account=env.CLOUDFLARE_ACCOUNT_ID,project=env.DV_PAGES_PROJECT||'digitvillage-play';
 if(!/^[a-f0-9]{32}$/.test(account||'')||!env.CLOUDFLARE_API_TOKEN||!/^[a-z0-9][a-z0-9-]{0,57}[a-z0-9]$/.test(project))throw Error('Set the private Cloudflare account ID, API token and Pages project.');
 return {account,project,publicOrigin:`https://${project}.pages.dev`,token:env.CLOUDFLARE_API_TOKEN};
}
export async function healthy(url,expectedTunnel,fetcher=fetch){
 try{const r=await fetcher(url+'/healthz',{redirect:'error',signal:AbortSignal.timeout(12000),headers:{'Cache-Control':'no-cache'}});const j=await r.json();return r.ok&&j.ok===true&&j.app==='digital-village'&&(!expectedTunnel||r.headers.get('X-Digital-Village-Tunnel')===expectedTunnel);}catch{return false;}
}
export function deploymentFiles(template,origin,project){
 if(tunnelUrl(origin)!==origin||new URL(origin).origin!==origin)throw Error('Invalid tunnel origin.');
 // Pin the deployed worker to this verified origin. A stale dashboard PI_ORIGIN
 // must not override it. No credential or local configuration is uploaded.
 const worker=template.replace('env.PI_ORIGIN||DEFAULT_PI_ORIGIN',JSON.stringify(origin)).replace("responseHeaders.set('Cache-Control','private, no-store');",`responseHeaders.set('X-Digital-Village-Tunnel',${JSON.stringify(origin)});\n   responseHeaders.set('Cache-Control','private, no-store');`);
 if(worker===template||!worker.includes('X-Digital-Village-Tunnel'))throw Error('Unrecognised gateway template.');
 return {worker,config:JSON.stringify({name:project,pages_build_output_dir:'./public',compatibility_date:'2025-10-01'})};
}
export async function reserveDeployment(file,now=Date.now()){
 let state={day:'',count:0};try{state=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('Cannot read publication budget; refusing to publish.');}
 const day=new Date(now).toISOString().slice(0,10);if(state.day!==day)state={day,count:0};
 if(!Number.isInteger(state.count)||state.count<0||state.count>=10)return false;
 state.count++;await writeFile(file+'.tmp',JSON.stringify(state),{mode:0o600});await rename(file+'.tmp',file);return true;
}
export async function publish(origin,cfg,{stateDir=resolve(here,'state'),fetcher=fetch,run=runWrangler,sleep=pause}={}){
 if(!await healthy(origin,null,fetcher))throw Error('Tunnel is not serving Digital Village; publication skipped.');
 if(await healthy(cfg.publicOrigin,origin,fetcher))return true;
 await mkdir(stateDir,{recursive:true,mode:0o700});
 if(!await reserveDeployment(resolve(stateDir,'budget.json')))throw Error('Daily publication safety limit reached; retry tomorrow or inspect the tunnel.');
 const template=await readFile(resolve(here,'gateway.js'),'utf8');
 const files=deploymentFiles(template,origin,cfg.project),assets=resolve(stateDir,'public');await mkdir(assets,{recursive:true,mode:0o700});
 await writeFile(resolve(assets,'_worker.js'),files.worker);await writeFile(resolve(assets,'_routes.json'),JSON.stringify({version:1,include:['/*'],exclude:[]}));
 await writeFile(resolve(assets,'robots.txt'),'User-agent: *\nDisallow: /\n');
 await writeFile(resolve(stateDir,'wrangler.json'),files.config);
 await run(stateDir,cfg);
 for(let i=0;i<24;i++){if(await healthy(cfg.publicOrigin,origin,fetcher))return true;await sleep(5000);}
 throw Error('Published, but public verification is still pending.');
}
export function wranglerArgs(project){return [resolve(here,'node_modules/wrangler/bin/wrangler.js'),'pages','deploy','public','--project-name',project,'--branch','main','--commit-dirty=true'];}
export function publicationError(output,token){
 const safe=output.split(token||'\u0000').join('[REDACTED]').replace(/\x1b\[[0-9;]*m/g,'');
 const code=safe.match(/\[code:\s*(\d+)\]/i)?.[1];
 if(/authentication|invalid.*token|unauthorized|10000|9109/i.test(safe))return 'Cloudflare authentication failed. Check the private token and Pages Edit permission.';
 if(/config.*not support|not support.*config|custom paths/i.test(safe))return 'Publisher configuration was rejected. Update the domain controller.';
 if(/esbuild|workerd|install script|platform package/i.test(safe))return 'Publisher dependencies are incomplete. Check the isolated Wrangler installation.';
 return `Cloudflare publication failed${code?' (API code '+code+')':''}. Credentials and provider output are not logged.`;
}
export function runWrangler(cwd,cfg){
 return new Promise((ok,no)=>{
  // Pages discovers wrangler.json in cwd; --config is explicitly rejected.
  const child=spawn(process.execPath,wranglerArgs(cfg.project),{cwd,stdio:['ignore','pipe','pipe'],env:{...process.env,CLOUDFLARE_ACCOUNT_ID:cfg.account,CLOUDFLARE_API_TOKEN:cfg.token,WRANGLER_SEND_METRICS:'false',CI:'true'}});
  let output='';const capture=x=>{output=(output+x.toString()).slice(-32768);};child.stdout.on('data',capture);child.stderr.on('data',capture);
  const timer=setTimeout(()=>{child.kill('SIGTERM');no(Error('Cloudflare publication timed out.'));},180000);
  child.once('error',()=>{clearTimeout(timer);no(Error('Cannot start the installed Cloudflare publisher.'));});
  child.once('exit',code=>{clearTimeout(timer);code===0?ok():no(Error(publicationError(output,cfg.token)));});
 });
}
export async function supervise(cfg){
 let stopping=false,current=null;const stop=()=>{stopping=true;current?.kill('SIGTERM');};process.once('SIGTERM',stop);process.once('SIGINT',stop);
 while(!stopping){
  if(!await healthy('http://127.0.0.1:3000')){console.log('Waiting for the local game.');await pause(10000);continue;}
  const tunnelEnv={...process.env};delete tunnelEnv.CLOUDFLARE_API_TOKEN;
  const child=spawn('/usr/local/bin/cloudflared',['tunnel','--url','http://127.0.0.1:3000','--protocol','http2','--no-autoupdate'],{stdio:['ignore','pipe','pipe'],env:tunnelEnv});current=child;
  let ended=false,origin=null,tail='',resolveExit;const exited=new Promise(r=>{resolveExit=r;});
  const finish=()=>{ended=true;resolveExit();};child.once('exit',finish);child.once('error',finish);
  const capture=data=>{tail=(tail+data.toString()).slice(-8192);origin ||= tunnelUrl(tail);};child.stdout.on('data',capture);child.stderr.on('data',capture);
  const deadline=Date.now()+120000;
  while(!origin&&!ended&&!stopping&&Date.now()<deadline)await Promise.race([pause(1000),exited]);
  if(!origin||ended||stopping){child.kill('SIGTERM');if(!stopping)await pause(15000);continue;}
  console.log('Tunnel created; verifying the game before updating the fixed address.');
  let online=false,lastPublish=0,failedChecks=0;
  while(!ended&&!stopping){
   const tunnelReady=await healthy(origin);
   if(tunnelReady){failedChecks=0;if(Date.now()-lastPublish>=300000){lastPublish=Date.now();try{const wasOnline=online;online=await publish(origin,cfg);if(online&&!wasOnline)console.log(`Ready: ${cfg.publicOrigin} — the existing QR is unchanged.`);}catch(e){online=false;console.log(e.message);}}}
   else failedChecks++;
   // cloudflared reconnects itself for ordinary network interruptions. Only
   // recycle a stuck tunnel after ten minutes with the local game still healthy.
   if(failedChecks>=20&&await healthy('http://127.0.0.1:3000')){console.log('Tunnel unhealthy for ten minutes; recreating it.');child.kill('SIGTERM');break;}
   await Promise.race([pause(30000),exited]);
  }
  child.kill('SIGTERM');current=null;if(!stopping)await pause(15000);
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{await supervise(configuration(process.env));}catch{console.error('Domain automation cannot start. Check the private Cloudflare configuration.');process.exitCode=1;}
}
