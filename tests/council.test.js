import test from 'node:test';
import assert from 'node:assert/strict';
import {handlerFixture} from './handler-fixture.mjs';
import {VILLAGES,ROLES} from '../data.js';
async function player(a,name,role,village='green-valley'){
 const email=name.toLowerCase().replaceAll(' ','-')+'@example.invalid';const e=await a.request('/api/admin/enrol',{name,email,village,role,present:true},a.admin);assert.equal(e.status,200,JSON.stringify(e.data));return (await a.request('/api/login',{email,pin:e.data.pin})).cookie;
}
test('ready waits for the host; concurrent proposals and repeated mayor approvals spend once and respect village boundaries',async t=>{
 const a=await handlerFixture(t,{fakeClock:true}),mayor=await player(a,'Mayor','mayor'),finance=await player(a,'Finance','finance'),events=await player(a,'Events','events'),other=await player(a,'Other Mayor','mayor','riverstone');
 assert.equal((await a.action('setReady',{ready:true},finance)).status,200);assert.equal((await a.state(finance)).game.round,0);
 await a.action('start',{councilApprovals:true});const before=(await a.state()).villages[0].budget;
 const proposed=await Promise.all([finance,events].map(c=>a.action('invest',{id:'school'},c)));
 assert.ok(proposed.every(p=>p.status===200&&p.data.status==='pending'));assert.equal(proposed[0].data.proposalId,proposed[1].data.proposalId);
 const id=proposed[0].data.proposalId;assert.equal((await a.state()).villages[0].budget,before);assert.equal((await a.state(finance)).builtInvestments.length,0);
 assert.equal((await a.action('approveProposal',{id},finance)).status,403);assert.equal((await a.action('approveProposal',{id},other)).status,404);assert.equal((await a.state(other)).proposals.length,0);
 const approved=await Promise.all(Array.from({length:8},()=>a.action('approveProposal',{id},mayor)));assert.ok(approved.every(r=>r.status===200));
 assert.equal((await a.state()).villages[0].budget,before-19000);assert.equal((await a.state()).builtInvestments.length,1);
 assert.equal((await a.action('invest',{id:'school'},events)).data.status,'already_applied');
 const rejected=await a.action('invest',{id:'fiber'},events);await a.action('rejectProposal',{id:rejected.data.proposalId},mayor);assert.equal((await a.state()).villages[0].budget,before-19000);
 await a.restart();assert.equal((await a.state()).game.councilApprovals,true);assert.equal((await a.state(mayor)).proposals.filter(p=>p.status==='approved').length,1);
});
test('news and campaign require approval; stale edits and closed-round requests cannot apply',async t=>{
 const a=await handlerFixture(t),mayor=await player(a,'Editor Mayor','mayor'),member=await player(a,'Council Events','events');
 await a.action('start',{councilApprovals:true});await a.action('closeRound');await a.action('next');
 const story=(await a.state(member)).news.find(n=>n.sourceVillage!=='green-valley');
 const p=await a.action('chooseNews',{id:story.id},member);assert.equal(p.data.status,'pending');assert.equal((await a.state()).choices.length,0);
 await a.action('approveProposal',{id:p.data.proposalId},mayor);assert.equal((await a.state()).choices.length,1);
 const remove=await a.action('unchooseNews',{id:story.id},member);await a.action('revealNews');assert.equal((await a.action('approveProposal',{id:remove.data.proposalId},mayor)).status,409);
 await a.action('closeRound');assert.equal((await a.state(member)).proposals.find(p=>p.id===remove.data.proposalId).status,'expired');await a.action('next');
 const draft={title:'Our future village',body:'Discover our community and its wonderful mountains.',credits:'',assets:['mountains'],version:0};
 const campaign=await a.action('publish',draft,member);assert.equal(campaign.data.status,'pending');assert.equal((await a.state()).posts.length,0);
 const duplicate=await a.action('publish',draft,member);assert.equal(duplicate.data.proposalId,campaign.data.proposalId);
 assert.equal((await a.action('publish',{...draft,title:'A different campaign'},mayor)).status,409);
 await a.action('approveProposal',{id:campaign.data.proposalId},mayor);assert.equal((await a.state()).posts[0].title,draft.title);
 assert.equal((await a.action('publish',{...draft,title:'A stale campaign'},member)).status,409);
 const v=(await a.state()).posts[0].updated_at,pending=await a.action('publish',{...draft,title:'The next village campaign',version:v},member);
 await a.action('closeRound');assert.equal((await a.action('approveProposal',{id:pending.data.proposalId},mayor)).data.status,'expired');assert.equal((await a.state()).posts[0].title,draft.title);
});
test('host adjustments validate limits and pause; reset clears proposals while retaining saved reports',async t=>{
 const a=await handlerFixture(t),mayor=await player(a,'Reset Mayor','mayor');await a.action('start',{councilApprovals:true});
 const before=(await a.state()).villages[0].trust;
 assert.equal((await a.action('adjustVillage',{village:'green-valley',metric:'trust',delta:12})).status,200);assert.equal((await a.state()).villages[0].trust,before+12);
 assert.equal((await a.action('adjustVillage',{village:'green-valley',metric:'trust',delta:26})).status,400);
 assert.equal((await a.action('adjustVillage',{village:'green-valley',metric:'budget=0; DELETE FROM players',delta:1})).status,400);
 assert.equal((await a.action('adjustVillage',{village:'green-valley',metric:'trust',delta:1},mayor)).status,403);
 await a.action('invest',{id:'school'},mayor);await a.action('pause');assert.equal((await a.action('adjustVillage',{village:'green-valley',metric:'trust',delta:1})).status,409);
 const id=(await a.state(mayor)).proposals[0].id;assert.equal((await a.action('approveProposal',{id},mayor)).status,409);
 await a.action('resume');await a.action('end');const sessionId=(await a.state()).game.sessionId;
 assert.equal((await a.request('/api/admin/reset-game',{confirm:'RESET FINISHED GAME',password:a.password,sessionId},a.admin)).status,200);
 assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM council_proposals').get().n,0);assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM final_players').get().n,1);assert.equal((await a.state()).admin,true);
});
test('30-player council load deduplicates competing requests, preserves task claim races and reconnects',async t=>{
 const a=await handlerFixture(t,{fakeClock:true});const people=[];let requests=0;
 for(let i=0;i<30;i++)people.push({village:VILLAGES[Math.floor(i/8)].id,role:ROLES[i%8].id,cookie:await player(a,'Council Load '+i,ROLES[i%8].id,VILLAGES[Math.floor(i/8)].id)});
 await a.action('start',{councilApprovals:true});
 const proposed=await Promise.all(people.map(async p=>{requests++;const r=await a.action('invest',{id:'school'},p.cookie);assert.equal(r.status,200);return r.data;}));
 assert.equal(new Set(proposed.map(p=>p.proposalId)).size,4);
 const mayors=people.filter(p=>p.role==='mayor');for(const p of mayors){const id=(await a.state(p.cookie)).proposals[0].id;assert.equal((await a.action('approveProposal',{id},p.cookie)).status,200);}
 assert.equal((await a.state()).builtInvestments.length,4);
 for(let wave=0;wave<8;wave++)await Promise.all(people.map(async p=>{requests++;const s=await a.state(p.cookie);assert.ok(s.proposals.every(x=>x.village_id===p.village));}));
 await a.restart();assert.equal((await a.state()).game.phase,'paused');await a.action('resume');
 for(let i=0;i<3;i++){await a.action('closeRound');await a.action('next');}
 const task=(await a.state()).tasks[0],sameVillage=people.filter(p=>p.village===task.village_id);
 const claims=await Promise.all(sameVillage.map(p=>a.action('claimTask',{id:task.id},p.cookie)));assert.equal(claims.filter(c=>c.status===200).length,1);assert.equal(claims.filter(c=>c.status===409).length,7);
 console.log(JSON.stringify({players:30,requests,proposals:4,appliedInvestments:4,duplicateSpends:0,passed:true}));
});
