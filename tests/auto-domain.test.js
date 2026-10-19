import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configuration,tunnelUrl,healthy,deploymentFiles,reserveDeployment,publish,wranglerArgs,publicationError} from '../deploy/auto-domain/controller.mjs';

const origin='https://new-verified-tunnel.trycloudflare.com',cfg=configuration({CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'test-private-token'});
const template=await readFile(new URL('../deploy/auto-domain/gateway.js',import.meta.url),'utf8');
const good=(marker)=>new Response(JSON.stringify({ok:true,app:'digital-village'}),{headers:marker?{'X-Digital-Village-Tunnel':marker}:{}});
test('Pages publication uses cwd config discovery and safe failure categories',()=>{
 const args=wranglerArgs(cfg.project);assert.deepEqual(args.slice(1),['pages','deploy','public','--project-name',cfg.project,'--branch','main','--commit-dirty=true']);assert.ok(!args.includes('--config'));
 assert.match(publicationError('Pages does not support custom paths for the Wrangler configuration file',cfg.token),/configuration/);
 assert.match(publicationError('Authentication error [code: 10000]',cfg.token),/authentication/);
 assert.match(publicationError('esbuild missing platform package',cfg.token),/dependencies/);
 assert.ok(!publicationError('failed '+cfg.token,cfg.token).includes(cfg.token));
});
async function directory(t){const p=await mkdtemp(join(tmpdir(),'dv-auto-domain-'));t.after(()=>rm(p,{recursive:true,force:true}));return p;}

test('automatic domain accepts only a valid private account/project and extracts the new tunnel',()=>{
 assert.equal(cfg.publicOrigin,'https://digitvillage-play.pages.dev');assert.throws(()=>configuration({}),/private/);
 assert.throws(()=>configuration({...process.env,CLOUDFLARE_ACCOUNT_ID:'../oops',CLOUDFLARE_API_TOKEN:'secret'}));
 assert.equal(tunnelUrl(`INF | ${origin} |`),origin);assert.equal(tunnelUrl('https://evil.example'),null);
 for(const url of ['https://evil.example',origin+'/extra',origin+'?x=1',origin+'.evil.example'])assert.throws(()=>deploymentFiles(template,url,cfg.project));
});
test('health verification rejects redirects, wrong applications, stale gateway markers and failures',async()=>{
 assert.equal(await healthy(origin,null,async()=>good()),true);
 assert.equal(await healthy(cfg.publicOrigin,origin,async()=>good(origin)),true);
 assert.equal(await healthy(cfg.publicOrigin,origin,async()=>good('old')),false);
 assert.equal(await healthy(origin,null,async()=>new Response('{"ok":true,"app":"other"}')),false);
 assert.equal(await healthy(origin,null,async()=>new Response('bad',{status:503})),false);
 assert.equal(await healthy(origin,null,async()=>{throw Error('offline');}),false);
});
test('generated gateway pins the verified origin, preserves cookies and Origin, supports exercise links and rejects open proxy paths',async()=>{
 const files=deploymentFiles(template,origin,cfg.project);assert.equal(JSON.parse(files.config).name,cfg.project);
 const mod=await import('data:text/javascript;base64,'+Buffer.from(files.worker).toString('base64'));
 const forwarded=[];const gateway=mod.createGateway(async(url,opt)=>{forwarded.push({url,opt});return new Response('ok',{headers:{'Set-Cookie':'dv_session=private; Secure; HttpOnly'}});});
 for(const path of ['/healthz','/phishing?token=opaque','/phishing.js','/api/state']){
  const r=await gateway.fetch(new Request(cfg.publicOrigin+path,{headers:{Origin:cfg.publicOrigin,Cookie:'dv_session=private'}}),{PI_ORIGIN:'https://old-dead.trycloudflare.com'});
  assert.equal(r.status,200);assert.equal(r.headers.get('X-Digital-Village-Tunnel'),origin);assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.match(r.headers.get('Set-Cookie'),/HttpOnly/);
  assert.equal(new URL(forwarded.at(-1).url).origin,origin);assert.equal(forwarded.at(-1).opt.headers.get('Origin'),cfg.publicOrigin);assert.equal(forwarded.at(-1).opt.headers.get('Cookie'),'dv_session=private');
 }
 assert.equal((await gateway.fetch(new Request(cfg.publicOrigin+'/external/https://evil.example'))).status,404);
 const broken=mod.createGateway(async()=>{throw Error('unavailable');});assert.equal((await broken.fetch(new Request(cfg.publicOrigin+'/healthz'))).status,503);
});
test('persistent publication budget caps attempts, survives process restart, resets next UTC day and fails closed on corruption',async t=>{
 const file=join(await directory(t),'budget.json'),now=Date.UTC(2026,9,19,12);
 for(let i=0;i<10;i++)assert.equal(await reserveDeployment(file,now),true);
 assert.equal(await reserveDeployment(file,now),false);assert.equal(await reserveDeployment(file,now+86400000),true);
 await writeFile(file,'broken');await assert.rejects(reserveDeployment(file),/refusing/);
});
test('no deployment occurs for a dead tunnel or when the same public route is already healthy',async t=>{
 const stateDir=await directory(t);let runs=0;const run=async()=>runs++;
 await assert.rejects(publish(origin,cfg,{stateDir,run,fetcher:async()=>new Response('offline',{status:503})}),/skipped/);
 assert.equal(await publish(origin,cfg,{stateDir,run,fetcher:async()=>good(origin)}),true);assert.equal(runs,0);
});
test('publisher stages only the gateway and routes and waits for the exact new public destination',async t=>{
 const stateDir=await directory(t);let deployed=false,checks=0,runs=0;
 const fetcher=async url=>{if(url.startsWith(origin))return good();checks++;return good(deployed?origin:'old');};
 const run=async cwd=>{runs++;assert.equal(cwd,stateDir);const worker=await readFile(join(cwd,'public/_worker.js'),'utf8');assert.ok(worker.includes(JSON.stringify(origin)));assert.ok(!worker.includes(cfg.token));assert.equal(JSON.parse(await readFile(join(cwd,'public/_routes.json'))).include[0],'/*');deployed=true;};
 assert.equal(await publish(origin,cfg,{stateDir,run,fetcher,sleep:async()=>{}}),true);assert.equal(runs,1);assert.ok(checks>=2);
 assert.equal(JSON.parse(await readFile(join(stateDir,'budget.json'))).count,1);
});
test('publication failures and delayed edge propagation remain failures, with bounded checks',async t=>{
 const stateDir=await directory(t);let checks=0;
 const fetcher=async url=>url.startsWith(origin)?good():(checks++,good('old'));
 await assert.rejects(publish(origin,cfg,{stateDir,fetcher,run:async()=>{throw Error('denied');}}),/denied/);
 await assert.rejects(publish(origin,cfg,{stateDir,fetcher,run:async()=>{},sleep:async()=>{}}),/pending/);
 assert.equal(checks,26);assert.equal(JSON.parse(await readFile(join(stateDir,'budget.json'))).count,2);
});
