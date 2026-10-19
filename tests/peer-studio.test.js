import test from 'node:test';
import assert from 'node:assert/strict';
import {handlerFixture} from './handler-fixture.mjs';
import {MEDIA_ASSETS,SECURITY_QUESTIONS} from '../data.js';
async function players(a){const people=[];for(const role of ['finance','digital','media','events','advisor-1']){const email=`peer-${role}@example.invalid`,r=await a.request('/api/admin/enrol',{name:role,email,village:'green-valley',role,present:true},a.admin);assert.equal(r.status,200);const cookie=(await a.request('/api/login',{email,pin:r.data.pin})).cookie;people.push({cookie,role,village:'green-valley',id:(await a.state(cookie)).me.id,actions:0});}return people;}
async function ok(a,op,body={},p){if(op==='shareCampaign'&&body.baseDigest===undefined)body={...body,baseDigest:(await a.state(p.cookie)).workshop.campaignDrafts.find(d=>d.village_id===p.village)?.digest||''};const r=await a.action(op,body,p?.cookie);assert.equal(r.status,200,JSON.stringify({op,data:r.data}));if(p)p.actions++;return r.data;}
async function round(a,n){while((await a.state()).game.round<n){await ok(a,'closeRound');await ok(a,'next');}}
test('controlled campaign economy: free artwork, unlicensed branding and a paid workshop contract have different real outcomes',async t=>{
 for(const scenario of [{asset:'mountains',paid:false,budget:10650,trust:73},{asset:'nike',paid:false,budget:7500,trust:68},{asset:'nike',paid:true,budget:8250,trust:73}])await t.test(scenario.asset+(scenario.paid?' paid':' unpaid'),async t=>{
  const a=await handlerFixture(t,{fakeClock:true}),p=await players(a);await ok(a,'start',{workshopMode:true,peerCouncil:true});await round(a,3);a.db.prepare("UPDATE villages SET budget=10000,trust=72 WHERE id='green-valley'").run();
  if(scenario.paid){const x=await ok(a,'licenseAsset',{id:scenario.asset},p[0]);await ok(a,'approveProposal',{id:x.proposalId},p[1]);}
  const draft={title:'Youth Futures Festival',body:'Saturday 18 July, 14:00 at Green Valley square. Try cycling and digital making. Join us at the welcome desk!',assets:[scenario.asset],credits:'',version:0};await ok(a,'shareCampaign',draft,p[0]);const d=(await a.state(p[1].cookie)).workshop.campaignDrafts[0];await ok(a,'checkCampaign',{version:0,digest:d.digest,note:'Read the usage card and checked the practical event information.'},p[1]);const x=await ok(a,'publish',draft,p[0]);await ok(a,'approveProposal',{id:x.proposalId},p[2]);await ok(a,'revealMedia');const v=(await a.state()).villages[0];assert.equal(v.budget,scenario.budget);assert.equal(v.trust,scenario.trust);
 });
});
test('peer decisions work with no mayor, prevent self approval/double spending, resolve disputes and allow explicit host moderation',async t=>{
 const a=await handlerFixture(t,{fakeClock:true}),p=await players(a);await ok(a,'start',{workshopMode:true,peerCouncil:true});
 const b=(await a.state()).villages[0].budget,proposal=await ok(a,'invest',{id:'fiber'},p[0]);assert.equal((await a.action('approveProposal',{id:proposal.proposalId},p[0].cookie)).status,403);
 const votes=await Promise.all([p[1],p[2]].map(p=>a.action('approveProposal',{id:proposal.proposalId},p.cookie)));assert.ok(votes.every(v=>v.status===200));assert.equal((await a.state()).villages[0].budget,b-29000);
 a.tick(60000);const school=await ok(a,'invest',{id:'school'},p[1]);assert.equal((await ok(a,'rejectProposal',{id:school.proposalId},p[2])).status,'pending');assert.equal((await ok(a,'approveProposal',{id:school.proposalId},p[3])).status,'pending');assert.equal((await ok(a,'approveProposal',{id:school.proposalId},p[4])).status,'approved');
 a.tick(60000);const stuck=await ok(a,'invest',{id:'center'},p[0]);await ok(a,'rejectProposal',{id:stuck.proposalId},p[1]);assert.equal((await a.action('resolveCouncil',{id:stuck.proposalId,status:'approved'},p[2].cookie)).status,403);await ok(a,'pause');assert.equal((await a.action('resolveCouncil',{id:stuck.proposalId,status:'approved'})).status,409);await ok(a,'resume');await ok(a,'resolveCouncil',{id:stuck.proposalId,status:'rejected'});assert.equal((await a.state()).builtInvestments.length,2);
});
test('poster layout is reviewed exactly; fictional paid contracts spend once and change the campaign assessment',async t=>{
 const a=await handlerFixture(t,{fakeClock:true}),p=await players(a);await ok(a,'start',{workshopMode:true,peerCouncil:true});await round(a,3);
 assert.equal(MEDIA_ASSETS.filter(a=>a.kind==='brand').length,23);
 const d={title:'Youth Futures Festival',body:'Saturday 18 July, 14:00 at Green Valley community square. Try cycling and digital making. Join us at the welcome desk!',credits:'',assets:['nike'],version:0,layout:{format:'square',theme:'sunset',positions:{title:{x:.1,y:.1,scale:1}}}};
 await ok(a,'shareCampaign',d,p[0]);const shared=(await a.state(p[1].cookie)).workshop.campaignDrafts[0];assert.equal((await a.action('shareCampaign',{...d,title:'Stale overwrite',baseDigest:'stale'},p[2].cookie)).status,409);assert.equal((await a.state(p[1].cookie)).workshop.campaignDrafts[0].digest,shared.digest);await ok(a,'checkCampaign',{version:0,digest:shared.digest,note:'Checked the date, place, call to action and asset rights.'},p[1]);
 assert.equal((await a.action('publish',{...d,layout:{...d.layout,theme:'night'}},p[0].cookie)).status,409);
 const before=(await a.state()).villages[0].budget,licence=await ok(a,'licenseAsset',{id:'nike'},p[2]);await ok(a,'approveProposal',{id:licence.proposalId},p[3]);await ok(a,'approveProposal',{id:licence.proposalId},p[4]);assert.equal((await a.state()).villages[0].budget,before-2400);
 const post=await ok(a,'publish',d,p[0]);await ok(a,'approveProposal',{id:post.proposalId},p[4]);await ok(a,'revealMedia');const s=await a.state();assert.equal(s.campaignReviews['green-valley'][0].permitted,true);assert.equal(s.posts[0].layout.theme,'sunset');
});
test('five bots without a mayor complete every round; useful actions are distributed across all five people',async t=>{
 const a=await handlerFixture(t,{fakeClock:true}),p=await players(a),results=[];await ok(a,'start',{workshopMode:true,peerCouncil:true});
 for(let r=1;r<=5;r++){
  const start=p.map(b=>b.actions);
  for(let second=0;second<480;second+=10){
   if(r===1&&second===0)for(const person of p)await ok(a,'assessProject',{id:'fiber',note:'From '+person.role+': compare connectivity, employment and running costs against the remaining budget.'},person);
   if(r===1&&second%60===0&&second<=120){const n=second/60,x=await ok(a,'invest',{id:['fiber','school','center'][n]},p[n]);await ok(a,'approveProposal',{id:x.proposalId},p[(n+1)%5]);}
   if(r===2&&second%30===0){const state=await a.state(p[0].cookie),n=state.news.filter(n=>n.sourceVillage!=='green-valley').find(n=>!state.choices.some(c=>c.news_id===n.id));if(n&&state.choices.length<6){const author=p[(second/30)%5];await ok(a,'checkNews',{id:n.id,note:'Compared the report with the frozen city bulletin and project list.'},author);const x=await ok(a,'chooseNews',{id:n.id},author);await ok(a,'approveProposal',{id:x.proposalId},p[((second/30)+1)%5]);}}
   if(r===3&&second%60===0&&second<300){const i=second/60,version=(await a.state()).posts[0]?.updated_at||0,d={title:'Youth Futures Festival · '+i,body:'Saturday 18 July, 14:00, Green Valley square. Try cycling and digital making with our local community. Join us at the welcome desk!',credits:'',assets:['mountains','community'],version,layout:{format:'portrait',theme:['forest','sunset','ocean','night','forest'][i],positions:{}}};await ok(a,'shareCampaign',d,p[i]);const draft=(await a.state(p[(i+1)%5].cookie)).workshop.campaignDrafts[0];await ok(a,'checkCampaign',{version,digest:draft.digest,note:'Checked the design, city claims, date, place and free asset usage.'},p[(i+1)%5]);const x=await ok(a,'publish',d,p[i]);await ok(a,'approveProposal',{id:x.proposalId},p[(i+2)%5]);}
   if(r===4){let s=await a.state(p[0].cookie);for(const task of s.tasks.filter(t=>!t.assigned_to&&!t.done)){const owner=[...p].sort((a,b)=>a.actions-b.actions).find(b=>s.tasks.filter(t=>t.assigned_to===b.id&&!t.done).length<3);if(owner){await ok(a,'claimTask',{id:task.id},owner);s=await a.state(p[0].cookie);}}
    for(const task of s.tasks.filter(t=>t.assigned_to&&!t.done)){const owner=p.find(b=>b.id===task.assigned_to),helper=[...p].filter(b=>b!==owner).sort((a,b)=>a.actions-b.actions)[0];await ok(a,'workTask',{id:task.id},owner);if(!(await a.state(p[0].cookie)).tasks.find(t=>t.id===task.id).done)await ok(a,'helpTask',{id:task.id},helper);}}
   if(r===5&&second===0)for(const person of p)for(const q of SECURITY_QUESTIONS)await ok(a,'answerSecurity',{id:q.id,answer:q.correct},person);
   a.tick(10000);
  }
  const s=await a.state();assert.equal(s.game.phase,'review');results.push({round:r,actions:p.map((b,i)=>b.actions-start[i]),budget:s.villages[0].budget,youngResidents:s.villages[0].youth});if(r===4)assert.equal(s.tasks.filter(t=>t.done).length,20);if(r<5)await ok(a,'next');
 }
 await ok(a,'end');assert.equal((await a.state(p[0].cookie)).finalReport.rounds.length,5);assert.equal((await a.state()).proposals.filter(p=>p.status==='pending').length,0);assert.ok(p.every(b=>b.actions>=15));console.log(JSON.stringify({scenario:'five-bots-no-mayor',players:5,totalActions:p.map(b=>({role:b.role,actions:b.actions})),rounds:results,allTickets:20,allReports:5}));
});
