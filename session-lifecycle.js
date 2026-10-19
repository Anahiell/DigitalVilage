import {randomBytes,createHash} from 'node:crypto';

// These archives deliberately have no foreign keys to disposable player accounts.
export function createSessionLifecycle({db,enqueue,now=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS session_lifecycle(id INTEGER PRIMARY KEY CHECK(id=1),session_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS final_sessions(id TEXT PRIMARY KEY,created_at INTEGER NOT NULL,data TEXT NOT NULL,reset_at INTEGER);
 CREATE TABLE IF NOT EXISTS final_players(session_id TEXT NOT NULL,player_id TEXT NOT NULL,data TEXT NOT NULL,ack_at INTEGER,PRIMARY KEY(session_id,player_id));
 CREATE TABLE IF NOT EXISTS report_access(token_hash TEXT PRIMARY KEY,session_id TEXT NOT NULL,player_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS report_sessions(token_hash TEXT PRIMARY KEY,session_id TEXT NOT NULL,player_id TEXT NOT NULL);`);
 const run=(sql,...args)=>db.prepare(sql).run(...args),one=(sql,...args)=>db.prepare(sql).get(...args);
 const hash=value=>createHash('sha256').update(value).digest('hex');
 if(!one('SELECT 1 FROM session_lifecycle'))run('INSERT INTO session_lifecycle VALUES(1,?)',randomBytes(16).toString('hex'));
 const sessionId=()=>one('SELECT session_id FROM session_lifecycle').session_id;
 function finalize(){
  const id=sessionId();if(one('SELECT 1 FROM final_sessions WHERE id=?',id))return id;
  const rounds=db.prepare('SELECT data FROM round_reports ORDER BY round').all().map(r=>JSON.parse(r.data));
  const report={sessionId:id,closedAt:now(),rounds};
  run('INSERT INTO final_sessions VALUES(?,?,?,NULL)',id,now(),JSON.stringify(report));
  for(const p of db.prepare('SELECT * FROM players').all()){
   const personal={...report,player:{id:p.id,name:p.name,villageId:p.village_id,role:p.role}};
   run('INSERT INTO final_players VALUES(?,?,?,NULL)',id,p.id,JSON.stringify(personal));
   const token=randomBytes(32).toString('hex');run('INSERT INTO report_access VALUES(?,?,?)',hash(token),id,p.id);
   const summary=rounds.map(r=>{const v=r.villages.find(v=>v.id===p.village_id);return v?`Round ${r.round}: ${v.name}\n${v.story}\nCouncil: ${v.team.map(p=>`${p.name} (${p.position})`).join(', ')}\nResults: ${JSON.stringify(v.stats)}`:'';}).join('\n\n');
   enqueue({to:p.email,subject:'Your final Digital Village report',body:`Hello ${p.name},\nRole: ${p.role}\n\n${summary}\n\nPrivate saved report: ${(process.env.PUBLIC_BASE_URL||'').replace(/\/$/,'')}/?report=${token}`,kind:'report'},{action:'report',sessionId:id});
  }
  saveAccess();return id;
 }
 function saveAccess(){run('INSERT OR IGNORE INTO report_sessions SELECT s.token_hash,?,s.player_id FROM sessions s JOIN final_players p ON p.player_id=s.player_id AND p.session_id=? WHERE s.admin=0',sessionId(),sessionId());}
 function read(playerId,tokenHash,token){
  const access=token?one('SELECT * FROM report_access WHERE token_hash=?',hash(token)):playerId?{session_id:sessionId(),player_id:playerId}:one('SELECT * FROM report_sessions WHERE token_hash=?',tokenHash);
  if(!access)return null;
  const saved=one('SELECT data,ack_at FROM final_players WHERE session_id=? AND player_id=?',access.session_id,access.player_id);
  return saved?{...JSON.parse(saved.data),acknowledged:!!saved.ack_at}:null;
 }
 function acknowledge(playerId){run('UPDATE final_players SET ack_at=COALESCE(ack_at,?) WHERE session_id=? AND player_id=?',now(),sessionId(),playerId);}
 function reset(expectedId){
  if(expectedId!==sessionId())throw Object.assign(Error('This session has already been reset or changed.'),{status:409});
  const saved=one('SELECT * FROM final_sessions WHERE id=?',expectedId);
  if(!saved||saved.reset_at)throw Object.assign(Error('Final reports must be saved before reset.'),{status:409});
  saveAccess();
  // Report jobs have no player_id, so deleting accounts cannot cancel delivery.
  run("DELETE FROM mail_jobs WHERE kind<>'report'");
  run("DELETE FROM mail_deliveries WHERE kind<>'report'");
  if(one("SELECT name FROM sqlite_master WHERE type='table' AND name='council_proposals'"))run('DELETE FROM council_proposals');
  for(const table of ['exercise_open_events','exercise_tracking','participant_ready','exercise_recipients','security_answers','round_reports','round_starts','crisis_losses','crisis_controls','news_choices','news_context','news_sources','news','posts','tasks','investments','snapshots','events','outbox'])run(`DELETE FROM ${table}`);
  run('DELETE FROM sessions WHERE admin=0');run('DELETE FROM players');
  run('UPDATE final_sessions SET reset_at=? WHERE id=? AND reset_at IS NULL',now(),expectedId);
  run('UPDATE session_lifecycle SET session_id=?',randomBytes(16).toString('hex'));
 }
 return {sessionId,finalize,read,acknowledge,reset};
}
