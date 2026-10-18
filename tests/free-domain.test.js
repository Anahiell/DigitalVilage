import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createGateway} from '../deploy/free-domain/public/_worker.js';
import {rehearsal} from './helpers.mjs';
const origin='https://ruralem-play.pages.dev';
const piOrigin='https://robobrain.taild17717.ts.net:8443';

test('free HTTPS gateway forwards the real app flow, preserves Origin/cookies and generates the canonical QR',async t=>{
 const app=await rehearsal(t);await app.stop();await app.start({PUBLIC_BASE_URL:origin});const forwarded=[];
 const gateway=createGateway(async(target,options)=>{
  forwarded.push({url:new URL(target),origin:options.headers.get('origin')});
  const local=new URL(app.base);local.pathname=new URL(target).pathname;local.search=new URL(target).search;
  return fetch(local,options);
 });
 const call=async(path,body,cookie,requestOrigin=origin)=>gateway.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:requestOrigin}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)}));
 assert.match(await (await call('/')).text(),/Digital Village/);
 assert.equal((await (await call('/healthz')).json()).app,'digital-village');
 const host=await call('/api/admin/login',{password:app.password});assert.equal(host.status,200);assert.match(host.headers.get('set-cookie'),/; Secure/);
 const admin=host.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('/api/register',{name:'Gateway Participant',email:'proxy@test.example',village:'green-valley',role:'mayor'})).status,200);
 const state=await (await call('/api/state?history=1',undefined,admin)).json();assert.equal(state.admin,true);assert.equal(state.invitationUrl,origin+'/');
 const pin=state.outbox[0].body.match(/PIN is: (\d{6})/)[1];
 const login=await call('/api/login',{email:'proxy@test.example',pin});assert.equal(login.status,200);
 const player=login.headers.get('set-cookie').split(';')[0];
 const playerState=await call('/api/state',undefined,player);assert.equal((await playerState.json()).me.name,'Gateway Participant');assert.equal(playerState.headers.get('cache-control'),'private, no-store');
 assert.equal((await call('/api/action',{op:'start'},admin,'https://unrelated.example')).status,403,'The proxy must preserve the browser Origin so the app rejects a foreign request.');
 assert.equal((await call('/api/action',{op:'start'},admin)).status,200);
 assert.equal((await call('/api/action',{op:'closeRound'},admin)).status,200);
 const report=await call('/api/reports?round=1',undefined,player);assert.equal(report.status,200);assert.match(JSON.stringify(await report.json()),/Gateway Participant/);
 const qr=await call('/api/invite.svg',undefined,admin);assert.equal(qr.status,200);assert.match(await qr.text(),/<svg/);assert.equal(qr.headers.get('cache-control'),'private, no-store');
 assert.ok(forwarded.every(r=>r.url.origin===piOrigin&&r.url.port==='8443'));
 assert.ok(forwarded.some(r=>r.url.search==='?history=1'));assert.equal(forwarded[2].origin,origin);
});

test('gateway fails honestly without replaying POSTs, preserves upstream errors and cannot become an open proxy',async()=>{
 let requests=0;
 const broken=createGateway(async()=>{requests++;throw Error('Synthetic Pi outage');});
 const failed=await broken.fetch(new Request(origin+'/api/register',{method:'POST',body:'{}'}));assert.equal(failed.status,503);assert.equal(requests,1);assert.equal(failed.headers.get('cache-control'),'private, no-store');
 assert.match((await failed.json()).error,/Raspberry Pi/);
 assert.equal((await broken.fetch(new Request(origin+'/api/state'),{PI_ORIGIN:'https://attacker.invalid'})).status,503);
 assert.equal((await broken.fetch(new Request(origin+'/api/state'),{PI_ORIGIN:'https://robot.ts.net:8080'})).status,503);
 assert.equal((await broken.fetch(new Request(origin+'//attacker.invalid/'))).status,404);assert.equal(requests,1);
 const limited=createGateway(async()=>new Response('{"retryAfter":90}',{status:429,headers:{'Retry-After':'90','Content-Type':'application/json'}}));
 const limit=await limited.fetch(new Request(origin+'/api/resend',{method:'POST',body:'{}'}));assert.equal(limit.status,429);assert.equal(limit.headers.get('retry-after'),'90');assert.equal((await limit.json()).retryAfter,90);
 const redirect=createGateway(async()=>new Response(null,{status:302,headers:{Location:'https://foreign.invalid'}}));
 assert.equal((await redirect.fetch(new Request(origin+'/'))).status,502);
 const head=createGateway(async()=>new Response('content',{headers:{'Content-Type':'text/html'}}));assert.equal(await (await head.fetch(new Request(origin+'/',{method:'HEAD'}))).text(),'');
});

test('Pages deployment explicitly enables the required custom port',async()=>{
 const config=JSON.parse(await readFile('deploy/free-domain/wrangler.jsonc','utf8'));
 assert.ok(config.compatibility_date>='2024-09-02');assert.ok(config.compatibility_flags.includes('allow_custom_ports'));
 assert.equal(config.pages_build_output_dir,'./public');
 assert.equal(config.vars.PI_ORIGIN,piOrigin);
});
