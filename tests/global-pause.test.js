import test from 'node:test';
import assert from 'node:assert/strict';
import {handlerFixture} from './handler-fixture.mjs';

test('entire session freezes timers, world and manual events; resume retains the partial simulation tick',async t=>{
 const a=await handlerFixture(t,{fakeClock:true});
 assert.equal((await a.action('pause')).status,409);
 await a.action('start');a.tick(7500);
 const beforePause=await a.state();await a.action('pause');
 const paused=await a.state();assert.equal(paused.game.phaseReason,'host');assert.equal(paused.game.elapsedMs,7500);
 a.tick(3600000);assert.equal((await a.action('pause')).status,200);
 let state=await a.state();assert.equal(state.game.elapsedMs,7500);assert.deepEqual(state.villages,paused.villages);
 assert.equal(state.crisisControls.find(c=>c.kind==='funding').effectiveStatus,'session-paused');
 assert.equal(state.crisisControls.find(c=>c.kind==='funding').remainingMs,592500);
 for(const op of ['shock','grant','triggerTicket','revealNews','revealMedia','next'])assert.equal((await a.action(op,{amount:500,village:'green-valley'})).status,409,op);
 assert.equal(state.events.filter(e=>e.kind==='pause').length,1);
 assert.equal((await a.action('resume',{phaseRevision:beforePause.game.phaseRevision})).status,409);
 await a.action('resume',{phaseRevision:state.game.phaseRevision});a.tick(2500);
 state=await a.state();assert.equal(state.game.elapsedMs,10000);
 assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM snapshots WHERE at=(SELECT last_sim_at FROM game)').get().n,4,'A full ten-second tick is preserved across pause');
 assert.equal(state.game.crisisFired,false);
 await a.action('resume');assert.equal((await a.state()).events.filter(e=>e.kind==='resume').length,1);
 a.tick(590000);assert.equal((await a.state()).game.crisisFired,true,'Funding fires at 600 seconds of active game time');
});

test('global pause, independent crisis pause and restart preserve festival work and deadlines',async t=>{
 const a=await handlerFixture(t,{fakeClock:true});
 const account=await a.request('/api/admin/enrol',{name:'Task Mayor',email:'tasks@example.invalid',village:'green-valley',role:'mayor',present:true},a.admin);
 const player=(await a.request('/api/login',{email:'tasks@example.invalid',pin:account.data.pin})).cookie;
 await a.action('start');for(let r=0;r<3;r++)await a.action('next');
 let state=await a.state(),task=state.tasks.find(t=>t.village_id==='green-valley');
 await a.action('claimTask',{id:task.id},player);await a.action('triggerTicket');
 const red=(await a.state()).tasks.find(t=>t.village_id==='green-valley'&&t.type==='red');
 await a.action('claimTask',{id:red.id},player);a.tick(15000);await a.action('pauseCrisis');
 const redProgress=(await a.state()).tasks.find(t=>t.id===red.id).progress;
 await a.action('pause');const paused=await a.state();a.tick(7200000);await a.restart();
 state=await a.state();assert.equal(state.game.phase,'paused');assert.equal(state.game.phaseReason,'host');assert.equal(state.game.elapsedMs,paused.game.elapsedMs);assert.deepEqual(state.tasks,paused.tasks);
 assert.equal((await a.action('helpTask',{id:red.id},player)).status,409);
 await a.action('resume');a.tick(10000);state=await a.state();
 assert.equal(state.crisisControls.find(c=>c.kind==='festival').status,'paused','Global resume does not undo the host’s independent crisis pause');
 assert.equal(state.tasks.find(t=>t.id===red.id).progress,redProgress);assert.ok(state.tasks.find(t=>t.id===task.id).progress>paused.tasks.find(t=>t.id===task.id).progress);
 await a.action('resumeCrisis');a.tick(10000);assert.ok((await a.state()).tasks.find(t=>t.id===red.id).progress>redProgress);
 await a.restart();state=await a.state();assert.equal(state.game.phase,'paused');assert.equal(state.game.phaseReason,'server_restart');
 await a.action('cancelCrisis');assert.equal((await a.action('cancelCrisis')).status,409);
 assert.ok((await a.state()).tasks.every(t=>t.type!=='red'));
});

test('paused round times out only after its saved remaining time; review is distinct from finished',async t=>{
 const a=await handlerFixture(t,{fakeClock:true});await a.action('start');
 const duration=(await a.state()).game.durationMs;a.tick(duration-1500);await a.action('pause');
 a.tick(duration*2);assert.equal((await a.state()).game.phase,'paused');await a.action('resume');a.tick(1499);assert.equal((await a.state()).game.phase,'playing');
 a.tick(1);let state=await a.state();assert.equal(state.game.phase,'review');assert.equal(state.game.phaseReason,'timer');
 assert.equal(state.latestRoundReport.reason,'timer');assert.equal((await a.action('resume')).status,409);
 await a.action('next');assert.equal((await a.state()).game.phase,'playing');
 await a.action('end');state=await a.state();assert.equal(state.game.phase,'ended');assert.equal(state.game.phaseReason,'host');assert.equal((await a.action('resume')).status,409);
});

test('queued exercise mail waits through global pause without expiring or blocking report mail',async t=>{
 const a=await handlerFixture(t,{fakeClock:true});await a.action('start');await a.action('pause');a.tick(100000);
 const exercise=a.mailQueue.enqueue({to:'exercise@example.invalid',subject:'Exercise',body:'Educational test',kind:'exercise'});
 const expires=a.db.prepare('SELECT expires_at FROM mail_jobs WHERE id=?').get(exercise).expires_at;
 const report=a.mailQueue.enqueue({to:'report@example.invalid',subject:'Report',body:'Saved report',kind:'report'});
 a.tick(3600000);await a.mailQueue.drain();
 assert.ok(a.db.prepare('SELECT id FROM mail_jobs WHERE id=?').get(exercise));assert.equal(a.db.prepare('SELECT id FROM mail_jobs WHERE id=?').get(report),undefined);
 await a.action('resume');
 assert.equal(a.db.prepare('SELECT expires_at FROM mail_jobs WHERE id=?').get(exercise).expires_at,expires+3600000,'Only time spent queued during pause is added');
 await a.mailQueue.drain();assert.equal(a.db.prepare('SELECT id FROM mail_jobs WHERE id=?').get(exercise),undefined);
 assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE email='exercise@example.invalid'").get().n,1);
});
