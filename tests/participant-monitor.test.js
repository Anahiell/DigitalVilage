import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createParticipantMonitor} from '../participant-monitor.js';
import {renderParticipants} from '../public/report-ui.js';
import {VILLAGES,ROLES} from '../data.js';

test('personal tracking tokens stay private, survive monitor restart, and event retries do not double count',()=>{
 const db=new DatabaseSync(':memory:');let clock=100000,session='one';
 db.exec('CREATE TABLE players(id TEXT PRIMARY KEY);CREATE TABLE mail_jobs(id TEXT);INSERT INTO players VALUES(\'a\'),(\'b\');');
 const config={db,secret:'test-monitor-secret-01234567890',sessionId:()=>session,now:()=>clock};
 let monitor=createParticipantMonitor(config);const a=monitor.linkToken('a'),b=monitor.linkToken('b');
 assert.notEqual(a,b);assert.equal(db.prepare('SELECT token_hash FROM exercise_tracking WHERE player_id=?').get('a').token_hash.includes(a),false);
 monitor.sent('a','job-a');assert.throws(()=>monitor.canResend('a'),e=>e.status===429);
 clock+=90001;monitor.canResend('a');db.exec("INSERT INTO mail_jobs VALUES('job-a')");assert.throws(()=>monitor.canResend('a'),e=>e.status===409);
 const event=randomUUID();assert.equal(monitor.opened(a,event),true);monitor.opened(a,event);
 assert.equal(db.prepare("SELECT open_count FROM exercise_tracking WHERE player_id='a'").get().open_count,1);
 assert.equal(monitor.opened('f'.repeat(64),randomUUID()),false);
 assert.equal(monitor.opened({},randomUUID()),false);assert.equal(monitor.opened(a,{}),false);
 monitor=createParticipantMonitor(config);assert.equal(monitor.linkToken('a'),a);monitor.opened(a,randomUUID());
 assert.equal(db.prepare("SELECT open_count FROM exercise_tracking WHERE player_id='a'").get().open_count,2);
 session='two';assert.notEqual(monitor.linkToken('b'),b);db.close();
});

test('participant table escapes names and separates readiness, online presence and provider acceptance',()=>{
 const html=renderParticipants({game:{round:5,phase:'playing'},villages:VILLAGES,roles:ROLES,participants:[{id:'id',name:'<script>bad</script>',email:'a@test.example',village_id:'green-valley',role:'mayor',ready:true,online:false,signedIn:true,verified:1,delivery_status:'accepted',send_count:1,open_count:0,canResend:true}]});
 assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.match(html,/Signed in · offline/);assert.match(html,/Ready/);assert.match(html,/does not prove inbox delivery/);
});

test('in-process HTTP integration: 30 players, readiness, private tracking, resend races, timeouts and reset',async t=>{
 Object.assign(process.env,{NODE_ENV:'test',DB_PATH:':memory:',ADMIN_PASSWORD:'monitor-admin-password-0123456789',PIN_PEPPER:'monitor-pepper-secret-0123456789',DEV_EMAIL_OUTBOX:'1',SMTP_EMAIL:'',SMTP_APP_PASSWORD:'',RESEND_API_KEY:'',EMAIL_FROM:'',EXERCISE_SMTP_EMAIL:'',EXERCISE_SMTP_APP_PASSWORD:'',PUBLIC_BASE_URL:'http://localhost'});
 const {handler,server,db,mailQueue}=await import('../server.js');t.after(()=>{server.emit('close');db.close();});
 async function request(url,body,cookie,origin){
  const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);Object.assign(req,{url,method:body===undefined?'GET':'POST',headers:{host:'localhost',...(cookie?{cookie}:{}),...(origin?{origin}:{})},socket:{remoteAddress:'127.0.0.1'}});
  const headers={};let status,data;
  const res={setHeader:(key,value)=>{headers[key.toLowerCase()]=value;},writeHead:(code,values)=>{status=code;for(const [k,v] of Object.entries(values||{}))headers[k.toLowerCase()]=v;},end:value=>{const raw=String(value||'');data=headers['content-type']?.includes('application/json')?JSON.parse(raw):raw;}};
  await handler(req,res);return {status,data,cookie:headers['set-cookie']?.split(';')[0]};
 }
 const admin=(await request('/api/admin/login',{password:process.env.ADMIN_PASSWORD})).cookie;
 const users=[];
 for(let n=0;n<30;n++){
  const email=`monitor${n}@test.example`,result=await request('/api/admin/enrol',{name:`Monitor Player ${n}`,email,village:VILLAGES[Math.floor(n/8)].id,role:ROLES[n%8].id,present:true},admin);assert.equal(result.status,200);
  users.push({email,pin:result.data.pin});
 }
 let host=(await request('/api/state',undefined,admin)).data;assert.equal(host.participants.length,30);assert.ok(host.participants.every(p=>!p.signedIn&&!p.ready));
 await Promise.all(users.slice(0,20).map(async u=>{u.cookie=(await request('/api/login',{email:u.email,pin:u.pin})).cookie;await request('/api/state',undefined,u.cookie);}));
 await Promise.all(users.slice(0,10).map(u=>request('/api/action',{op:'setReady',ready:true},u.cookie)));
 host=(await request('/api/state',undefined,admin)).data;assert.equal(host.participants.filter(p=>p.online).length,20);assert.equal(host.participants.filter(p=>p.ready).length,10);
 const player=(await request('/api/state',undefined,users[0].cookie)).data;assert.equal(player.participants,undefined);assert.equal(player.ready,true);
 assert.equal((await request('/api/action',{op:'setReady',ready:'yes'},users[0].cookie)).status,400);
 assert.equal((await request('/api/admin/resend-exercise',{},users[0].cookie)).status,403);
 assert.equal((await request('/api/admin/resend-exercise',{playerId:host.participants[0].id,sessionId:host.game.sessionId},admin)).status,409);
 await request('/api/logout',{},users[19].cookie);
 db.exec('UPDATE players SET last_seen=last_seen-40000');host=(await request('/api/state',undefined,admin)).data;assert.equal(host.participants.filter(p=>p.online).length,0);assert.equal(host.participants.filter(p=>p.signedIn).length,19);
 await request('/api/action',{op:'start'},admin);for(let n=0;n<4;n++)await request('/api/action',{op:'next'},admin);
 await new Promise(r=>setImmediate(r));
 const mails=db.prepare("SELECT email,body FROM outbox WHERE subject LIKE 'Important:%'").all();assert.equal(mails.length,30);
 const urls=mails.map(m=>new URL(m.body.match(/http:\/\/localhost\/phishing\?t=[a-f0-9]{64}/)[0]));assert.equal(new Set(urls.map(u=>u.searchParams.get('t'))).size,30);
 assert.ok(urls.every(u=>!u.href.includes('@')));
 const mail=mails.find(m=>m.email===users[0].email),token=mail.body.match(/\?t=([a-f0-9]{64})/)[1];
 assert.match((await request('/phishing?t='+token)).data,/phishing.js/);host=(await request('/api/state',undefined,admin)).data;const monitored=host.participants.find(p=>p.email===users[0].email);assert.equal(monitored.open_count,0);
 const event={token,eventId:randomUUID()};assert.equal((await request('/api/exercise/open',event,undefined,'https://wrong.example')).status,403);
 await request('/api/exercise/open',event);await request('/api/exercise/open',event);
 host=(await request('/api/state',undefined,admin)).data;assert.equal(host.participants.find(p=>p.id===monitored.id).open_count,1);
 assert.equal((await request('/api/exercise/open',{token:'bad',eventId:randomUUID()})).data.tracked,false);
 db.prepare('UPDATE exercise_tracking SET last_sent_at=last_sent_at-91000 WHERE player_id=?').run(monitored.id);
 const payload={playerId:monitored.id,sessionId:host.game.sessionId};
 const resends=await Promise.all([request('/api/admin/resend-exercise',payload,admin),request('/api/admin/resend-exercise',payload,admin)]);assert.deepEqual(resends.map(r=>r.status).sort(),[202,409]);
 await mailQueue.drain();assert.equal((await request('/api/admin/resend-exercise',payload,admin)).status,429);
 const latest=db.prepare("SELECT body FROM outbox WHERE email=? ORDER BY id DESC LIMIT 1").get(users[0].email);assert.match(latest.body,new RegExp(token));
 await request('/api/action',{op:'end'},admin);
 // Exercise dispatch has completed and only durable report jobs remain.
 await new Promise(r=>setImmediate(r));
 const reset=await request('/api/admin/reset-game',{sessionId:host.game.sessionId,confirm:'RESET FINISHED GAME',password:process.env.ADMIN_PASSWORD},admin);assert.equal(reset.status,200,JSON.stringify(reset.data));
 for(const table of ['exercise_tracking','exercise_open_events','participant_ready'])assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0);
 assert.equal((await request('/api/exercise/open',{token,eventId:randomUUID()})).data.tracked,false);
 assert.equal((await request('/api/state',undefined,admin)).data.participants.length,0);
 const script=await readFile('public/phishing.js','utf8');assert.match(script,/visibilityState/);
});
