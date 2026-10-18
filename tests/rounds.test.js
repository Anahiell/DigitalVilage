import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {rehearsal} from './helpers.mjs';
import {SECURITY_QUESTIONS,VILLAGES} from '../data.js';
import {generateNews,campaignReview,buildWorkshopStories} from '../game-content.js';

async function setup(t){
 const app=await rehearsal(t),admin=(await app.request('/api/admin/login',{password:app.password})).cookie;
 async function enrol(role,village='green-valley',name=role){
  const email=role+'-'+village+'@test.example';
  const r=await app.request('/api/admin/enrol',{name:name.length<2?'Player '+name:name,email,village,role,present:true},admin);assert.equal(r.status,200,JSON.stringify(r.data));
  const login=await app.request('/api/login',{email,pin:r.data.pin});assert.equal(login.status,200);
  return {cookie:login.cookie,email,id:(await app.request('/api/state',undefined,login.cookie)).data.me.id};
 }
 const db=new DatabaseSync(app.dbPath);t.after(()=>db.close());
 const action=(op,body={},cookie=admin)=>app.request('/api/action',{op,...body},cookie);
 const state=async cookie=>(await app.request('/api/state',undefined,cookie||admin)).data;
 return {...app,admin,enrol,db,action,state};
}

test('host can enrol a present participant when all real email providers are unavailable',async t=>{
 const app=await rehearsal(t);await app.stop();await app.start({DEV_EMAIL_OUTBOX:'0'});
 const admin=(await app.request('/api/admin/login',{password:app.password})).cookie;
 const account={name:'Present Player',email:'present@test.example',village:'green-valley',role:'mayor'};
 assert.equal((await app.request('/api/register',account)).status,503);
 assert.equal((await app.request('/api/admin/enrol',{...account,present:true})).status,403);
 assert.equal((await app.request('/api/admin/enrol',account,admin)).status,400);
 const enrolled=await app.request('/api/admin/enrol',{...account,present:true},admin);
 assert.equal(enrolled.status,200);assert.match(enrolled.data.pin,/^\d{6}$/);
 const login=await app.request('/api/login',{email:account.email,pin:enrolled.data.pin});assert.equal(login.status,200);
 const state=(await app.request('/api/state',undefined,login.cookie)).data;
 assert.equal(state.me.verified,1);assert.equal(state.emailConfigured,false);
 assert.equal((await app.request('/api/admin/test-email',{email:account.email},admin)).status,503);
});

test('all five rounds save immutable statistics, teams, decisions and factual stories',async t=>{
 const {request,admin,enrol,db,action,state}=await setup(t);
 const mayor=await enrol('mayor','green-valley','Avery Council'),finance=await enrol('finance','green-valley','Taylor Finance');
 assert.equal((await action('start')).status,200);
 db.exec("UPDATE villages SET budget=100000 WHERE id='green-valley'");
 assert.equal((await action('shock')).status,200);
 let s=await state(mayor.cookie);assert.equal(s.villages[0].budget,70000);assert.equal(s.histories['green-valley'].at(-1).budget,70000);
 assert.equal(db.prepare("SELECT amount FROM crisis_losses WHERE village_id='green-valley'").get().amount,30000);
 await action('shock');assert.equal((await state()).villages[0].budget,70000);
 await action('closeRound');s=await state();assert.equal(s.game.phase,'review');
 const round1=(await request('/api/reports?round=1',undefined,mayor.cookie)).data;
 assert.equal(round1.villages[0].stats.budget,70000);assert.equal(round1.villages[0].team[0].name,'Avery Council');assert.equal(round1.villages[0].team[0].position,'Mayor');
 assert.match(round1.villages[0].story,/30,000/);assert.equal(JSON.stringify(round1).includes(mayor.email),false);
 for(const op of ['resume','shock','grant'])assert.equal((await action(op,{village:'green-valley',amount:1000})).status,409);
 assert.equal((await action('invest',{id:'fiber'},mayor.cookie)).status,409);
 await action('closeRound');assert.deepEqual((await request('/api/reports?round=1',undefined,admin)).data,round1);
 await action('next');s=await state(mayor.cookie);
 assert.equal(s.game.round,2);assert.equal(s.news.length,28);assert.ok(s.news.every(n=>!('authentic' in n)&&!('explanation' in n)));
 assert.equal(s.newsSources.find(x=>x.villageId==='green-valley').stats.budget,70000);
 const host=await state(),other=host.news.filter(n=>n.sourceVillage!=='green-valley');
 assert.equal((await action('chooseNews',{id:host.news.find(n=>n.sourceVillage==='green-valley').id},mayor.cookie)).status,400);
 for(const article of other.slice(0,6))assert.equal((await action('chooseNews',{id:article.id},mayor.cookie)).status,200);
 assert.equal((await action('chooseNews',{id:other[0].id},mayor.cookie)).status,200);
 assert.equal((await action('chooseNews',{id:other[6].id},mayor.cookie)).status,409);
 assert.equal((await action('unchooseNews',{id:other[0].id},finance.cookie)).status,403);
 await action('grant',{village:'green-valley',amount:1000});
 assert.deepEqual((await request('/api/reports?round=1',undefined,admin)).data,round1);
 await action('closeRound');s=await state(mayor.cookie);
 assert.equal(s.latestRoundReport.round,2);assert.equal(s.latestRoundReport.villages[0].decisions.news.selected,6);assert.ok(s.news.every(n=>typeof n.authentic==='boolean'&&n.explanation));
 await action('next');
 const originalVersion=(await state()).posts.find(p=>p.village_id==='green-valley')?.updated_at||0;
 assert.equal((await action('publish',{version:originalVersion,title:'Our village invitation',body:'Explore the local forests, culture and our community together.',assets:['cc'],credits:''},mayor.cookie)).status,200);
 const stale=await action('publish',{version:originalVersion,title:'Concurrent old draft',body:'This old draft must not overwrite the newer saved campaign.',assets:[]},mayor.cookie);assert.equal(stale.status,409);
 assert.equal((await state()).posts.find(p=>p.village_id==='green-valley').title,'Our village invitation');
 await action('closeRound');s=await state();
 assert.equal(s.latestRoundReport.villages[0].decisions.campaign.assets[0].permitted,false);
 assert.match(s.latestRoundReport.villages[0].decisions.campaign.assets[0].reason,/attribution/);
 await action('next');await action('closeRound');s=await state();
 assert.equal(s.latestRoundReport.villages[0].decisions.tasks.urgentTotal,0);
 assert.equal(s.events.some(e=>e.title==='Successful youth festival'),false);
 await action('next');s=await state(mayor.cookie);
 assert.equal(s.securityQuestions.length,4);assert.ok(s.securityQuestions.every(q=>!('correct' in q)));
 for(const person of [mayor,finance])for(const question of SECURITY_QUESTIONS)assert.equal((await action('answerSecurity',{id:question.id,answer:question.correct},person.cookie)).status,200);
 assert.equal((await action('answerSecurity',{id:'sender',answer:'invalid'},mayor.cookie)).status,400);
 await action('answerSecurity',{id:'sender',answer:'reply'},mayor.cookie);await action('answerSecurity',{id:'sender',answer:'verify'},mayor.cookie);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM security_answers').get().n,8);
 const trust=db.prepare("SELECT trust FROM villages WHERE id='green-valley'").get().trust;
 await action('closeRound');s=await state(mayor.cookie);
 assert.equal(s.latestRoundReport.villages[0].decisions.security.correct,8);assert.equal(s.latestRoundReport.villages[0].decisions.security.possible,8);
 assert.ok(Math.abs(s.villages[0].trust-Math.round(trust+4))<1);
 assert.ok(s.securityQuestions.every(q=>q.correct&&q.explanation));assert.equal((await action('answerSecurity',{id:'sender',answer:'reply'},mayor.cookie)).status,409);
 await action('end');s=await state();assert.equal(s.game.phase,'ended');assert.equal(s.roundReportIndex.length,5);
 assert.equal(s.workshopStories.length,4);assert.match(s.workshopStories[0].story,/verified/);assert.match(s.workshopStories[0].story,/8\/8/);
 assert.equal((await request('/api/reports?round=3')).status,401);
 const cached=await request('/api/state?history='+s.historyVersion,undefined,mayor.cookie);assert.equal(cached.data.histories,undefined);
});

test('festival workload, roles, help cooldown, urgent tickets and full completion',async t=>{
 const {request,admin,enrol,db,action,state}=await setup(t);
 const mayor=await enrol('mayor'),digital=await enrol('digital'),finance=await enrol('finance'),advisor=await enrol('advisor-1'),events=await enrol('events'),outsider=await enrol('mayor','riverstone');
 await action('start');await action('next');await action('next');
 assert.equal((await action('publish',{title:'Credited campaign',body:'Enjoy our river, cultural activities and community events.',assets:['cc'],credits:'Digital Village workshop artwork (CC BY)'},outsider.cookie)).status,200);
 await action('next');let s=await state();
 assert.equal(s.game.round,4);assert.equal(s.tasks.length,16);
 const tasks=s.tasks.filter(x=>x.village_id==='green-valley'),wifi=tasks.find(x=>x.required_role==='digital'),funds=tasks.find(x=>x.required_role==='finance'),venue=tasks.find(x=>x.required_role==='events'),programme=tasks.find(x=>x.required_role==='media');
 for(const [person,task] of [[digital,wifi],[advisor,funds],[mayor,venue],[mayor,programme]])assert.equal((await action('claimTask',{id:task.id},person.cookie)).status,200);
 assert.equal((await action('claimTask',{id:wifi.id},finance.cookie)).status,409);
 assert.equal((await action('claimTask',{id:funds.id},outsider.cookie)).status,400);
 db.exec('UPDATE game SET last_sim_at=last_sim_at-60000');s=await state();
 const progress=id=>s.tasks.find(x=>x.id===id).progress;
 assert.ok(Math.abs(progress(wifi.id)-20)<.01);assert.ok(Math.abs(progress(funds.id)-8.75)<.01);
 assert.ok(Math.abs(progress(venue.id)-12.5)<.01);assert.ok(Math.abs(progress(programme.id)-10)<.01);
 assert.equal((await action('helpTask',{id:wifi.id},digital.cookie)).status,409);
 assert.equal((await action('helpTask',{id:funds.id},finance.cookie)).status,200);
 assert.equal((await action('helpTask',{id:funds.id},finance.cookie)).status,429);
 assert.ok((await state(finance.cookie)).helpCooldowns[funds.id]);
 assert.equal((await action('helpTask',{id:funds.id},outsider.cookie)).status,400);
 await action('releaseTask',{id:funds.id},advisor.cookie);await action('claimTask',{id:funds.id},finance.cookie);
 db.exec('UPDATE game SET started_at=started_at-240000');s=await state();
 assert.equal(s.tasks.length,24);assert.equal(s.game.ticketsFired,true);
 await action('triggerTicket');assert.equal((await state()).tasks.length,24);
 const red=s.tasks.filter(x=>x.village_id==='green-valley'&&x.type==='red');
 for(const task of red)await action('claimTask',{id:task.id},task.required_role==='digital'?digital.cookie:events.cookie);
 db.exec('UPDATE game SET started_at=started_at-1080000,last_sim_at=last_sim_at-1080000,last_dynamic_event_at=last_dynamic_event_at-1080000');
 s=await state();assert.equal(s.game.phase,'playing');assert.equal(s.tasks.filter(x=>x.village_id==='green-valley'&&x.done).length,6);
 const before=db.prepare("SELECT youth FROM villages WHERE id='green-valley'").get().youth;
 await action('closeRound');s=await state();assert.equal(s.latestRoundReport.villages[0].decisions.tasks.done,6);
 assert.ok(Math.abs(s.latestRoundReport.villages[0].stats.youth-before-12)<.02);
 assert.ok(s.events.some(e=>e.village_id==='green-valley'&&e.title==='Successful youth festival'));
 assert.equal((await action('releaseTask',{id:wifi.id},digital.cookie)).status,409);
 const campaign=(await request('/api/reports?round=3',undefined,admin)).data.villages.find(v=>v.id==='riverstone').decisions.campaign;
 assert.equal(campaign.assets[0].permitted,true);
});

test('timer closes the round without a client; restart keeps its report and legacy campaign data',async t=>{
 const {request,admin,enrol,db,action,state,stop,start}=await setup(t);await enrol('mayor');await action('start');
 db.exec('UPDATE game SET started_at=started_at-1201000,last_sim_at=last_sim_at-11000');
 for(let attempt=0;attempt<50&&db.prepare('SELECT phase FROM game').get().phase!=='review';attempt++)await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(db.prepare('SELECT phase FROM game').get().phase,'review');
 let s=await state();assert.equal(s.latestRoundReport.elapsedMs,1200000);assert.equal(s.latestRoundReport.reason,'timer');
 const report=s.latestRoundReport;await stop();await start();s=await state();assert.deepEqual(s.latestRoundReport,report);
 assert.equal(s.game.phase,'review');assert.equal((await action('shock')).status,409);
 await stop();db.exec('ALTER TABLE posts DROP COLUMN credits');await start();
 assert.ok(db.prepare('PRAGMA table_info(posts)').all().some(column=>column.name==='credits'));
 assert.deepEqual((await request('/api/reports?round=1',undefined,admin)).data,report);
});

test('news generation varies, keeps four facts and three fabrications per village, and uses real closing data',()=>{
 const values=VILLAGES.map(v=>({...v,verified:1}));
 const one=generateNews(values,[],[],1234),two=generateNews(values,[],[],1234);
 assert.equal(one.articles.length,28);assert.notDeepEqual(one.articles.map(a=>a.id),two.articles.map(a=>a.id));
 for(const village of values){const selected=one.articles.filter(a=>a.sourceVillage===village.id);assert.equal(selected.filter(a=>a.authentic).length,4);assert.equal(selected.filter(a=>!a.authentic).length,3);assert.ok(selected.every(a=>a.headline.includes(village.name)));assert.equal(one.sources.find(s=>s.villageId===village.id).stats.budget,village.budget);}
 assert.equal(campaignReview({asset_ids:'["cc"]',credits:''})[0].permitted,false);
 assert.equal(campaignReview({asset_ids:'["cc"]',credits:'Digital Village workshop artwork (CC BY)'})[0].permitted,true);
 assert.equal(campaignReview({asset_ids:'["cc"]',credits:'aaaa'})[0].permitted,false);
 assert.deepEqual(buildWorkshopStories([]),[]);
});
