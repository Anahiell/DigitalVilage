import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomInt} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function rehearsal(t){
 const directory=await mkdtemp(join(tmpdir(),'dv-reliability-'));
 const port=randomInt(32000,55000),base=`http://127.0.0.1:${port}`;
 const password='reliability-host-password-0123456789',dbPath=join(directory,'world.db');
 // Test-only SMTP failure, intercepted before Nodemailer can contact any provider.
 await writeFile(join(directory,'smtp-register.mjs'),`import {register} from 'node:module';register(new URL('./smtp-hook.mjs',import.meta.url));`);
 await writeFile(join(directory,'smtp-hook.mjs'),`export async function resolve(name,context,next){if(name==='nodemailer')return {url:'test:smtp-failure',shortCircuit:true};return next(name,context);}
export async function load(url,context,next){if(url==='test:smtp-failure')return {format:'module',shortCircuit:true,source:"export default {createTransport(){return {async sendMail(){await new Promise(r=>setTimeout(r,200));throw Error('Synthetic SMTP rejection')}}}}"};return next(url,context);}`);
 let child,stderr='';
 const env={...process.env,HOST:'127.0.0.1',PORT:String(port),DB_PATH:dbPath,ADMIN_PASSWORD:password,PIN_PEPPER:'reliability-pepper-01234567890123456789',DEV_EMAIL_OUTBOX:'1',SMTP_EMAIL:'',SMTP_APP_PASSWORD:'',PUBLIC_BASE_URL:base,NODE_ENV:'development'};
 async function stop(){if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}}
 async function start(overrides={},failMail=false){
  stderr='';child=spawn(process.execPath,[...(failMail?['--import',join(directory,'smtp-register.mjs')]:[]),'server.js'],{cwd:process.cwd(),env:{...env,...overrides},stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',chunk=>stderr+=chunk);
  for(let i=0;i<100;i++){
   if(child.exitCode!==null)throw Error(stderr);
   try{if((await fetch(base+'/healthz')).ok)return;}catch{}
   await sleep(40);
  }
  throw Error('Server did not start: '+stderr);
 }
 async function request(path,body,cookie){
  const res=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=res.headers.get('content-type')?.includes('application/json')?await res.json():await res.text();
  return {status:res.status,data,headers:res.headers,cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 t.after(async()=>{await stop();await rm(directory,{recursive:true,force:true});});
 await start();
 return {request,stop,start,dbPath,password,base};
}
const pinFrom=message=>message.body.match(/PIN is: (\d{6})/)[1];

test('PIN resend reports cooldown, replaces exactly once and preserves a working code when mail is unavailable',async t=>{
 const {request,stop,start,dbPath,password}=await rehearsal(t);
 const registered=await request('/api/register',{name:'PIN Participant',email:'Pin@test.example',village:'green-valley',role:'mayor'});
 assert.equal(registered.status,200);assert.equal(registered.data.email,'pin@test.example');assert.equal(registered.data.retryAfter,90);
 assert.match(registered.data.message,/Rehearsal mode/);
 const admin=(await request('/api/admin/login',{password})).cookie;
 let state=(await request('/api/state',undefined,admin)).data;
 const initialPin=pinFrom(state.outbox[0]);
 const cooldown=await request('/api/resend',{email:'pin@test.example'});
 assert.equal(cooldown.status,429);assert.ok(cooldown.data.retryAfter>0&&cooldown.data.retryAfter<=90);
 assert.equal(cooldown.headers.get('retry-after'),String(cooldown.data.retryAfter));
 assert.match(cooldown.data.error,/wait/i);
 assert.equal((await request('/api/state',undefined,admin)).data.outbox.length,1);
 assert.equal((await request('/api/login',{email:'pin@test.example',pin:initialPin})).status,200);
 assert.equal((await request('/api/resend',{email:'invalid'})).status,400);
 assert.equal((await request('/api/resend',{email:'pin@test.example,other@test.example'})).status,400);
 const db=new DatabaseSync(dbPath);t.after(()=>db.close());
 db.exec('UPDATE players SET pin_sent_at=pin_sent_at-91000');
 const concurrent=await Promise.all([request('/api/resend',{email:'pin@test.example'}),request('/api/resend',{email:'pin@test.example'})]);
 assert.deepEqual(concurrent.map(result=>result.status).sort(),[200,429]);
 state=(await request('/api/state',undefined,admin)).data;
 assert.equal(state.outbox.length,2);
 const replacement=pinFrom(state.outbox[0]);assert.notEqual(replacement,initialPin);
 assert.equal((await request('/api/login',{email:'pin@test.example',pin:initialPin})).status,401);
 assert.equal((await request('/api/login',{email:'pin@test.example',pin:replacement})).status,200);
 db.exec('UPDATE players SET pin_sent_at=pin_sent_at-91000');
 const before=db.prepare('SELECT pin_hash,pin_lookup,pin_sent_at,attempts,locked_until FROM players').get();
 await stop();await start({DEV_EMAIL_OUTBOX:'0'});
 const unavailable=await request('/api/resend',{email:'pin@test.example'});
 assert.equal(unavailable.status,503);assert.match(unavailable.data.error,/recovery PIN/);
 assert.deepEqual(db.prepare('SELECT pin_hash,pin_lookup,pin_sent_at,attempts,locked_until FROM players').get(),before);
 assert.equal((await request('/api/login',{email:'pin@test.example',pin:replacement})).status,200);
 assert.equal((await request('/api/register',{name:'Unsent Participant',email:'unsent@test.example',village:'riverstone',role:'mayor'})).status,503);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM players').get().n,1);
 assert.equal((await request('/api/state')).data.emailConfigured,false);
 await stop();await start({DEV_EMAIL_OUTBOX:'0',SMTP_EMAIL:'synthetic@example.invalid',SMTP_APP_PASSWORD:'synthetic-test-value'},true);
 const inFlight=request('/api/resend',{email:'pin@test.example'});
 await sleep(40);
 assert.equal((await request('/api/admin/issue-pin',{playerId:db.prepare('SELECT id FROM players').get().id},admin)).status,429);
 assert.equal((await request('/api/login',{email:'pin@test.example',pin:replacement})).status,200);
 assert.equal((await request('/api/resend',{email:'pin@test.example'})).status,429);
 const rejected=await inFlight;assert.equal(rejected.status,503);assert.match(rejected.data.error,/previous PIN still works/);
 assert.deepEqual(db.prepare('SELECT pin_hash,pin_lookup,pin_sent_at,attempts,locked_until FROM players').get(),before);
 assert.equal((await request('/api/register',{name:'Rejected Participant',email:'rejected@test.example',village:'riverstone',role:'mayor'})).status,503);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM players').get().n,1);
});

test('host invitations, role permissions, pause/restart recovery and frozen final results',async t=>{
 const {request,stop,start,dbPath,password,base}=await rehearsal(t);
 assert.equal((await request('/api/invite.svg')).status,403);
 const admin=(await request('/api/admin/login',{password})).cookie;
 assert.equal((await request('/api/state',undefined,admin)).data.invitationUrl,base+'/');
 const qr=await request('/api/invite.svg',undefined,admin);
 assert.equal(qr.status,200);assert.match(qr.headers.get('content-type'),/image\/svg\+xml/);assert.match(qr.data,/<svg/);assert.match(qr.data,/<path/);
 assert.equal((await request('/api/action',{op:'end'},admin)).status,409);
 assert.equal((await request('/api/register',null)).status,400);
 assert.equal((await request('/api/register',[])).status,400);
 for(const path of ['/.env','/server.js','/storage/village.db'])assert.equal((await request(path)).status,404);
 for(const [name,role] of [['Culture Participant','advisor-3'],['Finance Participant','finance']]){
  assert.equal((await request('/api/register',{name,email:role+'@test.example',village:'green-valley',role})).status,200);
 }
 const state=(await request('/api/state',undefined,admin)).data;
 const culture=(await request('/api/login',{email:'advisor-3@test.example',pin:pinFrom(state.outbox.find(m=>m.email==='advisor-3@test.example'))})).cookie;
 const finance=(await request('/api/login',{email:'finance@test.example',pin:pinFrom(state.outbox.find(m=>m.email==='finance@test.example'))})).cookie;
 const db=new DatabaseSync(dbPath);t.after(()=>db.close());
 assert.equal((await request('/api/action',{op:'start'},admin)).status,200);
 db.exec('UPDATE game SET started_at=started_at-65000,last_sim_at=last_sim_at-60000,last_dynamic_event_at=last_dynamic_event_at-65000');
 assert.equal((await request('/api/action',{op:'pause'},admin)).status,200);
 const paused=(await request('/api/state',undefined,admin)).data;
 assert.ok(paused.game.elapsedMs>=65000);
 // Move the paused wall clock back ten minutes; no new incident should fire on resume.
 db.exec('UPDATE game SET started_at=started_at-600000,last_dynamic_event_at=last_dynamic_event_at-600000');
 assert.equal((await request('/api/action',{op:'resume'},admin)).status,200);
 assert.equal((await request('/api/state',undefined,admin)).data.events.some(e=>e.kind==='random'),false);
 assert.equal((await request('/api/action',{op:'next'},admin)).status,200);
 assert.equal((await request('/api/action',{op:'chooseNews',id:'riverstone-n1'},culture)).status,200);
 assert.equal((await request('/api/action',{op:'unchooseNews',id:'riverstone-n1'},finance)).status,403);
 assert.equal((await request('/api/state',undefined,culture)).data.choices.length,1);
 assert.equal((await request('/api/action',{op:'next'},admin)).status,200);
 assert.equal((await request('/api/action',{op:'publish',title:'A culture weekend',body:'Join our village for a weekend of art, nature and community.',assets:['festival']},culture)).status,200);
 assert.equal((await request('/api/action',{op:'next'},admin)).status,200);
 const playing=(await request('/api/state',undefined,admin)).data;
 const saved=db.prepare('SELECT started_at,last_sim_at FROM game').get();
 await stop();await start();
 const recovered=(await request('/api/state',undefined,admin)).data;
 assert.equal(recovered.admin,true);assert.equal(recovered.game.phase,'paused');assert.equal(recovered.game.round,4);
 assert.equal(recovered.game.elapsedMs,Math.max(0,saved.last_sim_at-saved.started_at));
 assert.deepEqual(recovered.villages,playing.villages);assert.ok(recovered.events.some(e=>e.kind==='recovery'));
 assert.equal((await request('/api/state',undefined,culture)).data.me.role,'advisor-3');
 assert.equal((await request('/api/action',{op:'resume'},admin)).status,200);
 assert.equal((await request('/api/action',{op:'end'},admin)).status,200);
 const final=(await request('/api/state',undefined,admin)).data;
 assert.equal(final.game.phase,'ended');assert.equal(db.prepare('SELECT festival_resolved FROM game').get().festival_resolved,1);
 assert.equal((await request('/api/action',{op:'next'},admin)).status,409);
 assert.equal((await request('/api/action',{op:'grant',village:'green-valley',amount:1000},admin)).status,409);
 assert.equal((await request('/api/action',{op:'resume'},admin)).status,409);
 assert.equal((await request('/api/action',{op:'end'},admin)).status,200);
 assert.deepEqual((await request('/api/state',undefined,admin)).data.villages,final.villages);
 assert.equal((await request('/api/state',undefined,admin)).data.game.elapsedMs,final.game.elapsedMs);
});
