import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {handlerFixture} from './handler-fixture.mjs';
import {ticketChallenge} from '../workshop.js';
async function setup(t){const a=await handlerFixture(t,{fakeClock:true}),players=[];for(const role of ['finance','digital','media','events','advisor-1']){const email=role+'@bonus.invalid',e=await a.request('/api/admin/enrol',{name:role,email,village:'green-valley',role,present:true},a.admin);assert.equal(e.status,200);players.push((await a.request('/api/login',{email,pin:e.data.pin})).cookie);}await a.action('start',{workshopMode:true,peerCouncil:true});return {a,players};}
async function round(a,n){while((await a.state()).game.round<n){await a.action('closeRound');await a.action('next');}}
test('ticket challenge saves exactly 20% remaining once; red shares three slots, review stays independent and pauses block bonus',async t=>{
 const {a,players:p}=await setup(t);await round(a,4);a.tick(120000);let s=await a.state(p[0]);const red=s.tasks.find(t=>t.type==='red'),blue=s.tasks.filter(t=>t.type==='blue');
 for(const task of [red,...blue.slice(0,2)])assert.equal((await a.action('claimTask',{id:task.id},p[0])).status,200);
 assert.equal((await a.action('claimTask',{id:blue[2].id},p[0])).status,409);
 a.db.prepare('UPDATE tasks SET progress=40 WHERE id=?').run(red.id);
 assert.equal((await a.action('solveTask',{id:red.id,answer:'wrong'},p[0])).status,400);
 assert.equal((await a.action('solveTask',{id:red.id,answer:ticketChallenge(red).answer},p[1])).status,409);
 await a.action('pause');assert.equal((await a.action('solveTask',{id:red.id,answer:ticketChallenge(red).answer},p[0])).status,409);await a.action('resume');
 const replies=await Promise.all(Array.from({length:5},()=>a.action('solveTask',{id:red.id,answer:ticketChallenge(red).answer},p[0])));assert.ok(replies.every(r=>r.status===200));assert.equal(a.db.prepare('SELECT progress FROM tasks WHERE id=?').get(red.id).progress,52);assert.equal(a.db.prepare('SELECT COUNT(*) n FROM task_bonus').get().n,1);
 await a.action('releaseTask',{id:red.id},p[0]);await a.action('claimTask',{id:red.id},p[1]);await a.action('solveTask',{id:red.id,answer:ticketChallenge(red).answer},p[1]);assert.equal(a.db.prepare('SELECT progress FROM tasks WHERE id=?').get(red.id).progress,52);
 a.tick(60000);assert.equal(a.db.prepare('SELECT done FROM tasks WHERE id=?').get(red.id).done,0);
});
test('round-five preview is harmless; claim penalises once, pause/review block penalties, delayed genuine certificate survives reset',async t=>{
 const {a,players:p}=await setup(t);await round(a,5);let s=await a.state(p[0]),token=new URL(s.exerciseUrl,a.base).searchParams.get('t');const before=s.villages[0];
 const click=(claim,tokenValue=token)=>a.request('/api/exercise/open',{token:tokenValue,eventId:randomUUID(),claim});
 await click(false);assert.equal((await a.state()).villages[0].budget,before.budget);
 await a.action('pause');await click(true);assert.equal(a.db.prepare('SELECT COUNT(*) n FROM exercise_penalties').get().n,0);await a.action('resume');
 await Promise.all(Array.from({length:5},()=>click(true)));s=await a.state();assert.equal(s.villages[0].budget,before.budget-1000);assert.equal(s.villages[0].trust,before.trust-3);assert.equal(a.db.prepare('SELECT COUNT(*) n FROM exercise_penalties').get().n,1);assert.equal(s.participants.filter(p=>p.penalized).length,1);
 const oldReport=a.mailQueue.enqueue({to:'archive@bonus.invalid',subject:'Previous session report',body:'Saved archive',kind:'report'},{action:'report',sessionId:'previous'}),oldNext=a.db.prepare('SELECT next_at FROM mail_jobs WHERE id=?').get(oldReport).next_at;await a.action('closeRound');assert.equal(a.db.prepare('SELECT next_at FROM mail_jobs WHERE id=?').get(oldReport).next_at,oldNext);a.db.prepare('DELETE FROM mail_jobs WHERE id=?').run(oldReport);s=await a.state(p[0]);assert.equal(s.game.phase,'ended');assert.equal(s.finalReport.player.name,'finance');assert.equal(s.finalReport.rounds.length,5);assert.ok(s.finalReport.rounds[4].villages[0].story.includes('finance claimed a simulated city upgrade'));assert.ok(s.finalReport.rounds[4].villages[0].incidents.some(i=>i.title.includes('finance claimed')));
 const jobs=a.db.prepare("SELECT * FROM mail_jobs WHERE kind='report'").all();assert.equal(jobs.length,5);assert.ok(jobs.every(j=>j.next_at>=Date.now()+60000));await click(true);assert.equal(a.db.prepare('SELECT COUNT(*) n FROM exercise_penalties').get().n,1);
 await new Promise(r=>setImmediate(r));await a.mailQueue.drain();const reset=await a.request('/api/admin/reset-game',{sessionId:s.game.sessionId,password:a.password,confirm:'RESET FINISHED GAME'},a.admin);assert.equal(reset.status,200,JSON.stringify(reset.data));assert.equal(a.db.prepare('SELECT COUNT(*) n FROM exercise_penalties').get().n,0);assert.equal(a.db.prepare("SELECT COUNT(*) n FROM mail_jobs WHERE kind='report'").get().n,5);
 a.tick(60001);await a.mailQueue.drain();assert.ok(a.db.prepare("SELECT COUNT(*) n FROM outbox WHERE subject LIKE '%certificate%'").get().n>0);
});
