import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {createGateway} from '../deploy/free-domain/public/_worker.js';

test('friendly address forwards personal phishing pages, script and query without widening the route allowlist',async()=>{
 const paths=[];
 const gateway=createGateway(async url=>{paths.push(url);return new Response('forwarded');});
 for(const path of ['/phishing?t=opaque-token','/phishing.html','/phishing.js']){
  const response=await gateway.fetch(new Request('https://ruralem-play.pages.dev'+path));assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
 }
 assert.equal(new URL(paths[0]).search,'?t=opaque-token');assert.ok(paths.every(p=>new URL(p).port==='8443'));
 for(const path of ['/.env','/server.js','/storage/village.db'])assert.equal((await gateway.fetch(new Request('https://ruralem-play.pages.dev'+path))).status,404);
});

test('friendly address real-handler integration: PIN, secure cookie, exercise open, reports and canonical email links',async t=>{
 const origin='https://ruralem-play.pages.dev';
 Object.assign(process.env,{NODE_ENV:'test',DB_PATH:':memory:',ADMIN_PASSWORD:'gateway-admin-password-0123456789',PIN_PEPPER:'gateway-pepper-01234567890123456789',DEV_EMAIL_OUTBOX:'1',SMTP_EMAIL:'',SMTP_APP_PASSWORD:'',RESEND_API_KEY:'',EMAIL_FROM:'',EXERCISE_SMTP_EMAIL:'',EXERCISE_SMTP_APP_PASSWORD:'',PUBLIC_BASE_URL:origin});
 const {handler,server,db}=await import('../server.js');t.after(()=>{server.emit('close');db.close();});
 const gateway=createGateway(async(url,options)=>{
  const target=new URL(url);assert.equal(target.origin,'https://robobrain.taild17717.ts.net:8443');
  const body=options.body?await new Response(options.body).text():'';
  const req=Readable.from(body?[body]:[]);Object.assign(req,{url:target.pathname+target.search,method:options.method,headers:{host:target.host,...Object.fromEntries(options.headers)},socket:{remoteAddress:'127.0.0.1'}});
  let status=200,content='';const headers={};
  await handler(req,{setHeader:(k,v)=>{headers[k]=v;},writeHead:(s,h)=>{status=s;Object.assign(headers,h);},end:v=>{content=v||'';}});
  return new Response(options.method==='HEAD'?null:content,{status,headers});
 });
 const call=(path,body,cookie,requestOrigin=origin)=>gateway.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{Origin:requestOrigin,'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}));
 const login=await call('/api/admin/login',{password:process.env.ADMIN_PASSWORD});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/; Secure/);const admin=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('/api/register',{name:'Pages Player',email:'pages@test.example',village:'green-valley',role:'mayor'})).status,200);
 let state=await (await call('/api/state',undefined,admin)).json();assert.equal(state.invitationUrl,origin+'/');const pin=state.outbox[0].body.match(/PIN is: (\d{6})/)[1];
 const playerLogin=await call('/api/login',{email:'pages@test.example',pin});assert.equal(playerLogin.status,200);const player=playerLogin.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('/api/action',{op:'start'},admin,'https://wrong.example')).status,403);
 await call('/api/action',{op:'start'},admin);for(let n=0;n<4;n++)await call('/api/action',{op:'next'},admin);await new Promise(r=>setImmediate(r));
 const message=db.prepare("SELECT body FROM outbox WHERE subject LIKE 'Important:%'").get();assert.ok(message.body.includes(origin+'/phishing?t='));const token=message.body.match(/\?t=([a-f0-9]{64})/)[1];
 assert.match(await (await call('/phishing?t='+token)).text(),/Oops, hello!/);assert.match(await (await call('/phishing.js')).text(),/\/api\/exercise\/open/);
 assert.equal((await (await call('/api/exercise/open',{token,eventId:randomUUID()})).json()).tracked,true);
 state=await (await call('/api/state',undefined,admin)).json();assert.equal(state.participants[0].open_count,1);
 await call('/api/action',{op:'end'},admin);
 const report=await call('/api/final-report',undefined,player);assert.equal(report.status,200);assert.equal((await report.json()).player.name,'Pages Player');
 const job=db.prepare("SELECT COUNT(*) AS n FROM mail_jobs WHERE kind='report'").get();assert.equal(job.n,1);
});
