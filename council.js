import {normaliseLayout} from './public/poster-model.js';
import {randomUUID} from 'node:crypto';

// Only the server calls this module. A player cannot supply an approval bypass.
export function createCouncil({db,getGame,sessionId,investments,assets,now,log,baseline,error,canApprove=player=>player.role==='mayor',beforeDecision=()=>{}}){
 db.exec(`CREATE TABLE IF NOT EXISTS council_proposals(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,village_id TEXT NOT NULL,round INTEGER NOT NULL,op TEXT NOT NULL,resource TEXT NOT NULL,payload TEXT NOT NULL,author_id TEXT NOT NULL,author_name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL,reviewer TEXT NOT NULL DEFAULT '',reviewed_at INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS council_votes(proposal_id TEXT NOT NULL,player_id TEXT NOT NULL,vote TEXT NOT NULL,PRIMARY KEY(proposal_id,player_id));
 CREATE UNIQUE INDEX IF NOT EXISTS council_pending_resource ON council_proposals(session_id,village_id,resource) WHERE status='pending';`);
 const one=(s,...a)=>db.prepare(s).get(...a),run=(s,...a)=>db.prepare(s).run(...a);
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}};
 const fail=(s,m)=>{throw error(s,m);};
 function expire(){const g=getGame();run("UPDATE council_proposals SET status='expired',reviewed_at=? WHERE status='pending' AND (session_id<>? OR round<>? OR ? IN ('review','ended'))",now(),sessionId(),g.round,g.phase);}
 function check(player,b,g,approving=false){
  if(g.phase!=='playing')fail(409,'The round is not running. The host must resume or open it.');
  const op=b.op;beforeDecision(player,b,approving);
  if(op==='invest'){
   if(g.round!==1)fail(409,'Investments belong to round one.');
   const item=investments.find(i=>i.id===b.id);if(!item)fail(400,'Unknown investment.');
   if(one('SELECT 1 FROM investments WHERE village_id=? AND investment_id=?',player.village_id,item.id))return {already:true};
   if(one('SELECT budget FROM villages WHERE id=?',player.village_id).budget<item.price)fail(409,'Not enough budget. Ask the host or choose another project.');
   return {op,id:item.id,resource:'investment:'+item.id,item};
  }
  if(['chooseNews','unchooseNews'].includes(op)){
   if(g.round!==2||g.news_revealed)fail(409,'News selection is closed.');
   const story=one('SELECT * FROM news WHERE id=?',String(b.id||''));if(!story||story.source_village===player.village_id)fail(400,'Choose news about another village.');
   const chosen=!!one('SELECT 1 FROM news_choices WHERE village_id=? AND news_id=?',player.village_id,story.id);
   if(chosen===(op==='chooseNews'))return {already:true};
   if(op==='chooseNews'&&one('SELECT COUNT(*) AS n FROM news_choices WHERE village_id=?',player.village_id).n>=6)fail(409,'Six stories are already selected. Propose removing one first.');
   return {op,id:story.id,resource:'news:'+story.id};
  }
  if(op==='licenseAsset'){
   const item=assets.find(a=>a.id===b.id);if(g.round!==3||g.media_revealed||!item?.licenceFee)fail(400,'No workshop contract is available for this asset.');
   if(one('SELECT 1 FROM campaign_licences WHERE village_id=? AND asset_id=?',player.village_id,item.id))return {already:true};
   if(one('SELECT budget FROM villages WHERE id=?',player.village_id).budget<item.licenceFee)fail(409,'Insufficient budget for this workshop contract.');
   return {op,id:item.id,resource:'licence:'+item.id,item};
  }
  if(op==='publish'){
   if(g.round!==3||g.media_revealed)fail(409,'Campaign editing is closed.');
   const title=String(b.title||'').trim(),body=String(b.body||'').trim(),credits=String(b.credits||'').trim();
   if(title.length<5||title.length>100||body.length<20||body.length>1200||credits.length>300)fail(400,'Use a title of 5–100 characters, text of 20–1200 characters and credits up to 300 characters.');
   if(!Array.isArray(b.assets)||b.assets.length>5||b.assets.some(id=>!assets.some(a=>a.id===id)))fail(400,'Choose up to five known assets.');
   const version=one('SELECT updated_at FROM posts WHERE village_id=?',player.village_id)?.updated_at||0;
   if(Number(b.version)!==version)fail(409,'The published campaign changed. Keep your draft and load the latest version before proposing again.');
   let layout;try{layout=normaliseLayout(b.layout);}catch(e){fail(400,e.message);}return {op,title,body,credits,assets:[...new Set(b.assets)],version,layout,resource:'campaign'};
  }
  fail(400,'Unknown council action.');
 }
 function apply(player,p){
  if(p.op==='invest'){
   const i=p.item,e=i.effects;run('UPDATE villages SET budget=budget-?,internet=MIN(100,internet+?),education=MIN(100,education+?),services=MIN(100,services+?),jobs=MIN(100,jobs+?),trust=MIN(100,trust+?) WHERE id=?',i.price,e.internet||0,e.education||0,e.services||0,e.jobs||0,e.trust||0,player.village_id);
   run('INSERT INTO investments VALUES(?,?,?)',player.village_id,i.id,now());log(getGame().round,player.village_id,'investment',i.name,`${player.name} confirmed the council proposal. Cost €${i.price}.`);baseline(getGame().round);
  }else if(p.op==='licenseAsset'){run('UPDATE villages SET budget=budget-? WHERE id=?',p.item.licenceFee,player.village_id);run('INSERT INTO campaign_licences VALUES(?,?,?)',player.village_id,p.id,p.item.licenceFee);log(3,player.village_id,'media','Workshop asset contract purchased',p.item.label);
  }else if(p.op==='chooseNews')run('INSERT INTO news_choices VALUES(?,?)',player.village_id,p.id);
  else if(p.op==='unchooseNews')run('DELETE FROM news_choices WHERE village_id=? AND news_id=?',player.village_id,p.id);
  else if(p.op==='publish')run('INSERT INTO posts(village_id,title,body,asset_ids,updated_at,credits,layout) VALUES(?,?,?,?,?,?,?) ON CONFLICT(village_id) DO UPDATE SET title=excluded.title,body=excluded.body,asset_ids=excluded.asset_ids,updated_at=excluded.updated_at,credits=excluded.credits,layout=excluded.layout',player.village_id,p.title,p.body,JSON.stringify(p.assets),Math.max(now(),p.version+1),p.credits,JSON.stringify(p.layout||{}));
 }
 function handle(player,b){expire();return transaction(()=>{
  const g=getGame();
  if(['approveProposal','rejectProposal'].includes(b.op)){
   if(!g.peer_council&&!canApprove(player))fail(403,'Only your village mayor can approve or reject proposals.');
   const proposal=one('SELECT * FROM council_proposals WHERE id=? AND session_id=? AND village_id=?',String(b.id||''),sessionId(),player.village_id);if(!proposal)fail(404,'Proposal not found in your village.');
   if(proposal.status!=='pending')return {ok:true,status:proposal.status,proposalId:proposal.id,message:'This proposal was already '+proposal.status+'.'};
   if(g.phase!=='playing'||g.round!==proposal.round)fail(409,'Wait for the host to resume. Closed-round proposals cannot be applied.');
   if(g.peer_council){
    const members=one('SELECT COUNT(*) AS n FROM players WHERE village_id=? AND verified=1',player.village_id).n;
    if(proposal.author_id===player.id&&members>1)fail(403,'Another teammate must review your proposal.');
    run('INSERT INTO council_votes VALUES(?,?,?) ON CONFLICT(proposal_id,player_id) DO UPDATE SET vote=excluded.vote',proposal.id,player.id,b.op==='approveProposal'?'yes':'no');
    const votes=db.prepare('SELECT * FROM council_votes WHERE proposal_id=?').all(proposal.id),yes=1+votes.filter(v=>v.vote==='yes'&&v.player_id!==proposal.author_id).length,no=votes.filter(v=>v.vote==='no').length,needed=no?Math.floor(members/2)+1:Math.min(2,members);
    if(no<Math.floor(members/2)+1&&yes<needed)return {ok:true,status:'pending',proposalId:proposal.id,message:`Discussion open: ${yes} support, ${no} object. A strict majority resolves a disputed decision. Ask the host if participants are unavailable.`};
    b={...b,op:no>=Math.floor(members/2)+1?'rejectProposal':'approveProposal'};
   }
   if(b.op==='approveProposal'){const prepared=check(player,JSON.parse(proposal.payload),g,true);if(!prepared.already)apply(player,prepared);}
   const status=b.op==='approveProposal'?'approved':'rejected';run('UPDATE council_proposals SET status=?,reviewer=?,reviewed_at=? WHERE id=?',status,player.name,now(),proposal.id);
   log(g.round,player.village_id,'council',`Council proposal ${status}`,`${player.name} ${status} ${proposal.op} proposed by ${proposal.author_name}.`);
   return {ok:true,status,proposalId:proposal.id,message:status==='approved'?'Approved and applied to your village.':'Proposal rejected. No village resources were changed.'};
  }
  const p=check(player,b,g);if(p.already)return {ok:true,status:'already_applied',message:'Your village has already completed this action.'};
  const previous=one("SELECT * FROM council_proposals WHERE session_id=? AND village_id=? AND resource=? AND status='pending'",sessionId(),player.village_id,p.resource);
  if(previous){const payload=JSON.parse(previous.payload);if(payload.op!==p.op||p.op==='publish'&&JSON.stringify(payload)!==JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k])=>!['resource','item'].includes(k)))))fail(409,'A different proposal for this item is waiting for the mayor. Review it first.');return {ok:true,status:'pending',proposalId:previous.id,message:'Already awaiting your mayor’s approval. No duplicate action was created.'};}
  const payload=Object.fromEntries(Object.entries(p).filter(([k])=>!['resource','item'].includes(k))),id=randomUUID();
  run('INSERT INTO council_proposals(id,session_id,village_id,round,op,resource,payload,author_id,author_name,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,sessionId(),player.village_id,g.round,p.op,p.resource,JSON.stringify(payload),player.id,player.name,now());
  run('DELETE FROM round_ready WHERE player_id IN (SELECT id FROM players WHERE village_id=?)',player.village_id);
  return {ok:true,status:'pending',proposalId:id,message:getGame().peer_council?'Proposal shared. Any other teammate can confirm it.':'Sent to your mayor. Your village changes only after approval.'};
 });}
 function list(player,admin=false){expire();return db.prepare('SELECT * FROM council_proposals WHERE session_id=?'+(admin?'':' AND village_id=?')+' ORDER BY created_at DESC LIMIT 100').all(...(admin?[sessionId()]:[sessionId(),player.village_id])).map(p=>({...p,payload:JSON.parse(p.payload),votes:db.prepare('SELECT player_id,vote FROM council_votes WHERE proposal_id=?').all(p.id)}));}
 function resolve(id,status){return transaction(()=>{
  const g=getGame(),p=one("SELECT * FROM council_proposals WHERE id=? AND session_id=?",String(id||''),sessionId());
  if(!g.peer_council||g.phase!=='playing'||!p||p.round!==g.round||!['approved','rejected'].includes(status))fail(409,'Choose a pending decision in the active peer council round.');
  if(p.status!=='pending')return {ok:true,status:p.status};
  if(status==='approved'){const author=one('SELECT * FROM players WHERE id=?',p.author_id);const checked=check(author,JSON.parse(p.payload),g,true);if(!checked.already)apply(author,checked);}
  run('UPDATE council_proposals SET status=?,reviewer=?,reviewed_at=? WHERE id=?',status,'Host moderation',now(),p.id);log(g.round,p.village_id,'council','Host resolved council decision',status);return {ok:true,status};
 });}
 return {handle,list,resolve};
}
