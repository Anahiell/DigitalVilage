import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';

// One local worker pool, one SQLite database. Payloads (including PINs) never enter the audit log.
export function createMailQueue({db,secret,mailer,record=()=>{},eligible=()=>true,onAccepted=()=>{},onFailed=()=>{},onActive=()=>{},onIdle=()=>{},onError=()=>{},now=Date.now,maxAge=15*60000,concurrency=4}){
 if(typeof secret!=='string'||secret.length<20)throw Error('A strong persistent secret is required for the mail queue.');
 const key=createHash('sha256').update('digital-village/mail-queue/v1\0'+secret).digest(),running=new Map();let closed=false,backgroundRunning=0;
 const configFor=kind=>mailer.configFor?.(kind)||mailer.config;
 db.exec(`CREATE TABLE IF NOT EXISTS mail_jobs (
  id TEXT PRIMARY KEY,player_id TEXT,pin_lookup TEXT UNIQUE,kind TEXT NOT NULL,payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,next_at INTEGER NOT NULL,
  cycles INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0
 );
 CREATE UNIQUE INDEX IF NOT EXISTS one_pending_pin_per_player ON mail_jobs(player_id) WHERE kind='pin';`);
 const one=id=>db.prepare('SELECT * FROM mail_jobs WHERE id=?').get(id);
 const atomic=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
 function encrypt(id,value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(id));const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');}
 function decrypt(job){const data=Buffer.from(job.payload,'base64'),cipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));cipher.setAAD(Buffer.from(job.id));cipher.setAuthTag(data.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8'));}
 function audit(job,payload,status,code='',attempts=job.attempts){record({id:job.id,to:payload?.message.to||'',kind:job.kind,status,provider:configFor(job.kind).mode,attempts,code,at:job.created_at});}
 function finish(job,payload,status,code){
  atomic(()=>{if(status==='accepted')onAccepted(payload.context);else {onFailed(payload?.context||{action:'registration',playerId:job.player_id,expectedLookup:job.pin_lookup},code);audit(job,payload,status,code);}db.prepare('DELETE FROM mail_jobs WHERE id=?').run(job.id);});
  return {status,code};
 }
 function enqueue(message,context={}){
  const id=randomUUID(),createdAt=now(),payload={message:{...message,id},context,real:configFor(message.kind||'pin').real};
  db.prepare('INSERT INTO mail_jobs(id,player_id,pin_lookup,kind,payload,created_at,expires_at,next_at) VALUES(?,?,?,?,?,?,?,?)').run(id,context.playerId||null,context.pinLookup||null,message.kind||'pin',encrypt(id,payload),createdAt,createdAt+(message.kind==='report'?7*86400000:maxAge),createdAt);
  audit(one(id),payload,'queued');return id;
 }
 function process(id){
  if(running.has(id))return running.get(id);
  const job=one(id);if(!job)return Promise.resolve({status:'finished'});
  if(closed||running.size>=concurrency||(job.next_at>now()&&job.expires_at>now()))return Promise.resolve({status:'queued'});
  if(job.kind!=='pin'&&backgroundRunning>=Math.max(1,concurrency-1))return Promise.resolve({status:'queued'});
  if(job.kind!=='pin')backgroundRunning++;
  onActive(job);
  const work=Promise.resolve().then(async()=>{
   let payload;try{payload=decrypt(job);}catch{ return finish(job,null,'failed','queue_key_or_payload_invalid'); }
   if(job.expires_at<=now())return finish(job,payload,'expired','queue_expired');
   if(!eligible(payload.context))return finish(job,payload,'cancelled','request_superseded');
   const result=payload.real&&!configFor(job.kind).real?{ok:false,retryable:true,code:'sender_unavailable',attempts:job.attempts}:await mailer.sendDetailed({...payload.message,createdAt:job.created_at,attemptOffset:job.attempts});
   if(result.ok)return finish(job,payload,'accepted','');
   if(!result.retryable||(job.kind!=='report'&&job.cycles>=5)){job.attempts=result.attempts;return finish(job,payload,'failed',result.code);}
   const delay=[10000,30000,60000,120000,240000][Math.min(job.cycles,4)];
   db.prepare('UPDATE mail_jobs SET next_at=?,cycles=cycles+1,attempts=? WHERE id=?').run(now()+delay,result.attempts,id);
   audit(job,payload,'queued',result.code,result.attempts);return {status:'queued',code:result.code};
  }).catch(error=>{onError(error);return {status:'queued',code:'queue_processing_error'};}).finally(()=>{running.delete(id);if(job.kind!=='pin')backgroundRunning--;onIdle(job);});
  running.set(id,work);return work;
 }
 async function wait(id,timeout=12000){
  let timer;try{return await Promise.race([process(id),new Promise(resolve=>{timer=setTimeout(()=>resolve({status:'queued'}),timeout);timer.unref?.();})]);}finally{clearTimeout(timer);}
 }
 async function drain(){
  if(closed)return;
  const time=now(),jobs=db.prepare("SELECT id FROM mail_jobs WHERE next_at<=? OR expires_at<=? ORDER BY CASE WHEN expires_at<=? THEN 0 ELSE 1 END,CASE WHEN kind='pin' THEN 0 ELSE 1 END,created_at,id").all(time,time,time);
  await Promise.all(jobs.filter(job=>!running.has(job.id)).slice(0,Math.max(0,concurrency-running.size)).map(job=>process(job.id)));
 }
 function cancelPlayer(playerId){
  const jobs=db.prepare("SELECT * FROM mail_jobs WHERE player_id=? AND kind='pin'").all(playerId);
  if(jobs.some(job=>running.has(job.id)))throw Error('An email request is still being processed.');
  for(const job of jobs){let payload;try{payload=decrypt(job);}catch{}db.prepare('DELETE FROM mail_jobs WHERE id=?').run(job.id);audit(job,payload,'cancelled','host_recovery');}
 }
 return {enqueue,wait,drain,cancelPlayer,pendingPlayer:playerId=>!!db.prepare("SELECT 1 FROM mail_jobs WHERE player_id=? AND kind='pin'").get(playerId),close:()=>{closed=true;},get activeSession(){return [...running.keys()].some(id=>one(id)?.kind!=='report');},get active(){return running.size;}};
}
