import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {rehearsal} from './helpers.mjs';

async function setup(t){
 const app=await rehearsal(t),db=new DatabaseSync(app.dbPath);t.after(()=>db.close());
 const admin=(await app.request('/api/admin/login',{password:app.password})).cookie;
 const email='final@test.example';
 const account=await app.request('/api/admin/enrol',{name:'Final Mayor',email,village:'green-valley',role:'mayor',present:true},admin);
 const player=(await app.request('/api/login',{email,pin:account.data.pin})).cookie;
 const action=(op,cookie=admin)=>app.request('/api/action',{op},cookie);
 const state=async(cookie=admin)=>(await app.request('/api/state',undefined,cookie)).data;
 const reset=id=>app.request('/api/admin/reset-game',{sessionId:id,confirm:'RESET FINISHED GAME',password:app.password},admin);
 return {...app,db,admin,player,action,state,reset};
}

test('final reports and email enqueue commit together; reset rolls back on failure and rejects races',async t=>{
 const a=await setup(t);
 assert.equal((await a.reset('anything')).status,409);
 await a.action('start');
 a.db.exec("CREATE TRIGGER fail_report BEFORE INSERT ON mail_jobs WHEN NEW.kind='report' BEGIN SELECT RAISE(ABORT,'synthetic queue failure'); END");
 assert.equal((await a.action('end')).status,500);
 assert.equal((await a.state()).game.phase,'playing');
 assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM final_sessions').get().n,0);
 a.db.exec('DROP TRIGGER fail_report');
 await Promise.all([a.action('end'),a.action('end')]);
 assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM final_sessions').get().n,1);
 assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM mail_deliveries WHERE kind='report'").get().n,1);
 let state=await a.state(a.player);assert.equal(state.finalReport.player.name,'Final Mayor');assert.equal(state.finalReport.acknowledged,false);
 assert.equal(state.finalReport.rounds[0].villages[0].team[0].position,'Mayor');
 await a.action('acknowledgeReport',a.player);state=await a.state(a.player);assert.equal(state.finalReport.acknowledged,true);
 const id=state.game.sessionId,report=state.finalReport;
 const invalid=await a.request('/api/admin/reset-game',{sessionId:id,confirm:'RESET FINISHED GAME',password:'wrong'},a.admin);assert.equal(invalid.status,403);
 a.db.exec("CREATE TRIGGER fail_reset BEFORE DELETE ON players BEGIN SELECT RAISE(ABORT,'synthetic reset failure'); END");
 assert.equal((await a.reset(id)).status,500);assert.equal((await a.state()).game.phase,'ended');
 assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM players').get().n,1);
 a.db.exec('DROP TRIGGER fail_reset');
 const results=await Promise.all([a.reset(id),a.reset(id)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal((await a.state()).admin,true,'Host login survives reset');
 assert.equal((await a.state()).game.phase,'waiting');
 assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM players').get().n,0);
 assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM final_players').get().n,1);
 assert.deepEqual((await a.request('/api/final-report',undefined,a.player)).data,report);
 assert.deepEqual((await a.state(a.player)).archivedReport,report);
 assert.equal((await a.action('invest',a.player)).status,401);
 assert.equal((await a.request('/api/final-report')).status,404);
 await a.stop();await a.start();assert.deepEqual((await a.request('/api/final-report',undefined,a.player)).data,report);
 assert.equal((await a.reset(id)).status,409);
});

test('crisis pause/resume preserves remaining delay, cancellation refunds exactly once, and round pause freezes time',async t=>{
 const a=await setup(t);await a.action('start');
 assert.equal((await a.action('cancelCrisis',a.player)).status,403);
 await a.action('pauseCrisis');a.db.exec('UPDATE game SET started_at=started_at-650000,last_sim_at=last_sim_at-10000');
 let s=await a.state();assert.equal(s.game.crisisFired,false);
 await a.action('resumeCrisis');s=await a.state();assert.equal(s.game.crisisFired,false);
 await a.action('shock');s=await a.state();const before=s.villages[0].budget;
 const loss=a.db.prepare("SELECT amount FROM crisis_losses WHERE village_id='green-valley'").get().amount;
 await a.action('cancelCrisis');s=await a.state();assert.equal(s.villages[0].budget,before+loss);
 assert.equal((await a.action('cancelCrisis')).status,409);
 await a.action('pause');const elapsed=(await a.state()).game.elapsedMs;
 await new Promise(r=>setTimeout(r,80));assert.equal((await a.state()).game.elapsedMs,elapsed);
 await a.stop();await a.start();assert.equal((await a.state()).game.elapsedMs,elapsed);
 await a.action('resume');assert.equal((await a.state()).game.phase,'playing');
 for(let i=0;i<3;i++)await a.action('next');await a.action('triggerTicket');
 await a.action('pauseCrisis');assert.equal((await a.state()).crisisControls.find(c=>c.kind==='festival').status,'paused');
 await a.action('cancelCrisis');assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE type='red' AND cancelled=1").get().n,8);
 assert.ok((await a.state()).tasks.every(t=>t.type==='blue'));
 await a.action('closeRound');assert.equal((await a.state()).latestRoundReport.villages[0].decisions.tasks.urgentTotal,0);
});

test('saved report email survives reset and restart and reaches a synthetic SMTP recipient',async t=>{
 const a=await setup(t);await a.stop();
 const capture=a.dbPath+'.reports',real={DEV_EMAIL_OUTBOX:'0',SMTP_EMAIL:'synthetic@example.invalid',SMTP_APP_PASSWORD:'synthetic-password',DV_SYNTHETIC_MAIL_CAPTURE:capture,DV_SYNTHETIC_SMTP_MODE:'success'};
 await a.start(real,true);await a.action('start');await a.action('end');
 // Postpone dispatch so reset occurs with a durable, unsent report job.
 a.db.exec("UPDATE mail_jobs SET next_at=next_at+3600000 WHERE kind='report'");
 const id=(await a.state()).game.sessionId;assert.equal((await a.reset(id)).status,200);
 assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM mail_jobs WHERE kind='report'").get().n,1);
 await a.stop();a.db.exec('UPDATE mail_jobs SET next_at=0');await a.start(real,true);
 for(let n=0;n<80&&a.db.prepare('SELECT COUNT(*) AS n FROM mail_jobs').get().n;n++)await new Promise(r=>setTimeout(r,50));
 const mails=(await readFile(capture,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(mails.length,1);
 assert.equal(mails[0].to,'final@test.example');assert.match(mails[0].text,/Final Mayor/);assert.match(mails[0].text,/Mayor/);
 const token=mails[0].text.match(/\?report=([a-f0-9]{64})/)[1];
 assert.equal((await a.request('/api/final-report?token='+token)).data.player.name,'Final Mayor');
 assert.equal((await a.request('/api/final-report?token='+token.slice(1))).status,404);
 assert.equal(a.db.prepare("SELECT status FROM mail_deliveries WHERE kind='report'").get().status,'accepted');
 await a.stop();await a.start(real,true);await new Promise(r=>setTimeout(r,1100));
 assert.equal((await readFile(capture,'utf8')).trim().split('\n').length,1);
});

test('exercise reaches unsigned-in and late participants once and remains accessible after reset',async t=>{
 const a=await setup(t);
 const enrol=email=>a.request('/api/admin/enrol',{name:'Unsigned Participant',email,village:'riverstone',role:email.startsWith('late')?'digital':'mayor',present:true},a.admin);
 await enrol('unsigned@test.example');
 await a.action('start');for(let n=0;n<4;n++)await a.action('next');
 await enrol('late@test.example');
 for(let n=0;n<60&&a.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE subject LIKE 'Important:%'").get().n<3;n++)await new Promise(r=>setTimeout(r,50));
 const mails=a.db.prepare("SELECT * FROM outbox WHERE subject LIKE 'Important:%'").all();
 assert.deepEqual(mails.map(m=>m.email).sort(),['final@test.example','late@test.example','unsigned@test.example']);
 assert.ok(mails.every(m=>m.body.includes('/phishing')));
 await a.stop();await a.start();await new Promise(r=>setTimeout(r,1100));
 assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE subject LIKE 'Important:%'").get().n,3);
 await a.action('end');assert.equal((await a.reset((await a.state()).game.sessionId)).status,200);
 assert.equal((await a.request('/phishing')).status,200);
});
