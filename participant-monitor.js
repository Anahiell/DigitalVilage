import {createHash,createHmac} from 'node:crypto';

export function createParticipantMonitor({db,secret,sessionId,now=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS participant_ready(player_id TEXT PRIMARY KEY,ready INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS exercise_tracking(player_id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,job_id TEXT,last_sent_at INTEGER NOT NULL DEFAULT 0,send_count INTEGER NOT NULL DEFAULT 0,first_opened_at INTEGER,last_opened_at INTEGER,open_count INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS exercise_open_events(event_id TEXT PRIMARY KEY,player_id TEXT NOT NULL,at INTEGER NOT NULL);`);
 const one=(sql,...args)=>db.prepare(sql).get(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const error=(status,message)=>Object.assign(Error(message),{status});
 function tokenFor(playerId){return createHmac('sha256',secret).update('exercise-link/v1\0'+sessionId()+'\0'+playerId).digest('hex');}
 function linkToken(playerId){
  const token=tokenFor(playerId);
  run('INSERT OR IGNORE INTO exercise_tracking(player_id,token_hash) VALUES(?,?)',playerId,hash(token));return token;
 }
 function sent(playerId,jobId){run('UPDATE exercise_tracking SET job_id=?,last_sent_at=?,send_count=send_count+1 WHERE player_id=?',jobId,now(),playerId);}
 function canResend(playerId){
  const saved=one('SELECT * FROM exercise_tracking WHERE player_id=?',playerId);
  if(saved&&one('SELECT 1 FROM mail_jobs WHERE id=?',saved.job_id))throw error(409,'This exercise email is still queued or sending.');
  if(saved&&saved.last_sent_at+90000>now())throw error(429,'Wait 90 seconds between exercise email requests.');
 }
 function opened(token,eventId){
  if(typeof token!=='string'||typeof eventId!=='string'||!/^[a-f0-9]{64}$/.test(token)||!/^[a-f0-9-]{36}$/.test(eventId))return false;
  const player=one('SELECT t.player_id FROM exercise_tracking t JOIN players p ON p.id=t.player_id WHERE token_hash=?',hash(token));if(!player)return false;
  const recorded=run('INSERT OR IGNORE INTO exercise_open_events VALUES(?,?,?)',eventId,player.player_id,now());
  if(recorded.changes)run('UPDATE exercise_tracking SET first_opened_at=COALESCE(first_opened_at,?),last_opened_at=?,open_count=open_count+1 WHERE player_id=?',now(),now(),player.player_id);
  return true;
 }
 function setReady(playerId,value){if(typeof value!=='boolean')throw error(400,'Ready must be true or false.');run('INSERT INTO participant_ready VALUES(?,?,?) ON CONFLICT(player_id) DO UPDATE SET ready=excluded.ready,updated_at=excluded.updated_at',playerId,value?1:0,now());}
 function isReady(playerId){return !!one('SELECT ready FROM participant_ready WHERE player_id=?',playerId)?.ready;}
 function participants(){
  return db.prepare(`SELECT p.id,p.name,p.email,p.village_id,p.role,p.verified,p.last_seen,
   COALESCE(r.ready,0) AS ready,t.first_opened_at,t.last_opened_at,COALESCE(t.open_count,0) AS open_count,
   COALESCE(t.send_count,0) AS send_count,t.last_sent_at,d.status AS delivery_status,d.error_code,
   EXISTS(SELECT 1 FROM sessions s WHERE s.player_id=p.id AND s.admin=0 AND s.expires_at>?) AS signed_in,
   EXISTS(SELECT 1 FROM mail_jobs j WHERE j.id=t.job_id) AS pending
   FROM players p LEFT JOIN participant_ready r ON r.player_id=p.id LEFT JOIN exercise_tracking t ON t.player_id=p.id
   LEFT JOIN mail_deliveries d ON d.id=t.job_id ORDER BY p.village_id,p.name,p.id`).all(now()).map(p=>({...p,ready:!!p.ready,signedIn:!!p.signed_in,online:!!p.signed_in&&p.last_seen>now()-35000,canResend:!p.pending&&(!p.last_sent_at||p.last_sent_at+90000<=now())}));
 }
 return {linkToken,sent,canResend,opened,setReady,isReady,participants};
}
