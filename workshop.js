import {normaliseLayout} from './public/poster-model.js';
import {createHash} from 'node:crypto';
// Opt-in rules for new one-hour workshops. Existing sessions retain their rules.
export function createWorkshop({db,game,elapsed,now,error,log,investments}){
 db.exec(`CREATE TABLE IF NOT EXISTS project_notes(player_id TEXT NOT NULL,asset_id TEXT NOT NULL,note TEXT NOT NULL,PRIMARY KEY(player_id,asset_id));
 CREATE TABLE IF NOT EXISTS round_ready(player_id TEXT PRIMARY KEY,round INTEGER NOT NULL,ready INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS acting_mayors(village_id TEXT PRIMARY KEY,player_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS task_collaboration(task_id TEXT NOT NULL,player_id TEXT NOT NULL,kind TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(task_id,player_id,kind));
 CREATE TABLE IF NOT EXISTS news_checks(player_id TEXT NOT NULL,news_id TEXT NOT NULL,note TEXT NOT NULL,PRIMARY KEY(player_id,news_id));
 CREATE TABLE IF NOT EXISTS campaign_checks(player_id TEXT PRIMARY KEY,version INTEGER NOT NULL,note TEXT NOT NULL,digest TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS campaign_drafts(village_id TEXT PRIMARY KEY,author_id TEXT NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL);`);
 db.exec('CREATE TABLE IF NOT EXISTS task_bonus(task_id TEXT PRIMARY KEY,player_id TEXT NOT NULL,at INTEGER NOT NULL)');
 const one=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 const fail=(code,text)=>{throw error(code,text);};
 const digest=b=>createHash('sha256').update(JSON.stringify({title:String(b.title||'').trim(),body:String(b.body||'').trim(),credits:String(b.credits||'').trim(),assets:[...new Set(Array.isArray(b.assets)?b.assets:[])],version:Number(b.version),layout:(()=>{try{return normaliseLayout(b.layout);}catch(e){fail(400,e.message);}})()})).digest('hex');
 const enabled=()=>!!game().workshop_mode;
 const duration=g=>g.workshop_mode?480000:0;
 const trigger=(g,kind)=>g.workshop_mode?(kind==='funding'?240000:120000):(kind==='funding'?600000:240000);
 function canApprove(player){const deputy=one('SELECT player_id FROM acting_mayors WHERE village_id=?',player.village_id);return deputy?deputy.player_id===player.id:player.role==='mayor';}
 function availableInvestment(id){if(!enabled()||game().round!==1)return true;const i=investments.findIndex(x=>x.id===id);return i>=0&&elapsed(game())>=i*60000;}
 function newsRelease(id){const ids=all('SELECT id FROM news ORDER BY rowid'),index=ids.findIndex(n=>n.id===id);return index<0?Infinity:index*30000;}
 function availableNews(id){return !enabled()||game().round!==2||elapsed(game())>=newsRelease(id);}
 function beforeDecision(player,b,approving=false){
  if(!enabled())return;
  if(b.op==='invest'&&!availableInvestment(b.id))fail(409,'This project is not available yet. A new project arrives each active minute.');
  if(b.op==='chooseNews'){
   if(!availableNews(b.id))fail(409,'This story has not arrived yet.');
   if(!approving&&!one('SELECT 1 FROM news_checks WHERE news_id=? AND player_id=?',b.id,player.id))fail(409,'Open the city record and save your fact-check before proposing this story.');
  }
  if(b.op==='publish'&&!approving){
   if(game().peer_council&&(String(b.body||'').length<80||!/(join|visit|register|book)/i.test(b.body||'')||!Array.isArray(b.assets)||!b.assets.length))fail(400,'Complete the festival brief: at least 80 characters, a call to action and one visual asset.');
   const people=one('SELECT COUNT(*) AS n FROM players WHERE village_id=? AND verified=1',player.village_id).n;
   if(people>1&&!all('SELECT c.* FROM campaign_checks c JOIN players p ON p.id=c.player_id WHERE p.village_id=? AND c.version=? AND c.player_id<>? AND c.digest=?',player.village_id,b.version,player.id,digest(b)).length)fail(409,'Ask a teammate to complete the campaign checklist before submitting this version.');
  }
 }
 function tasks(type){
  const standardRoles=['events','finance','digital','media','digital','events','events','mayor','events','finance','digital','media','events','finance','mayor','digital'];
  const criticalRoles=['digital','events','digital','events','events','finance','mayor','digital'];
  const standard=['Book an accessible venue','Confirm festival funding','Prepare Wi-Fi access','Publish the programme','Check the sound system','Arrange first aid','Map accessible routes','Brief the volunteers','Prepare recycling points','Confirm local suppliers','Test the registration desk','Prepare translation support','Check weather cover','Confirm transport','Prepare the welcome desk','Check emergency exits'];
  const critical=['Water pipe failure','Keynote speaker cancelled','Wi-Fi outage at the venue','Storm warning: secure equipment','Medical station unavailable','Supplier cancels delivery','Unsafe entrance reported','Power failure at the stage'];
  for(const v of all('SELECT id FROM villages')){
   const n=one('SELECT COUNT(*) AS n FROM players WHERE village_id=? AND verified=1',v.id).n;if(!n)continue;
   const total=Math.ceil(n*3*1.25/4)*4,red=Math.ceil(total*.25),count=type==='red'?red:total-red;
   for(let i=0;i<count;i++){
    const name=(type==='red'?critical:standard)[i%(type==='red'?critical.length:standard.length)];
    run('INSERT OR IGNORE INTO tasks(id,village_id,title,type,required_role,minutes,description) VALUES(?,?,?,?,?,?,?)',`${v.id}-${type}-hour-${i}`,v.id,`${name}${i>=standard.length?' · zone '+(i+1):''}`,type,(type==='red'?criticalRoles:standardRoles)[i%(type==='red'?criticalRoles.length:standardRoles.length)],type==='red'?1.5:1,'Owner: complete the preparation steps. A different teammate must check the result before this ticket can finish.');
   }
  }
 }
 function taskStep(player,b){
  const g=game();if(g.phase!=='playing'||g.round!==4)fail(409,'Resume the festival round first.');
  const task=one('SELECT * FROM tasks WHERE id=? AND village_id=?',b.id,player.village_id);
  if(!task||task.done||task.cancelled||!task.assigned_to)fail(409,'This ticket is not available.');
  if(task.type==='red'&&one('SELECT status FROM crisis_controls WHERE kind=?','festival')?.status==='paused')fail(409,'The festival crisis is paused.');
  const owner=task.assigned_to===player.id,kind=b.op==='workTask'?'work':'check';
  if((kind==='work')!==owner)fail(409,kind==='work'?'Only the owner can complete preparation steps.':'A different teammate must check this ticket.');
  if(kind==='check'&&!one("SELECT 1 FROM task_collaboration WHERE task_id=? AND kind='work' AND player_id=?",task.id,task.assigned_to))fail(409,'Wait for the owner to prepare the ticket before checking it.');
  const prior=one('SELECT at FROM task_collaboration WHERE task_id=? AND player_id=? AND kind=?',task.id,player.id,kind);
  if(prior&&now()-prior.at<10000)fail(429,'Wait ten seconds before the next step.');
  run('INSERT INTO task_collaboration VALUES(?,?,?,?) ON CONFLICT(task_id,player_id,kind) DO UPDATE SET at=excluded.at',task.id,player.id,kind,now());
  const checked=!!one("SELECT 1 FROM task_collaboration WHERE task_id=? AND kind='check' AND player_id<>?",task.id,task.assigned_to);
  const worked=!!one("SELECT 1 FROM task_collaboration WHERE task_id=? AND kind='work'",task.id);
  const progress=Math.max(task.progress,Math.min(checked&&worked?100:80,task.progress+(owner?20:25)));
  run('UPDATE tasks SET progress=?,done=? WHERE id=?',progress,progress>=100&&checked&&worked?1:0,task.id);
  log(4,player.village_id,owner?'work':'help',`${player.name} ${owner?'prepared':'checked'} ${task.title}`,`${player.id}:${task.id}`);
  return {ok:true,message:owner?'Preparation step saved. Ask a teammate to check the ticket.':'Teammate check saved. Continue working together.'};
 }
 function state(player,admin){
  const g=game();const teams=all('SELECT village_id,COUNT(*) AS total FROM players WHERE verified=1 GROUP BY village_id').map(v=>{
   const members=all('SELECT p.id,p.name,COALESCE(r.ready,0) AS ready FROM players p LEFT JOIN round_ready r ON r.player_id=p.id AND r.round=? WHERE p.village_id=? AND p.verified=1',g.round,v.village_id);
   const pending=one("SELECT COUNT(*) AS n FROM council_proposals WHERE village_id=? AND round=? AND status='pending'",v.village_id,g.round).n;
   return {villageId:v.village_id,total:v.total,ready:members.filter(p=>p.ready).length,complete:members.every(p=>p.ready)&&!pending,members,pending};
  });
  return {projectNotes:all('SELECT n.*,p.name,p.role,p.village_id FROM project_notes n JOIN players p ON p.id=n.player_id').filter(n=>admin||n.village_id===player?.village_id),teams,allReady:teams.length>0&&teams.every(t=>t.complete),myReady:!!(player&&one('SELECT ready FROM round_ready WHERE player_id=? AND round=?',player.id,g.round)?.ready),actingMayors:all('SELECT * FROM acting_mayors'),canApprove:!!player&&canApprove(player),investmentUnlocks:investments.map((i,index)=>({id:i.id,atMs:index*60000})),newsSchedule:admin||g.round>=2?all('SELECT id FROM news').map(n=>({id:n.id,atMs:newsRelease(n.id)})):[],newsChecks:player?all('SELECT * FROM news_checks WHERE player_id=?',player.id):[],campaignChecks:all('SELECT c.player_id,c.version,c.note,c.digest,p.name,p.village_id FROM campaign_checks c JOIN players p ON p.id=c.player_id').filter(c=>admin||c.village_id===player?.village_id),campaignDrafts:all('SELECT * FROM campaign_drafts').filter(d=>admin||d.village_id===player?.village_id).map(d=>({...d,payload:JSON.parse(d.payload)})),taskBonuses:all('SELECT b.*,t.village_id FROM task_bonus b JOIN tasks t ON t.id=b.task_id').filter(b=>admin||b.village_id===player?.village_id),taskChallenges:all('SELECT * FROM tasks').filter(t=>admin||t.village_id===player?.village_id).map(t=>{const {answer,...challenge}=ticketChallenge(t);return {id:t.id,...challenge};}),taskChecks:admin?all('SELECT * FROM task_collaboration'):all('SELECT c.* FROM task_collaboration c JOIN tasks t ON t.id=c.task_id WHERE t.village_id=?',player?.village_id||'')};
 }
 function action(a,b){
  const g=game(),p=a?.player;if(!enabled())fail(409,'Start a new one-hour workshop to use this feature.');
  if(['ended','waiting'].includes(g.phase))fail(409,'Open a round first.');
  if(b.op==='delegateMayor'){
   if(!a?.admin&&(!p||!canApprove(p)))fail(403,'Only the current decision lead or host can appoint a deputy.');
   const v=a.admin?b.village:p.village_id;
   if(!a.admin&&b.village&&b.village!==v)fail(403,'Choose your own village.');
   if(b.id){const target=one('SELECT * FROM players WHERE id=? AND village_id=? AND verified=1',b.id,v);if(!target)fail(400,'Choose a signed-in teammate.');run('INSERT INTO acting_mayors VALUES(?,?) ON CONFLICT(village_id) DO UPDATE SET player_id=excluded.player_id',v,target.id);}
   else {if(!a.admin)fail(403,'Ask the host to restore the original mayor.');run('DELETE FROM acting_mayors WHERE village_id=?',v);}
   log(g.round,v,'council','Decision lead changed',a.admin?'Host appointed or restored the decision lead.':`${p.name} delegated decision approval.`);return {ok:true};
  }
  if(!p)fail(401,'Sign in as a player.');
  if(g.phase!=='playing')fail(409,'Wait for the host to resume.');
  if(b.op==='assessProject'){if(g.round!==1||!availableInvestment(b.id)||!investments.some(i=>i.id===b.id))fail(409,'Research an available project in round one.');const note=String(b.note||'').trim();if(note.length<15||note.length>300)fail(400,'Give a concrete recommendation (15–300 characters).');run('INSERT INTO project_notes VALUES(?,?,?) ON CONFLICT(player_id,asset_id) DO UPDATE SET note=excluded.note',p.id,b.id,note);return {ok:true,message:'Research shared with your team. It does not spend money.'};}
  if(b.op==='roundReady'){
   if(typeof b.ready!=='boolean')fail(400,'Choose ready or not ready.');
   run('INSERT INTO round_ready VALUES(?,?,?) ON CONFLICT(player_id) DO UPDATE SET round=excluded.round,ready=excluded.ready',p.id,g.round,b.ready?1:0);return {ok:true};
  }
  if(b.op==='checkNews'){
   if(g.round!==2||g.news_revealed||!availableNews(b.id)||!one('SELECT 1 FROM news WHERE id=?',b.id))fail(409,'Open an available story in round two.');
   const note=String(b.note||'').trim();if(note.length<15||note.length>400)fail(400,'Explain which city fact you checked (15–400 characters).');
   run('INSERT INTO news_checks VALUES(?,?,?) ON CONFLICT(player_id,news_id) DO UPDATE SET note=excluded.note',p.id,b.id,note);return {ok:true};
  }
  if(b.op==='shareCampaign'){
   if(g.round!==3||g.media_revealed||typeof b.title!=='string'||b.title.trim().length<5||b.title.length>100||typeof b.body!=='string'||b.body.length<20||b.body.length>1200||String(b.credits||'').length>300||!Array.isArray(b.assets)||b.assets.length>5||b.assets.some(id=>typeof id!=='string'))fail(400,'Share a valid draft with title, text and up to five assets.');
   const version=one('SELECT updated_at FROM posts WHERE village_id=?',p.village_id)?.updated_at||0;if(Number(b.version)!==version)fail(409,'Load the current campaign version before sharing.');
   const currentDraft=one('SELECT digest FROM campaign_drafts WHERE village_id=?',p.village_id);if((g.peer_council||Object.hasOwn(b,'baseDigest'))&&b.baseDigest!==(currentDraft?.digest||''))fail(409,'A teammate changed the shared draft. Your local work is preserved; load the latest shared draft before replacing it.');
   run('DELETE FROM round_ready WHERE player_id IN (SELECT id FROM players WHERE village_id=?)',p.village_id);
   let layout;try{layout=normaliseLayout(b.layout);}catch(e){fail(400,e.message);}const payload={title:b.title,body:b.body,credits:b.credits||'',assets:b.assets,version,layout};run('INSERT INTO campaign_drafts VALUES(?,?,?,?) ON CONFLICT(village_id) DO UPDATE SET author_id=excluded.author_id,payload=excluded.payload,digest=excluded.digest',p.village_id,p.id,JSON.stringify(payload),digest(payload));return {ok:true,digest:digest(payload),message:'Draft shared with your council. Ask a different teammate to review it.'};
  }
  if(b.op==='checkCampaign'){
   if(g.round!==3||g.media_revealed)fail(409,'Campaign review is closed.');const version=one('SELECT updated_at FROM posts WHERE village_id=?',p.village_id)?.updated_at||0;
   const note=String(b.note||'').trim();if(note.length<15||note.length>400||Number(b.version)!==version)fail(400,'Review the current version and describe your checks (15–400 characters).');
   const draft=one('SELECT * FROM campaign_drafts WHERE village_id=?',p.village_id);if(!draft||draft.author_id===p.id||b.digest!==draft.digest||JSON.parse(draft.payload).version!==version)fail(409,'A different teammate must review the current shared draft.');
   run('INSERT INTO campaign_checks VALUES(?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET version=excluded.version,note=excluded.note,digest=excluded.digest',p.id,version,note,draft.digest);return {ok:true};
  }
  if(b.op==='solveTask'){
   const task=one('SELECT * FROM tasks WHERE id=? AND village_id=?',b.id,p.village_id);
   if(g.round!==4||!task||task.done||task.cancelled||task.assigned_to!==p.id)fail(409,'Solve an active ticket you own.');
   if(task.type==='red'&&one('SELECT status FROM crisis_controls WHERE kind=?','festival')?.status==='paused')fail(409,'The festival crisis is paused.');
   if(one('SELECT 1 FROM task_bonus WHERE task_id=?',task.id))return {ok:true,message:'The 20% bonus has already been applied.'};
   if(b.answer!==ticketChallenge(task).answer)fail(400,'Try again. No penalty: choose the safe preparation order.');
   run('INSERT INTO task_bonus VALUES(?,?,?)',task.id,p.id,now());run('UPDATE tasks SET progress=progress+(100-progress)*.2 WHERE id=?',task.id);
   run('DELETE FROM round_ready WHERE player_id=?',p.id);log(4,p.village_id,'bonus',p.name+' solved '+task.title,'20% of remaining work saved; preparation and peer check still required.');
   return {ok:true,message:'Challenge complete: 20% of remaining work saved. Preparation and peer review are still required.'};
  }
  if(['workTask','helpTask'].includes(b.op)){run('DELETE FROM round_ready WHERE player_id=?',p.id);return taskStep(p,b);}
  fail(400,'Unknown workshop action.');
 }
 return {enabled,duration,trigger,canApprove,availableInvestment,availableNews,beforeDecision,tasks,state,action};
}

export function ticketChallenge(task){
 const variants=[['Restore Wi-Fi: choose the safe order.','Check power > connect router > test guest access','Test access > disconnect router > check power','Connect router > announce success > check power'],['Prepare the venue: choose the safe order.','Clear exits > place equipment > safety check','Place equipment > block exits > safety check','Open doors > place equipment > check exits'],['Find the missing detail: Youth Festival, Saturday, music and making. Join us!','Meeting time and address','A bigger logo','More colours'],['Restore stage power: choose the safe order.','Isolate faulty equipment > qualified technician > test','Restart repeatedly > open stage > ask technician','Open stage > inspect cables > test']];
 const seed=[...task.id].reduce((a,c)=>a+c.charCodeAt(0),0),index=/Wi-Fi|registration/i.test(task.title)?0:/power|sound/i.test(task.title)?3:/programme|translation/i.test(task.title)?2:1,v=variants[index],choices=v.slice(1).map((label,i)=>({id:String(i),label})),offset=seed%3;
 return {prompt:v[0],choices:[...choices.slice(offset),...choices.slice(0,offset)],answer:'0'};
}
