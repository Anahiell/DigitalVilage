import test from 'node:test';
import assert from 'node:assert/strict';
import {handlerFixture} from './handler-fixture.mjs';
import {VILLAGES,ROLES,SECURITY_QUESTIONS} from '../data.js';

async function enrol(a,i,role=ROLES[i%8].id,village=VILLAGES[Math.floor(i/8)].id){
 const email=`hour-bot-${i}@example.invalid`,e=await a.request('/api/admin/enrol',{name:`Hour Bot ${i}`,email,role,village,present:true},a.admin);assert.equal(e.status,200,JSON.stringify(e.data));
 const login=await a.request('/api/login',{email,pin:e.data.pin});assert.equal(login.status,200);const s=await a.state(login.cookie);return {id:s.me.id,cookie:login.cookie,role,village};
}
async function ok(a,op,body={},bot){const r=await a.action(op,body,bot?.cookie);assert.equal(r.status,200,JSON.stringify({op,result:r.data}));return r.data;}
async function reach(a,round){for(let i=(await a.state()).game.round;i<round;i++){await ok(a,'closeRound');await ok(a,'next');}}

test('hour profile: one-second simulation, staged server releases, global pause, restart and team checkpoints',async t=>{
 const a=await handlerFixture(t,{fakeClock:true}),mayor=await enrol(a,0),member=await enrol(a,1);
 await ok(a,'start',{workshopMode:true});let s=await a.state(member.cookie);assert.equal(s.game.durationMs,480000);assert.ok(s.rounds.every(r=>r.duration===480));
 assert.equal((await a.action('invest',{id:'school'},member.cookie)).status,409);const budget=s.villages[0].budget;a.tick(1000);assert.notEqual(a.db.prepare('SELECT budget FROM villages LIMIT 1').get().budget,budget);
 a.tick(59000);const p=await ok(a,'invest',{id:'school'},member);await ok(a,'approveProposal',{id:p.proposalId},mayor);
 await ok(a,'roundReady',{ready:true},mayor);assert.equal((await a.action('closeRound',{onlyIfReady:true})).status,409);await ok(a,'roundReady',{ready:true},member);assert.equal((await a.state()).workshop.allReady,true);
 await ok(a,'pause');const frozen=await a.state(member.cookie);a.tick(180000);s=await a.state(member.cookie);assert.deepEqual(s.villages,frozen.villages);assert.equal(s.game.elapsedMs,frozen.game.elapsedMs);assert.equal((await a.action('roundReady',{ready:false},member.cookie)).status,409);
 await a.restart();assert.equal((await a.state()).game.phase,'paused');await ok(a,'resume');await ok(a,'closeRound',{onlyIfReady:true});await ok(a,'next');
 assert.equal((await a.state(member.cookie)).news.length,1);const hidden=(await a.state()).news[1];assert.equal((await a.action('checkNews',{id:hidden.id,note:'I checked the source bulletin.'},member.cookie)).status,409);
 a.tick(30000);assert.equal((await a.state(member.cookie)).news.length,2);await ok(a,'pause');a.tick(60000);assert.equal((await a.state(member.cookie)).news.length,2);await ok(a,'resume');
 await ok(a,'next');assert.equal((await a.state(member.cookie)).workshop.myReady,false);
});

test('acting mayor has exclusive village-scoped authority; checked campaign is bound to the exact shared draft',async t=>{
 const a=await handlerFixture(t,{fakeClock:true}),mayor=await enrol(a,0),member=await enrol(a,1),other=await enrol(a,8);
 await ok(a,'start',{workshopMode:true});const p=await ok(a,'invest',{id:'fiber'},member);
 assert.equal((await a.action('delegateMayor',{id:member.id},member.cookie)).status,403);assert.equal((await a.action('delegateMayor',{id:other.id},mayor.cookie)).status,400);
 await ok(a,'delegateMayor',{id:member.id},mayor);assert.equal((await a.action('approveProposal',{id:p.proposalId},mayor.cookie)).status,403);
 const results=await Promise.all(Array.from({length:6},()=>a.action('approveProposal',{id:p.proposalId},member.cookie)));assert.ok(results.every(r=>r.status===200));assert.equal((await a.state()).builtInvestments.length,1);
 await a.restart();assert.equal((await a.state(member.cookie)).workshop.canApprove,true);await ok(a,'resume');await ok(a,'delegateMayor',{id:'',village:'green-valley'});assert.equal((await a.state(mayor.cookie)).workshop.canApprove,true);
 await reach(a,3);const draft={title:'Visit our city',body:'Meet local people, discover mountain trails and enjoy the youth festival.',assets:['mountains'],credits:'',version:0};
 assert.equal((await a.action('publish',draft,member.cookie)).status,409);await ok(a,'shareCampaign',draft,member);let shared=(await a.state(mayor.cookie)).workshop.campaignDrafts[0];
 assert.equal((await a.action('checkCampaign',{version:0,digest:shared.digest,note:'I checked the asset usage and credit.'},member.cookie)).status,409);
 await ok(a,'checkCampaign',{version:0,digest:shared.digest,note:'I checked the text, usage rights and attribution.'},mayor);
 assert.equal((await a.action('publish',{...draft,body:draft.body+' An unreviewed claim.'},member.cookie)).status,409);
 const proposed=await ok(a,'publish',draft,member);await ok(a,'approveProposal',{id:proposed.proposalId},mayor);assert.equal((await a.state()).posts.length,1);
});

test('five players receive twenty tickets including five red; max three active, owner work plus independent review required',async t=>{
 const a=await handlerFixture(t,{fakeClock:true}),bots=[];for(let i=0;i<5;i++)bots.push(await enrol(a,i));await ok(a,'start',{workshopMode:true});await reach(a,4);
 let s=await a.state();assert.equal(s.tasks.length,15);for(const task of s.tasks.slice(0,3))await ok(a,'claimTask',{id:task.id},bots[0]);assert.equal((await a.action('claimTask',{id:s.tasks[3].id},bots[0].cookie)).status,409);
 const task=s.tasks[0];a.tick(120000);s=await a.state();assert.equal(s.tasks.length,20);assert.equal(s.tasks.filter(t=>t.type==='red').length,5);assert.equal(s.tasks.find(t=>t.id===task.id).done,0);assert.ok(s.tasks.find(t=>t.id===task.id).progress<=80);
 assert.equal((await a.action('helpTask',{id:task.id},bots[0].cookie)).status,409);assert.equal((await a.action('helpTask',{id:task.id},bots[1].cookie)).status,409);await ok(a,'workTask',{id:task.id},bots[0]);await ok(a,'helpTask',{id:task.id},bots[1]);assert.equal((await a.state()).tasks.find(t=>t.id===task.id).done,1);
 await ok(a,'claimTask',{id:s.tasks[3].id},bots[0]);const red=s.tasks.find(t=>t.type==='red');await ok(a,'pauseCrisis');assert.equal((await a.action('claimTask',{id:red.id},bots[1].cookie)).status,400);await ok(a,'resumeCrisis');await ok(a,'claimTask',{id:red.id},bots[1]);
 await ok(a,'pause');const frozen=(await a.state()).tasks;a.tick(90000);assert.deepEqual((await a.state()).tasks,frozen);assert.equal((await a.action('workTask',{id:red.id},bots[1].cookie)).status,409);await ok(a,'resume');await ok(a,'cancelCrisis');assert.equal((await a.state()).tasks.filter(t=>t.type==='red').length,0);
});

test('30 bots play all five hour rounds, cooperate, save reports and reset while preserving report jobs',async t=>{
 const a=await handlerFixture(t,{fakeClock:true}),bots=[];let actions=0;
 for(let i=0;i<30;i++)bots.push(await enrol(a,i));
 await ok(a,'start',{workshopMode:true});const log=[];
 for(let round=1;round<=5;round++){
  const roundActions=actions;
  for(let second=0;second<480;second+=10){
   for(const v of VILLAGES){const team=bots.filter(b=>b.village===v.id),mayor=team.find(b=>b.role==='mayor');if(!team.length)continue;
    if(round===1&&second%60===0&&second<=120){const id=['fiber','school','center'][second/60];const p=await ok(a,'invest',{id},team[1]);await ok(a,'approveProposal',{id:p.proposalId},mayor);actions+=2;}
    if(round===2&&second%30===0){const s=await a.state(team[1].cookie),n=s.news.filter(n=>n.sourceVillage!==v.id).find(n=>!s.workshop.newsChecks.some(c=>c.news_id===n.id));if(n){await ok(a,'checkNews',{id:n.id,note:'Compared the number and projects with the dated city bulletin.'},team[1]);actions++;if(s.choices.filter(c=>c.village_id===v.id).length<6){const p=await ok(a,'chooseNews',{id:n.id},team[1]);await ok(a,'approveProposal',{id:p.proposalId},mayor);actions+=2;}}}
    if(round===3&&second===0){const author=team.find(b=>b.role==='media'),draft={title:'Visit '+v.name,body:'Meet our community and discover our accessible festival, local market and mountain trails.',assets:['mountains','community'],credits:'',version:0};await ok(a,'shareCampaign',draft,author);const d=(await a.state(mayor.cookie)).workshop.campaignDrafts.find(d=>d.village_id===v.id);await ok(a,'checkCampaign',{version:0,digest:d.digest,note:'Read all asset usage conditions and checked the invitation.'},mayor);const p=await ok(a,'publish',draft,author);await ok(a,'approveProposal',{id:p.proposalId},mayor);actions+=4;}
    if(round===4){let s=await a.state(mayor.cookie);for(const task of s.tasks.filter(t=>t.village_id===v.id&&!t.assigned_to&&!t.done)){const owner=team.find(b=>b.role===task.required_role&&s.tasks.filter(t=>t.assigned_to===b.id&&!t.done).length<3)||team.find(b=>s.tasks.filter(t=>t.assigned_to===b.id&&!t.done).length<3);if(owner){await ok(a,'claimTask',{id:task.id},owner);actions++;s=await a.state(mayor.cookie);}}
     for(const task of s.tasks.filter(t=>t.village_id===v.id&&t.assigned_to&&!t.done)){const owner=team.find(b=>b.id===task.assigned_to),helper=team.find(b=>b.id!==owner.id);await ok(a,'workTask',{id:task.id},owner);actions++;if(!(await a.state(mayor.cookie)).tasks.find(t=>t.id===task.id).done){await ok(a,'helpTask',{id:task.id},helper);actions++;}}}
    if(round===5&&second===0)for(const b of team)for(const q of SECURITY_QUESTIONS){await ok(a,'answerSecurity',{id:q.id,answer:q.correct},b);actions++;}
   }
   a.tick(10000);
   // Poll a full wave each simulated minute; every bot must stay on the same round.
   if(second%60===0){const wave=await Promise.all(bots.map(b=>a.state(b.cookie)));assert.ok(wave.every(s=>s.game.round===round));}
  }
  const s=await a.state();assert.equal(s.game.phase,'review');log.push({round,actions:actions-roundActions,tickets:s.tasks?.length||0,done:s.tasks?.filter(t=>t.done).length||0});
  if(round===4)assert.equal(s.tasks.filter(t=>t.done).length,s.tasks.length);
  if(round<5)await ok(a,'next');
 }
 await ok(a,'end');for(const b of bots){const s=await a.state(b.cookie);assert.equal(s.finalReport.rounds.length,5);await ok(a,'acknowledgeReport',{},b);}
 const sessionId=(await a.state()).game.sessionId;assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM final_players').get().n,30);const reportMailCount=a.db.prepare("SELECT COUNT(*) AS n FROM mail_deliveries WHERE kind='report'").get().n;assert.equal(reportMailCount,30);
 assert.equal((await a.request('/api/admin/reset-game',{sessionId,password:a.password,confirm:'RESET FINISHED GAME'},a.admin)).status,200);
 assert.equal((await a.request('/api/admin/reset-game',{sessionId,password:a.password,confirm:'RESET FINISHED GAME'},a.admin)).status,409);assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM mail_deliveries WHERE kind='report'").get().n,reportMailCount);assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,0);assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM final_players').get().n,30);assert.equal((await a.state(bots[0].cookie)).archivedReport.rounds.length,5);
 console.log(JSON.stringify({scenario:'one-hour-bots',players:30,activeMinutes:40,actions,rounds:log,finalReports:30,resetRetainedArchives:true}));
});
