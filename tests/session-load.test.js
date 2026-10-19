import test from 'node:test';
import assert from 'node:assert/strict';
import {handlerFixture} from './handler-fixture.mjs';
import {VILLAGES,ROLES} from '../data.js';
import {createWorkshopMailer} from '../mailer.js';
import {createMailQueue} from '../mail-queue.js';

test('30 concurrent players: pause, timers, reconnect, final reports, durable email, atomic reset and archives',async t=>{
 const a=await handlerFixture(t,{fakeClock:true}),latencies=[];let requests=0;
 const call=async(path,body,cookie,status=200)=>{
  const start=performance.now(),response=await a.request(path,body,cookie);requests++;latencies.push(performance.now()-start);
  assert.equal(response.status,status,path+': '+JSON.stringify(response.data));return response;
 };
 const action=(op,body={},status=200)=>call('/api/action',{op,...body},a.admin,status);
 const users=await Promise.all(Array.from({length:30},async(_,i)=>{
  const person={name:'Participant '+i,email:`load-${i}@example.invalid`,village:VILLAGES[Math.floor(i/8)].id,role:ROLES[i%8].id,present:true};
  const account=await call('/api/admin/enrol',person,a.admin),login=await call('/api/login',{email:person.email,pin:account.data.pin});return {...person,cookie:login.cookie};
 }));
 await action('start');a.tick(599000);await action('pause');
 const paused=await a.state();a.tick(1800000);
 for(let wave=0;wave<8;wave++){
  const states=await Promise.all(users.map(p=>call('/api/state',undefined,p.cookie)));
  assert.ok(states.every(s=>s.data.game.phase==='paused'&&s.data.game.elapsedMs===paused.game.elapsedMs));
  assert.ok(states.every(s=>s.data.game.crisisFired===false));
 }
 await a.restart();assert.equal((await a.state()).game.phase,'paused');
 await action('resume');a.tick(1000);assert.equal((await a.state()).game.crisisFired,true);
 await action('cancelCrisis');await action('cancelCrisis',{},409);
 for(let r=2;r<=5;r++){
  await action('next');const states=await Promise.all(users.map(p=>call('/api/state',undefined,p.cookie)));assert.ok(states.every(s=>s.data.game.round===r));
 }
 for(let n=0;n<40;n++){await a.mailQueue.drain();await new Promise(r=>setImmediate(r));if(!a.db.prepare('SELECT COUNT(*) AS n FROM mail_jobs').get().n&&!a.mailQueue.active)break;}
 assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE subject LIKE 'Important:%'").get().n,30);
 a.db.exec("CREATE TRIGGER fail_finalize BEFORE INSERT ON mail_jobs WHEN NEW.kind='report' BEGIN SELECT RAISE(ABORT,'injected queue failure'); END");
 await action('end',{},500);assert.equal((await a.state()).game.phase,'playing');assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM final_sessions').get().n,0);
 a.db.exec('DROP TRIGGER fail_finalize');await action('end');await action('end');
 const finals=await Promise.all(users.map(p=>call('/api/state',undefined,p.cookie)));
 for(let i=0;i<users.length;i++){
  const report=finals[i].data.finalReport;assert.equal(report.player.name,users[i].name);assert.equal(report.player.role,users[i].role);
  const village=report.rounds.at(-1).villages.find(v=>v.id===users[i].village);assert.ok(village.team.some(p=>p.name===users[i].name));assert.ok(village.stats);
 }
 assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM mail_jobs WHERE kind='report'").get().n,30);
 await Promise.all(users.map(p=>call('/api/action',{op:'acknowledgeReport'},p.cookie)));
 const sessionId=finals[0].data.game.sessionId,reset={sessionId,password:a.password,confirm:'RESET FINISHED GAME'};
 a.db.exec("UPDATE mail_jobs SET next_at=next_at+3600000 WHERE kind='report'; CREATE TRIGGER fail_reset BEFORE DELETE ON players BEGIN SELECT RAISE(ABORT,'injected reset failure'); END");
 await call('/api/admin/reset-game',reset,a.admin,500);assert.equal((await a.state()).stats.registered,30);assert.equal((await a.state()).game.phase,'ended');
 a.db.exec('DROP TRIGGER fail_reset');const resets=await Promise.all([a.request('/api/admin/reset-game',reset,a.admin),a.request('/api/admin/reset-game',reset,a.admin)]);assert.deepEqual(resets.map(r=>r.status).sort(),[200,409]);requests+=2;
 for(const table of ['players','tasks','security_answers','crisis_controls','exercise_tracking','news','round_reports','snapshots','events','investments'])assert.equal(a.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,table);
 assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE admin=0").get().n,0);assert.equal((await a.state()).admin,true);
 assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM villages').get().n,4);assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM final_players').get().n,30);
 await a.restart();assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM mail_jobs WHERE kind='report'").get().n,30);
 const archived=await Promise.all(users.map(p=>call('/api/final-report',undefined,p.cookie)));assert.ok(archived.every((r,i)=>r.data.player.name===users[i].name));
 // Dispatch the actual persisted encrypted report jobs through the real SMTP adapter
 // with a synthetic transport: one transient provider error, then acceptance per job.
 a.mailQueue.close();const deliveries=[],attempts=new Map();
 const synthetic=createWorkshopMailer({env:{SMTP_EMAIL:'sender@example.invalid',SMTP_APP_PASSWORD:'synthetic-only'},wait:async()=>{},
  record:e=>a.db.prepare('UPDATE mail_deliveries SET status=?,provider=?,attempts=?,error_code=? WHERE id=?').run(e.status,e.provider,e.attempts,e.code||'',e.id),
  transportFactory:()=>({async sendMail(message){const count=(attempts.get(message.messageId)||0)+1;attempts.set(message.messageId,count);if(count===1)throw Object.assign(Error('Synthetic transient SMTP error'),{responseCode:451});deliveries.push(message);return {accepted:[message.to],messageId:message.messageId};}})});
 const queue=createMailQueue({db:a.db,secret:a.secret,mailer:synthetic});t.after(()=>queue.close());
 a.tick(3600000);for(let n=0;n<40;n++)await queue.drain();
 assert.equal(deliveries.length,30);assert.equal(attempts.size,30);assert.ok([...attempts.values()].every(n=>n===2));
 assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM mail_deliveries WHERE kind='report' AND status='accepted'").get().n,30);
 assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM mail_jobs').get().n,0);
 const email=deliveries.find(m=>m.to===users[0].email).text;
 const token=email.match(/\?report=([a-f0-9]{64})/)[1];assert.equal((await call('/api/final-report?token='+token)).data.player.name,users[0].name);
 latencies.sort((x,y)=>x-y);const percentile=p=>Number(latencies[Math.ceil(latencies.length*p)-1].toFixed(2));
 console.log(JSON.stringify({transport:'real handler / SQLite, no TCP',players:30,requests,unexpectedErrors:0,expectedFaultChecks:2,p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),passed:true}));
});
