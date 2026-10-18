import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {existsSync, mkdirSync} from 'node:fs';
import {join, extname, resolve, dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, randomInt, scryptSync, createHash, timingSafeEqual} from 'node:crypto';
import {VILLAGES,ROLES,INVESTMENTS,ROUNDS,MEDIA_ASSETS,FESTIVAL_TASKS,SECURITY_QUESTIONS} from './data.js';
import {createMailer,mailConfiguration} from './mailer.js';
import {createMailQueue} from './mail-queue.js';
import {generateNews,buildRoundReport,campaignReview,buildWorkshopStories} from './game-content.js';
const ROOT=process.cwd(), HOST=process.env.HOST||'127.0.0.1',PORT=Number(process.env.PORT||3000);
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'', PIN_PEPPER=process.env.PIN_PEPPER||'';
if(!ADMIN_PASSWORD||ADMIN_PASSWORD.includes('CHANGE_ME')||ADMIN_PASSWORD.length<14) throw Error('Set ADMIN_PASSWORD with at least 14 characters in .env');
if(!PIN_PEPPER||PIN_PEPPER.includes('CHANGE_ME')||PIN_PEPPER.length<20) throw Error('Set PIN_PEPPER with at least 20 random characters in .env');
const DEV_MAIL=process.env.DEV_EMAIL_OUTBOX==='1';
const PIN_COOLDOWN_MS=90000, pinDeliveries=new Set();
const mailSettings=mailConfiguration();
const emailConfigured=()=>mailSettings.configured;
const ipBuckets=new Map();
function throttle(req,group,max,windowMs){
 const ip=String((process.env.TRUST_PROXY==='1'?req.headers['x-forwarded-for']:null)||req.socket.remoteAddress||'local').split(',')[0].trim();
 const key=group+':'+ip,now=at(),old=ipBuckets.get(key)||[];
 const recent=old.filter(t=>now-t<windowMs);if(recent.length>=max)throw httpError(429,'Too many requests. Please wait.');
 recent.push(now);ipBuckets.set(key,recent);
 if(ipBuckets.size>2000)for(const [k,v] of ipBuckets)if(v.every(t=>now-t>3600000))ipBuckets.delete(k);
}
const DB_PATH=process.env.DB_PATH||join(ROOT,'storage','village.db');
mkdirSync(dirname(DB_PATH),{recursive:true});
const db=new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS game (
 id INTEGER PRIMARY KEY CHECK(id=1), round INTEGER NOT NULL DEFAULT 0,
 phase TEXT NOT NULL DEFAULT 'waiting', started_at INTEGER NOT NULL DEFAULT 0,
 elapsed_ms INTEGER NOT NULL DEFAULT 0, last_sim_at INTEGER NOT NULL DEFAULT 0,
 crisis_fired INTEGER NOT NULL DEFAULT 0, tickets_fired INTEGER NOT NULL DEFAULT 0,
 news_revealed INTEGER NOT NULL DEFAULT 0, media_revealed INTEGER NOT NULL DEFAULT 0,
 festival_resolved INTEGER NOT NULL DEFAULT 0, security_sent INTEGER NOT NULL DEFAULT 0,
 last_dynamic_event_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS villages (
 id TEXT PRIMARY KEY,name TEXT NOT NULL,emoji TEXT NOT NULL,description TEXT NOT NULL,
 budget REAL NOT NULL,youth REAL NOT NULL,internet REAL NOT NULL,education REAL NOT NULL,
 services REAL NOT NULL,jobs REAL NOT NULL,trust REAL NOT NULL,base_youth REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
 id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,
 village_id TEXT NOT NULL REFERENCES villages(id),role TEXT NOT NULL,
 pin_hash TEXT NOT NULL,pin_lookup TEXT NOT NULL UNIQUE,verified INTEGER NOT NULL DEFAULT 0,
 consent_email INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0,
 pin_sent_at INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS unique_village_roles ON players(village_id,role);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY,player_id TEXT REFERENCES players(id),admin INTEGER NOT NULL DEFAULT 0,
 expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS investments (
 village_id TEXT NOT NULL REFERENCES villages(id),investment_id TEXT NOT NULL,
 purchased_at INTEGER NOT NULL,PRIMARY KEY(village_id,investment_id)
);
CREATE TABLE IF NOT EXISTS snapshots (
 id INTEGER PRIMARY KEY AUTOINCREMENT, village_id TEXT NOT NULL REFERENCES villages(id),
 at INTEGER NOT NULL,round INTEGER NOT NULL,budget REAL NOT NULL,youth REAL NOT NULL,trust REAL NOT NULL,
 internet REAL NOT NULL,services REAL NOT NULL,education REAL NOT NULL,jobs REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,round INTEGER NOT NULL,
 village_id TEXT,kind TEXT NOT NULL,title TEXT NOT NULL,details TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS news (
 id TEXT PRIMARY KEY,source_village TEXT NOT NULL,headline TEXT NOT NULL,body TEXT NOT NULL,
 authentic INTEGER NOT NULL,signer TEXT NOT NULL,seal TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS news_choices (
 village_id TEXT NOT NULL, news_id TEXT NOT NULL REFERENCES news(id),
 PRIMARY KEY(village_id,news_id)
);
CREATE TABLE IF NOT EXISTS posts (
 village_id TEXT PRIMARY KEY REFERENCES villages(id),title TEXT NOT NULL,body TEXT NOT NULL,
 asset_ids TEXT NOT NULL,updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
 id TEXT PRIMARY KEY,village_id TEXT NOT NULL REFERENCES villages(id),title TEXT NOT NULL,
 type TEXT NOT NULL,required_role TEXT NOT NULL,minutes REAL NOT NULL,description TEXT NOT NULL,
 assigned_to TEXT REFERENCES players(id),progress REAL NOT NULL DEFAULT 0,done INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS mail_deliveries (id TEXT PRIMARY KEY,email TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,provider TEXT NOT NULL,attempts INTEGER NOT NULL,error_code TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS round_starts (round INTEGER PRIMARY KEY,at INTEGER NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS round_reports (round INTEGER PRIMARY KEY,closed_at INTEGER NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS news_context (news_id TEXT PRIMARY KEY,explanation TEXT NOT NULL,as_of INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS news_sources (village_id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS crisis_losses (round INTEGER NOT NULL,village_id TEXT NOT NULL,amount INTEGER NOT NULL,PRIMARY KEY(round,village_id));
CREATE TABLE IF NOT EXISTS security_answers (player_id TEXT NOT NULL REFERENCES players(id),question_id TEXT NOT NULL,answer_id TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(player_id,question_id));
CREATE TABLE IF NOT EXISTS outbox (
 id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,at INTEGER NOT NULL
);
`);
if(!db.prepare('PRAGMA table_info(posts)').all().some(c=>c.name==='credits'))db.exec("ALTER TABLE posts ADD COLUMN credits TEXT NOT NULL DEFAULT ''");
const at=()=>Date.now(), sha=x=>createHash('sha256').update(x).digest('hex');
function tx(fn){db.exec('BEGIN IMMEDIATE');try{const a=fn();db.exec('COMMIT');return a;}catch(e){db.exec('ROLLBACK');throw e;}}
function row(q,...a){return db.prepare(q).get(...a);} function all(q,...a){return db.prepare(q).all(...a);} function run(q,...a){return db.prepare(q).run(...a);}
if(!row('SELECT id FROM game WHERE id=1')) tx(()=>{
 run('INSERT INTO game(id) VALUES (1)');
 for(const v of VILLAGES) run('INSERT INTO villages VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',v.id,v.name,v.emoji,v.description,v.budget,v.youth,v.internet,v.education,v.services,v.jobs,v.trust,v.youth);

});
const httpError=(status,message)=>Object.assign(new Error(message),{status});
const clean=s=>String(s??'').trim();
const EMAIL_PATTERN=/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
function hashPin(pin){const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(pin+PIN_PEPPER,salt,32).toString('hex')}`;}
function verifyPin(pin,stored){const [salt,hash]=(stored||'').split(':');if(!salt||!hash)return false;const expected=Buffer.from(hash,'hex'), actual=scryptSync(pin+PIN_PEPPER,salt,32);return expected.length===actual.length&&timingSafeEqual(expected,actual);}
function generatePin(){for(let i=0;i<30;i++){const pin=String(randomInt(100000,1000000)),fingerprint=sha(PIN_PEPPER+pin);if(!row('SELECT id FROM players WHERE pin_lookup=?',fingerprint)&&!row('SELECT id FROM mail_jobs WHERE pin_lookup=?',fingerprint)) return {pin,fingerprint};}throw httpError(503,'Could not generate PIN');}
function parseCookie(req){const raw=req.headers.cookie||'';const m=raw.match(/(?:^|;\s*)dv_session=([a-f0-9]{64})/);return m?.[1]||'';}
function auth(req){const t=parseCookie(req);if(!t)return null;const s=row('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?',sha(t),at());if(!s)return null;if(s.admin)return {admin:true};const player=row('SELECT id,name,email,village_id,role,verified,consent_email FROM players WHERE id=?',s.player_id);return player?{admin:false,player}:null;}
function cookie(token,req){const secure=(process.env.PUBLIC_BASE_URL||'').startsWith('https://')||(process.env.TRUST_PROXY==='1'&&req.headers['x-forwarded-proto']==='https')||req.socket.encrypted;return `dv_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Number(process.env.SESSION_DAYS||2)*86400}${secure?'; Secure':''}`;}
function startSession(res,req,playerId=null,admin=false){const token=randomBytes(32).toString('hex');run('INSERT INTO sessions VALUES(?,?,?,?)',sha(token),playerId,admin?1:0,at()+Number(process.env.SESSION_DAYS||2)*86400000);res.setHeader('Set-Cookie',cookie(token,req));}
function requirePlayer(a){if(!a||a.admin||!a.player)throw httpError(401,'Please sign in');return a.player;}
function requireAdmin(a){if(!a?.admin)throw httpError(403,'Host access required');}
function logEvent(round,villageId,kind,title,details='',timestamp=at()){run('INSERT INTO events(at,round,village_id,kind,title,details) VALUES(?,?,?,?,?,?)',timestamp,round,villageId,kind,title,details);}
function snapshot(v,round,ts){run('INSERT INTO snapshots(village_id,at,round,budget,youth,trust,internet,services,education,jobs) VALUES(?,?,?,?,?,?,?,?,?,?)',v.id,ts,round,v.budget,v.youth,v.trust,v.internet,v.services,v.education,v.jobs);}
function clamp(v,min=0,max=100){return Math.min(max,Math.max(min,v));}
function roundElapsed(g,now=at()){return g.phase==='playing'?Math.max(0,now-g.started_at):g.elapsed_ms;}
function getGame(){return row('SELECT * FROM game WHERE id=1');}
function recordBaseline(round){for(const v of all('SELECT * FROM villages'))snapshot(v,round,at());}
function addTasks(type){FESTIVAL_TASKS.filter(t=>t.type===type).forEach((t,i)=>{for(const v of VILLAGES){const id=`${v.id}-${type}-${i}`;run('INSERT OR IGNORE INTO tasks(id,village_id,title,type,required_role,minutes,description) VALUES (?,?,?,?,?,?,?)',id,v.id,t.title,t.type,t.role,t.minutes,t.description);}});}
const RANDOM_EVENTS=[
 {title:'A local investor backs rural startups',details:'New investment and job opportunities attract young residents.',budget:4400,jobs:3,youth:1,trust:1},
 {title:'Heavy rain damages broadband equipment',details:'Temporary repairs cost money and lower connectivity.',budget:-2200,internet:-7,trust:-1},
 {title:'Youth exchange programme opens',details:'Digital training brings new opportunities and young residents.',education:4,youth:3,trust:1},
 {title:'A small business moves away',details:'The local economy loses some jobs and young workers.',jobs:-4,youth:-2,trust:-2},
 {title:'Weekend visitors discover the village',details:'Tourism brings new revenue and interest in the village.',budget:3200,youth:2,trust:1},
 {title:'Volunteers revitalise a community space',details:'Community effort improves public services and trust.',services:4,trust:3}
];
function spontaneousEvent(g,now){
 const village=VILLAGES[randomInt(VILLAGES.length)];const event=RANDOM_EVENTS[randomInt(RANDOM_EVENTS.length)];
 const changes=['budget','youth','trust','internet','education','services','jobs'];
 const sets=changes.filter(k=>event[k]!==undefined).map(k=>{const min=k==='youth'?25:0,max=k==='budget'?100000000:k==='youth'?100000:100;return `${k}=MAX(${min},MIN(${max},${k}+${Number(event[k])}))`});
 run(`UPDATE villages SET ${sets.join(', ')} WHERE id=?`,village.id);
 logEvent(g.round,village.id,'random',event.title,event.details,now);
 run('UPDATE game SET last_dynamic_event_at=? WHERE id=1',now);
 snapshot(row('SELECT * FROM villages WHERE id=?',village.id),g.round,now);
}
function applyCrisis(g,timestamp=at()){
 for(const v of all('SELECT * FROM villages')){
  const cut=Math.round(v.budget*.30);
  run('UPDATE villages SET budget=MAX(0,budget-?) WHERE id=?',cut,v.id);
  run('INSERT OR IGNORE INTO crisis_losses VALUES(?,?,?)',g.round,v.id,cut);
  logEvent(g.round,v.id,'shock','Regional funding cut by 30%',`Budget reduced by €${cut.toLocaleString('en-US')}.`,timestamp);
  snapshot(row('SELECT * FROM villages WHERE id=?',v.id),g.round,timestamp);
 }
 run('UPDATE game SET crisis_fired=1 WHERE id=1');
}
function timedEvents(g,timestamp){
 const elapsed=Math.max(0,timestamp-g.started_at);
 if(g.round===1&&!g.crisis_fired&&elapsed>=600000){applyCrisis(g,timestamp);g.crisis_fired=1;}
 if(g.round===4&&!g.tickets_fired&&elapsed>=240000){
  addTasks('red');run('UPDATE game SET tickets_fired=1 WHERE id=1');g.tickets_fired=1;
  logEvent(4,null,'crisis','Emergency alerts: pipe failure and speaker cancellation','Critical tickets have arrived. Assign the right people to solve them.',timestamp);
 }
 if(g.round<=4&&timestamp-g.last_dynamic_event_at>=120000){spontaneousEvent(g,timestamp);g.last_dynamic_event_at=timestamp;}
}
function advanceWorld(){
 const current=getGame();if(current.phase!=='playing')return;
 const now=at(),deadline=current.started_at+ROUNDS[current.round-1].duration*1000,target=Math.min(now,deadline);
 const count=Math.max(0,Math.floor((target-current.last_sim_at)/10000));
 if(!count&&now<deadline&&!(current.round===1&&!current.crisis_fired&&target-current.started_at>=600000)&&!(current.round===4&&!current.tickets_fired&&target-current.started_at>=240000)&&!(current.round<=4&&target-current.last_dynamic_event_at>=120000))return;
 tx(()=>{
  const g=getGame();if(g.phase!=='playing')return;
  for(let step=0;step<count;step++){
   const timestamp=g.last_sim_at+(step+1)*10000;
   for(const v of all('SELECT * FROM villages')){
    const attractiveness=v.internet*.23+v.education*.24+v.services*.23+v.jobs*.30;
    const migration=clamp((attractiveness-50)*.006+(v.trust-50)*.003,-.32,.32);
    const operating=155+v.internet*.92+v.education*.75+v.services*1.05+v.jobs*.45;
    const revenue=80+v.youth*.56+v.jobs*2.4+v.trust*.45;
    const budget=Math.max(0,v.budget+revenue-operating),youth=Math.max(25,v.youth+migration-(budget===0?.15:0));
    const trust=clamp(v.trust+(v.services>55?.035:-.025)+(budget===0?-.08:0));
    run('UPDATE villages SET budget=?,youth=?,trust=? WHERE id=?',budget,youth,trust,v.id);snapshot({...v,budget,youth,trust},g.round,timestamp);
   }
   if(g.round===4){
    const unfinished=all('SELECT * FROM tasks WHERE assigned_to IS NOT NULL AND done=0');
    const workload=new Map();for(const task of unfinished)workload.set(task.assigned_to,(workload.get(task.assigned_to)||0)+1);
    for(const task of unfinished){
     const player=row('SELECT role FROM players WHERE id=?',task.assigned_to);
     const fit=player?.role===task.required_role||player?.role==='mayor';
     const progress=Math.min(100,task.progress+(100/(task.minutes*6))*(fit?1:.35)/workload.get(task.assigned_to));
     run('UPDATE tasks SET progress=?,done=? WHERE id=?',progress,progress>=100?1:0,task.id);
    }
   }
   timedEvents(g,timestamp);
  }
  if(count)run('UPDATE game SET last_sim_at=? WHERE id=1',g.last_sim_at+count*10000);
  timedEvents(g,target);
  if(now>=deadline)closeRound('timer',deadline);
 });
}
function recordRoundStart(round,timestamp){run('INSERT OR IGNORE INTO round_starts VALUES(?,?,?)',round,timestamp,JSON.stringify(all('SELECT * FROM villages')));}
function generateRoundNews(timestamp){
 const {articles,sources}=generateNews(all('SELECT * FROM villages'),all('SELECT * FROM players'),all('SELECT * FROM investments'),timestamp);
 for(const table of ['news_choices','news_context','news_sources','news'])run(`DELETE FROM ${table}`);
 for(const n of articles){
  run('INSERT INTO news VALUES(?,?,?,?,?,?,?)',n.id,n.sourceVillage,n.headline,n.body,n.authentic?1:0,n.signer,n.seal);
  run('INSERT INTO news_context VALUES(?,?,?)',n.id,n.explanation,n.asOf);
 }
 for(const source of sources)run('INSERT INTO news_sources VALUES(?,?)',source.villageId,JSON.stringify(source));
}
function resolveSecurity(){
 for(const v of VILLAGES){
  const answers=all('SELECT a.* FROM security_answers a JOIN players p ON p.id=a.player_id WHERE p.village_id=?',v.id);
  const correct=answers.filter(a=>SECURITY_QUESTIONS.find(q=>q.id===a.question_id)?.correct===a.answer_id).length;
  const possible=row('SELECT COUNT(*) AS n FROM players WHERE village_id=? AND verified=1',v.id).n*SECURITY_QUESTIONS.length;
  const change=answers.length?Math.round((correct*2-answers.length)*4/Math.max(1,possible)):0;
  run('UPDATE villages SET trust=MAX(0,MIN(100,trust+?)) WHERE id=?',change,v.id);
  logEvent(5,v.id,'security','Security exercise reviewed',`${correct}/${answers.length} submitted answers correct. Trust ${change>=0?'+':''}${change}.`);
 }
}
function closeRound(reason='manual',timestamp=at()){
 const g=getGame();if(!g.round)return null;
 const existing=row('SELECT data FROM round_reports WHERE round=?',g.round);if(existing)return JSON.parse(existing.data);
 if(g.round===2)resolveNews();if(g.round===3)resolveMedia();if(g.round===4)resolveFestival();if(g.round===5)resolveSecurity();
 const savedStart=row('SELECT * FROM round_starts WHERE round=?',g.round);
 const starts=savedStart?JSON.parse(savedStart.data):VILLAGES.map(v=>row('SELECT * FROM snapshots WHERE village_id=? AND round=? ORDER BY id LIMIT 1',v.id,g.round)).filter(Boolean).map(v=>({...v,id:v.village_id}));
 const elapsedMs=Math.min(ROUNDS[g.round-1].duration*1000,roundElapsed(g,timestamp));
 const report=buildRoundReport({round:g.round,startedAt:savedStart?.at??null,closedAt:timestamp,elapsedMs,reason,starts,villages:all('SELECT * FROM villages'),people:all('SELECT id,name,village_id,role,verified FROM players'),events:all('SELECT * FROM events WHERE round=? ORDER BY id',g.round),investments:all('SELECT * FROM investments'),news:all('SELECT * FROM news'),choices:all('SELECT * FROM news_choices'),posts:all('SELECT * FROM posts'),tasks:all('SELECT * FROM tasks'),answers:all('SELECT * FROM security_answers'),crisisLosses:all('SELECT * FROM crisis_losses WHERE round=?',g.round)});
 run('INSERT INTO round_reports VALUES(?,?,?)',g.round,timestamp,JSON.stringify(report));
 run("UPDATE game SET phase='review',elapsed_ms=? WHERE id=1",elapsedMs);
 logEvent(g.round,null,'review',`Round ${g.round} closed — village reports ready`,'The host opens the next round after discussion.',timestamp);
 recordBaseline(g.round);return report;
}

// Keep the original audit schema compatible with the previous release for rollback.
db.exec('CREATE TABLE IF NOT EXISTS mail_provider_refs(delivery_id TEXT PRIMARY KEY REFERENCES mail_deliveries(id) ON DELETE CASCADE,provider_id TEXT NOT NULL)');
function recordDelivery(entry){
 run('INSERT INTO mail_deliveries(id,email,kind,status,provider,attempts,error_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,provider=excluded.provider,attempts=excluded.attempts,error_code=excluded.error_code,updated_at=excluded.updated_at',entry.id,entry.to,entry.kind,entry.status,entry.provider,entry.attempts,entry.code,entry.at,at());
 if(entry.providerId)run('INSERT INTO mail_provider_refs VALUES(?,?) ON CONFLICT(delivery_id) DO UPDATE SET provider_id=excluded.provider_id',entry.id,entry.providerId);
}
const mailer=createMailer({record:recordDelivery,writeOutbox:(to,subject,body)=>run('INSERT INTO outbox(email,subject,body,at) VALUES(?,?,?,?)',to,subject,body,at())});
const mailQueue=createMailQueue({db,secret:PIN_PEPPER,mailer,record:recordDelivery,
 eligible:context=>{if(!context.playerId)return true;const p=row('SELECT * FROM players WHERE id=?',context.playerId);if(!p)return false;if(context.action==='exercise')return !!p.verified&&!!p.consent_email&&getGame().round===5&&getGame().phase!=='ended';return p.pin_lookup===context.expectedLookup;},
 onAccepted:context=>{if(context.action==='resend')run('UPDATE players SET pin_hash=?,pin_lookup=?,attempts=0,locked_until=0,pin_sent_at=? WHERE id=? AND pin_lookup=?',context.pinHash,context.pinLookup,at(),context.playerId,context.expectedLookup);else if(context.action==='registration')run('UPDATE players SET pin_sent_at=? WHERE id=? AND pin_lookup=?',at(),context.playerId,context.expectedLookup);},
 onFailed:context=>{if(context.action==='registration')run('DELETE FROM players WHERE id=? AND verified=0 AND pin_lookup=?',context.playerId,context.expectedLookup);},
 onActive:job=>{if(job.kind==='pin'&&job.player_id)pinDeliveries.add(job.player_id);},
 onIdle:job=>{if(job.kind==='pin'&&job.player_id)pinDeliveries.delete(job.player_id);},
 onError:()=>console.error('Mail queue could not complete a database operation; the request remains saved.')
});
db.exec('CREATE TRIGGER IF NOT EXISTS clear_player_mail_jobs AFTER DELETE ON players BEGIN DELETE FROM mail_jobs WHERE player_id=OLD.id; END;');
run("UPDATE mail_deliveries SET status=CASE WHEN id IN (SELECT id FROM mail_jobs) THEN 'queued' ELSE 'interrupted' END,error_code='server_restart',updated_at=? WHERE status='sending'",at());
async function sendEmail(to,subject,body,kind='test',context={}){return mailQueue.wait(mailQueue.enqueue({to,subject,body,kind},context));}


function newPin(id){mailQueue.cancelPlayer(id);const {pin,fingerprint}=generatePin();run('UPDATE players SET pin_hash=?,pin_lookup=?,attempts=0,locked_until=0,pin_sent_at=? WHERE id=?',hashPin(pin),fingerprint,at(),id);return pin;}
function retryError(message,seconds){return Object.assign(httpError(429,message),{retryAfter:seconds});}
async function resendPin(value){
 const email=clean(value).toLowerCase();
 if(email.length>150||!EMAIL_PATTERN.test(email))throw httpError(400,'Enter your registered email address.');
 if(!emailConfigured())throw httpError(503,'Email delivery is unavailable. Ask the host for a recovery PIN.');
 const p=row('SELECT * FROM players WHERE email=?',email);
 const message=mailSettings.real?'If this email is registered, check your inbox and spam folder for a new PIN. If nothing arrives, check the address or ask the host.':'Rehearsal mode: if this email is registered, ask the host for the new PIN from the test outbox. No real email is sent.';
 if(!p)return {ok:true,message,retryAfter:90};
 if(pinDeliveries.has(p.id)||mailQueue.pendingPlayer(p.id))throw retryError('Your PIN request is saved and still being processed. Check your inbox/spam or ask the host for a private PIN.',10);
 const remaining=Math.ceil((p.pin_sent_at+PIN_COOLDOWN_MS-at())/1000);
 if(remaining>0)throw retryError(`Please wait ${remaining} seconds before requesting another PIN. Check your inbox and spam folder.`,remaining);
 const {pin,fingerprint}=generatePin(),hash=hashPin(pin);
 const result=await sendEmail(p.email,'Your Digital Village login PIN',`Your new Digital Village login PIN is: ${pin}\n\nKeep it private. Your previous PIN stops working after the email service accepts the replacement.`,'pin',{action:'resend',playerId:p.id,expectedLookup:p.pin_lookup,pinLookup:fingerprint,pinHash:hash});
 if(result.status==='queued')return {ok:true,queued:true,message:'Your PIN request is saved. We are retrying delivery for up to 15 minutes, including after a server restart. Your previous PIN still works until the replacement is accepted. Ask the host if you need immediate entry.',retryAfter:10};
 if(result.status!=='accepted')throw httpError(503,'The email service could not send a new PIN. Your previous PIN still works. Try again or ask the host.');
 return {ok:true,message,retryAfter:90};
}
function invitationUrl(){
 try{const url=new URL(process.env.PUBLIC_BASE_URL);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return '';return url.origin+'/';}catch{return '';}
}
let securityDelivery=null;
async function sendSecurityNotifications(){
 const target=invitationUrl();
 if(!target){tx(()=>{run('UPDATE game SET security_sent=1 WHERE id=1');logEvent(5,null,'mail','Security exercise emails not sent','The public game address is missing. Use the on-site security lab.');});return;}
 const people=all('SELECT id,name,email FROM players WHERE verified=1 AND consent_email=1');
 const jobs=tx(()=>{if(getGame().security_sent)return [];const pending=people.map(x=>mailQueue.enqueue({to:x.email,subject:'Important: Digital Village account notification',body:`Hello ${x.name},\n\nA new security message is waiting for you. Review it here: ${target}?security=1\n\nThis is part of the consented Digital Village educational security simulation. No passwords will be requested.`,kind:'exercise'},{action:'exercise',playerId:x.id}));run('UPDATE game SET security_sent=1 WHERE id=1');return pending;});
 for(let i=0;i<people.length;i+=3){
  await Promise.all(jobs.slice(i,i+3).map(id=>mailQueue.wait(id)));
 }
 if(!jobs.length)return;
 const statuses=jobs.map(id=>row('SELECT status FROM mail_deliveries WHERE id=?',id)?.status),sent=statuses.filter(s=>s==='accepted').length,queued=statuses.filter(s=>['queued','sending'].includes(s)).length,rehearsal=statuses.filter(s=>s==='rehearsal').length;
 logEvent(5,null,'mail','Security exercise email status',`${sent}/${people.length} messages accepted by the email service; ${queued} pending; ${rehearsal} rehearsal only. The on-site security lab remains available to everyone.`);
}
function reservePlayer(payload,afterReserve=()=>{}){let name=clean(payload.name),email=clean(payload.email).toLowerCase(),village=clean(payload.village),role=clean(payload.role);
 if(name.length<2||name.length>70||!EMAIL_PATTERN.test(email)||email.length>150)throw httpError(400,'Enter a valid name and email');
 if(!VILLAGES.some(v=>v.id===village)||!ROLES.some(r=>r.id===role))throw httpError(400,'Choose a village and role');
 const id=randomBytes(12).toString('hex');const {pin,fingerprint}=generatePin();
 try{tx(()=>{run('DELETE FROM players WHERE verified=0 AND created_at<? AND id NOT IN (SELECT player_id FROM mail_jobs WHERE player_id IS NOT NULL)',at()-25*60000);
 run('INSERT INTO players(id,name,email,village_id,role,pin_hash,pin_lookup,consent_email,created_at,pin_sent_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,name,email,village,role,hashPin(pin),fingerprint,payload.consentEmail===true?1:0,at(),at());afterReserve({id,pin,fingerprint,name,email});});}
 catch(e){if(/UNIQUE/i.test(e.message))throw httpError(409,'Email already registered or that role is occupied');throw e;}
 return {id,pin,name,email};
}
async function register(payload){
 if(!emailConfigured())throw httpError(503,'Email delivery is not configured. Ask the host for help.');
 let job;
 const {email}=reservePlayer(payload,account=>{job=mailQueue.enqueue({to:account.email,subject:'Your Digital Village login PIN',body:`Welcome, ${account.name}!\n\nYour Digital Village login PIN is: ${account.pin}\n\nUse your email and PIN to sign in. Keep this PIN private.\n\nThis message is for the educational Digital Village simulation.`,kind:'pin'},{action:'registration',playerId:account.id,expectedLookup:account.fingerprint,pinLookup:account.fingerprint});});
 const result=await mailQueue.wait(job);
 if(result.status==='queued')return {ok:true,queued:true,email,message:'Your place and PIN request are saved. Delivery is pending; we will retry for up to 15 minutes, including after a server restart. Do not register again. You can sign in once the email arrives, or ask the host for a private PIN.',retryAfter:10};
 if(result.status!=='accepted')throw httpError(503,'Could not send your PIN. Your place has been released; try again or ask the host.');
 const message=mailSettings.real?'The email service accepted your PIN message. Check your inbox and spam folder.':'Rehearsal mode: your PIN is in the host test outbox. Ask the host for your code; no real email is sent.';
 return {ok:true,email,message,retryAfter:90};
}
function login(email,pin,res,req){email=clean(email).toLowerCase();pin=clean(pin);
 const p=row('SELECT * FROM players WHERE email=?',email);if(!p||!/^\d{6}$/.test(pin))throw httpError(401,'Email or PIN incorrect');
 if(p.locked_until>at())throw httpError(429,'Too many attempts. Wait 15 minutes or ask the host.');
 if(!verifyPin(pin,p.pin_hash)){const attempts=p.attempts+1;run('UPDATE players SET attempts=?,locked_until=? WHERE id=?',attempts,attempts>=5?at()+900000:0,p.id);throw httpError(401,'Email or PIN incorrect');}
 run('UPDATE players SET verified=1,attempts=0,locked_until=0,last_seen=? WHERE id=?',at(),p.id);startSession(res,req,p.id,false);return {ok:true};
}
function currentState(a,knownHistory=0){advanceWorld();const g=getGame(),villages=all('SELECT * FROM villages');
 const time=roundElapsed(g);const base={privacyContact:process.env.PRIVACY_CONTACT||'',emailConfigured:emailConfigured(),game:{round:g.round,phase:g.phase,elapsedMs:time,durationMs:(ROUNDS[g.round-1]?.duration||0)*1000,newsRevealed:!!g.news_revealed,mediaRevealed:!!g.media_revealed,crisisFired:!!g.crisis_fired,ticketsFired:!!g.tickets_fired},rounds:ROUNDS,villages:villages.map(v=>({...v,budget:Math.round(v.budget),youth:Math.round(v.youth),trust:Math.round(v.trust)})),investments:INVESTMENTS,roles:ROLES,assets:MEDIA_ASSETS.map(x=>({id:x.id,label:x.label,symbol:x.symbol,kind:x.kind,color:x.color,usage:x.usage,credit:x.credit||'',...(g.media_revealed||a?.admin?{allowed:x.allowed}:{})})),events:all('SELECT * FROM events ORDER BY id DESC LIMIT 24'),slots:all('SELECT village_id,role,verified FROM players').map(p=>({village:p.village_id,role:p.role,verified:!!p.verified}))};
 if(!a)return {...base,restricted:true};
 const person=a.player; if(person)run('UPDATE players SET last_seen=? WHERE id=?',at(),person.id);
 const showNews=g.round>=2 || a.admin;
 if(showNews){const mayorByVillage=Object.fromEntries(all("SELECT village_id,name FROM players WHERE role='mayor' AND verified=1").map(x=>[x.village_id,x.name]));
 base.news=all('SELECT n.*,c.explanation,c.as_of FROM news n LEFT JOIN news_context c ON c.news_id=n.id').map(x=>({id:x.id,sourceVillage:x.source_village,headline:x.headline,body:x.body,signer:x.signer==='OFFICIAL_MAYOR'?(mayorByVillage[x.source_village]||'Official Village Council'):x.signer,seal:x.seal,...(g.news_revealed||a.admin?{authentic:!!x.authentic,explanation:x.explanation||'Compare the signer and seal with the official council record.'}:{})}));
 base.choices=all('SELECT * FROM news_choices');base.newsSources=all('SELECT data FROM news_sources').map(x=>JSON.parse(x.data));}
 if(g.media_revealed||a.admin)base.campaignReviews=Object.fromEntries(all('SELECT * FROM posts').map(p=>[p.village_id,campaignReview(p)]));
 base.posts=all('SELECT * FROM posts').map(p=>({...p,assetIds:JSON.parse(p.asset_ids)}));
 if(g.round>=4||a.admin)base.tasks=all('SELECT * FROM tasks');
 base.historyVersion=row('SELECT COALESCE(MAX(id),0) AS n FROM snapshots').n;
 if(!knownHistory||knownHistory!==base.historyVersion)base.histories=Object.fromEntries(villages.map(v=>[v.id,all('SELECT at,budget,youth,trust,internet,jobs,services,education FROM snapshots WHERE village_id=? ORDER BY id DESC LIMIT 150',v.id).reverse()]));
 base.people=all('SELECT id,name,village_id,role,verified,last_seen FROM players');
 base.builtInvestments=all('SELECT village_id,investment_id FROM investments');
 base.serverTime=at();
 base.roundReportIndex=all('SELECT round,closed_at FROM round_reports ORDER BY round').map(r=>({round:r.round,closedAt:r.closed_at,name:ROUNDS[r.round-1].name}));
 if(['review','ended'].includes(g.phase)){const latest=row('SELECT data FROM round_reports ORDER BY round DESC LIMIT 1');base.latestRoundReport=latest?JSON.parse(latest.data):null;}
 if(g.round>=5||a.admin){
  const revealed=!!row('SELECT 1 FROM round_reports WHERE round=5');
  base.securityQuestions=SECURITY_QUESTIONS.map(q=>({id:q.id,title:q.title,message:q.message,options:q.options,...(revealed||a.admin?{correct:q.correct,explanation:q.explanation}:{})}));
  base.securityAnswers=person?all('SELECT question_id,answer_id FROM security_answers WHERE player_id=?',person.id):[];
  if(a.admin)base.securityParticipation=all('SELECT p.village_id,COUNT(*) AS answered FROM security_answers a JOIN players p ON p.id=a.player_id GROUP BY p.village_id');
 }
 if(g.phase==='ended')base.workshopStories=buildWorkshopStories(all('SELECT data FROM round_reports ORDER BY round').map(r=>JSON.parse(r.data)));
 if(person)base.helpCooldowns=Object.fromEntries(all("SELECT details,MAX(at) AS at FROM events WHERE kind='help' AND details LIKE ? AND at>? GROUP BY details",person.id+':%',at()-60000).map(e=>[e.details.slice(person.id.length+1),e.at+60000]));
 if(person)base.me=person;
 if(a.admin){base.admin=true;base.invitationUrl=invitationUrl();base.emailMode=mailSettings.mode;base.mailConfiguration={mode:mailSettings.mode,real:mailSettings.real,configured:mailSettings.configured,issues:mailSettings.issues};base.mailDeliveries=all("SELECT d.email,d.kind,d.status,d.provider,COALESCE(r.provider_id,'') AS provider_id,d.attempts,d.error_code,d.updated_at FROM mail_deliveries d LEFT JOIN mail_provider_refs r ON r.delivery_id=d.id ORDER BY d.updated_at DESC LIMIT 12");base.mailQueue={pending:row('SELECT COUNT(*) AS n FROM mail_jobs').n,active:mailQueue.active};base.outbox=DEV_MAIL?all('SELECT id,email,subject,body,at FROM outbox ORDER BY id DESC LIMIT 50'):[];base.stats={registered:base.people.length,verified:base.people.filter(p=>p.verified).length,active:base.people.filter(p=>p.last_seen>at()-35000).length};}
 return base;
}
function canInvest(p){return ['mayor','finance','digital'].includes(p.role);}
function resolveNews(){const g=getGame();if(g.news_revealed)return;
 for(const v of VILLAGES){const chosen=all('SELECT n.authentic,n.headline FROM news_choices c JOIN news n ON n.id=c.news_id WHERE c.village_id=?',v.id);let delta=0,trust=0;for(const n of chosen){delta+=n.authentic?1:-3;trust+=n.authentic?1:-3;}if(chosen.length){run('UPDATE villages SET youth=MAX(25,youth+?),trust=MAX(0,MIN(100,trust+?)) WHERE id=?',delta,trust,v.id);logEvent(g.round,v.id,'news','News review completed',`Youth ${delta>=0?'+':''}${delta}; trust ${trust>=0?'+':''}${trust}.`);}}
 run('UPDATE game SET news_revealed=1 WHERE id=1');recordBaseline(g.round);
}
function resolveMedia(){const g=getGame();if(g.media_revealed)return;
 for(const p of all('SELECT * FROM posts')){const reviewed=campaignReview(p);const violations=reviewed.filter(a=>!a.permitted).length,good=reviewed.length-violations;
  const budgetDelta=good*650-violations*2500;const trustDelta=good*1-violations*4;const youthDelta=violations?-violations:Math.max(1,Math.round(good/2));
  run('UPDATE villages SET budget=MAX(0,budget+?),trust=MAX(0,MIN(100,trust+?)),youth=MAX(25,youth+?) WHERE id=?',budgetDelta,trustDelta,youthDelta,p.village_id);
  logEvent(g.round,p.village_id,'media','Tourism campaign evaluated',`${violations} problematic asset(s). Budget ${budgetDelta>=0?'+':''}€${budgetDelta}.`);
 }
 run('UPDATE game SET media_revealed=1 WHERE id=1');recordBaseline(g.round);
}
function resolveFestival(){const g=getGame();if(g.festival_resolved)return;
 for(const v of VILLAGES){const tasks=all('SELECT * FROM tasks WHERE village_id=?',v.id);const blue=tasks.filter(t=>t.type==='blue'),red=tasks.filter(t=>t.type==='red');const doneBlue=blue.filter(t=>t.done).length,doneRed=red.filter(t=>t.done).length;
 const success=doneBlue===4&&red.length===2&&doneRed===2;const deltaYouth=success?12:doneBlue>=2?3:-8;const deltaBudget=success?12000:doneBlue>=2?1000:-8500;const deltaTrust=success?8:doneBlue>=2?0:-7;
 run('UPDATE villages SET youth=MAX(25,youth+?),budget=MAX(0,budget+?),trust=MAX(0,MIN(100,trust+?)) WHERE id=?',deltaYouth,deltaBudget,deltaTrust,v.id);
 logEvent(4,v.id,'festival',success?'Successful youth festival':doneBlue>=2?'Festival completed with difficulties':'Festival unsuccessful',`Completed ${doneBlue}/${blue.length} standard and ${doneRed}/${red.length} urgent tasks. Youth ${deltaYouth>=0?'+':''}${deltaYouth}.`);
 }
 run('UPDATE game SET festival_resolved=1 WHERE id=1');recordBaseline(4);
}
async function doAction(a,body){advanceWorld();const op=clean(body.op),g=getGame(),p=a?.player;
 if(op==='start'||op==='next'||op==='pause'||op==='resume'||op==='grant'||op==='shock'||op==='revealNews'||op==='revealMedia'||op==='triggerTicket'||op==='end'||op==='closeRound'){
  requireAdmin(a);const g=getGame();
  if(g.phase==='ended'){if(op==='end')return {ok:true};throw httpError(409,'The simulation has finished. Its results are frozen.');}
  if(g.phase==='review'&&!['next','end','closeRound'].includes(op))throw httpError(409,'The round is closed. Its results are frozen.');
  if(op==='closeRound'){
   if(!g.round||!['playing','paused','review'].includes(g.phase))throw httpError(409,'No active round to close.');
   tx(()=>closeRound('manual'));return {ok:true};
  }
  if(op==='start'||op==='next'){
   if(op==='start'&&g.round!==0)throw httpError(409,'Game already started');
   if(op==='next'&&(g.round<1||g.round>=5))throw httpError(409,'Cannot advance the game');
   const next=g.round+1,now=at();
   tx(()=>{
    if(g.round)closeRound('advanced',now);
    run("UPDATE game SET round=?,phase='playing',started_at=?,elapsed_ms=0,last_sim_at=?,crisis_fired=0,tickets_fired=0,last_dynamic_event_at=? WHERE id=1",next,now,now,now);
    recordRoundStart(next,now);
    if(next===2)generateRoundNews(now);
    if(next===4)addTasks('blue');
    logEvent(next,null,'round',`Round ${next} started`,ROUNDS[next-1].name);recordBaseline(next);
   });
   if(next===5){securityDelivery=sendSecurityNotifications().catch(e=>console.error('Security notification batch failed:',e.message)).finally(()=>{securityDelivery=null;});}
  }
  if(op==='pause'&&g.phase==='playing')run("UPDATE game SET phase='paused',elapsed_ms=? WHERE id=1",roundElapsed(g));
  if(op==='resume'&&g.phase==='paused'){
   const now=at(),eventAge=Math.max(0,g.started_at+g.elapsed_ms-g.last_dynamic_event_at);
   run("UPDATE game SET phase='playing',started_at=?,last_sim_at=?,last_dynamic_event_at=? WHERE id=1",now-g.elapsed_ms,now,now-eventAge);
  }
  if(op==='shock'&&g.round===1&&!g.crisis_fired)tx(()=>applyCrisis(g));
  if(op==='triggerTicket'&&g.round===4&&!g.tickets_fired)tx(()=>{addTasks('red');run('UPDATE game SET tickets_fired=1 WHERE id=1');logEvent(4,null,'crisis','Urgent festival problems reported');});
  if(op==='revealNews'&&g.round>=2)tx(resolveNews);
  if(op==='revealMedia'&&g.round>=3)tx(resolveMedia);
  if(op==='grant'){
   if(g.phase==='review')throw httpError(409,'Round results are frozen. Open the next round before issuing a grant.');
   const amount=Number(body.amount),v=clean(body.village);
   if(!VILLAGES.some(x=>x.id===v)||!Number.isFinite(amount)||amount<1||amount>250000)throw httpError(400,'Invalid grant (maximum €250,000)');
   tx(()=>{run('UPDATE villages SET budget=budget+? WHERE id=?',Math.floor(amount),v);logEvent(g.round,v,'grant','Regional investment awarded',`+€${Math.floor(amount).toLocaleString('en-US')} from the game host.`);recordBaseline(g.round);});
  }
  if(op==='end'){
   if(!g.round)throw httpError(409,'Start the simulation before finishing it.');
   tx(()=>{closeRound('ended');run("UPDATE game SET phase='ended' WHERE id=1");logEvent(g.round,null,'round','Simulation finished');});
  }
  return {ok:true};
 }
 const player=requirePlayer(a);
 if(g.phase!=='playing')throw httpError(409,'The host has not started this round');
 if(op==='invest'){
  if(g.round!==1||!canInvest(player))throw httpError(403,'Investment not available for your role/round');
  const item=INVESTMENTS.find(x=>x.id===body.id);if(!item)throw httpError(400,'Unknown project');
  tx(()=>{const v=row('SELECT * FROM villages WHERE id=?',player.village_id);if(row('SELECT 1 FROM investments WHERE village_id=? AND investment_id=?',v.id,item.id))throw httpError(409,'Project already built');if(v.budget<item.price)throw httpError(409,'Not enough budget');
   run('UPDATE villages SET budget=budget-?, internet=MIN(100,internet+?),education=MIN(100,education+?),services=MIN(100,services+?),jobs=MIN(100,jobs+?),trust=MIN(100,trust+?) WHERE id=?',item.price,item.effects.internet||0,item.effects.education||0,item.effects.services||0,item.effects.jobs||0,item.effects.trust||0,v.id);
   run('INSERT INTO investments VALUES(?,?,?)',v.id,item.id,at());logEvent(g.round,v.id,'investment',item.name,`Project approved by ${player.name}. Cost €${item.price}.`);recordBaseline(g.round);
  });return {ok:true};
 }
 if(op==='chooseNews'){
  if(g.round!==2||g.news_revealed)throw httpError(409,'News selection is closed');
  const n=row('SELECT * FROM news WHERE id=?',clean(body.id));if(!n||n.source_village===player.village_id)throw httpError(400,'Select a story about another village');
  if(!['mayor','media','advisor-1','advisor-2','advisor-3'].includes(player.role))throw httpError(403,'Your role cannot select news');
  if(row('SELECT 1 FROM news_choices WHERE village_id=? AND news_id=?',player.village_id,n.id))return {ok:true};
  const count=row('SELECT COUNT(*) AS c FROM news_choices WHERE village_id=?',player.village_id).c;if(count>=6)throw httpError(409,'Your village has already selected six articles');
  run('INSERT OR IGNORE INTO news_choices VALUES (?,?)',player.village_id,n.id);return {ok:true};
 }
 if(op==='unchooseNews'){
  if(g.round!==2||g.news_revealed)throw httpError(409,'News selection is closed');
  if(!['mayor','media','advisor-1','advisor-2','advisor-3'].includes(player.role))throw httpError(403,'Your role cannot select news');
  run('DELETE FROM news_choices WHERE village_id=? AND news_id=?',player.village_id,clean(body.id));return {ok:true};
 }
 if(op==='publish'){
  if(g.round!==3||g.media_revealed)throw httpError(409,'The content editor is closed');
  if(!['mayor','media','advisor-1','advisor-2','advisor-3'].includes(player.role))throw httpError(403,'Ask the media team to publish');
  const title=clean(body.title),content=clean(body.body),credits=clean(body.credits).slice(0,300),ids=Array.isArray(body.assets)?[...new Set(body.assets)].slice(0,5):[];
  if(title.length<5||title.length>100||content.length<20||content.length>1200)throw httpError(400,'Write a title and 20–1200 characters of text');
  if(Array.isArray(body.assets)&&body.assets.length>5)throw httpError(400,'Choose at most five assets.');
  if(ids.some(id=>!MEDIA_ASSETS.some(x=>x.id===id)))throw httpError(400,'Invalid assets');
  tx(()=>{
   const previous=row('SELECT updated_at FROM posts WHERE village_id=?',player.village_id);
   if(body.version!==undefined&&Number(body.version)!==(previous?.updated_at||0))throw httpError(409,'Another council member changed the campaign. Your draft is preserved; review the latest published version before replacing it.');
   const updated=Math.max(at(),(previous?.updated_at||0)+1);
   run('INSERT INTO posts(village_id,title,body,asset_ids,updated_at,credits) VALUES(?,?,?,?,?,?) ON CONFLICT(village_id) DO UPDATE SET title=excluded.title,body=excluded.body,asset_ids=excluded.asset_ids,updated_at=excluded.updated_at,credits=excluded.credits',player.village_id,title,content,JSON.stringify(ids),updated,credits);
  });return {ok:true};
 }
 if(op==='answerSecurity'){
  if(g.round!==5)throw httpError(409,'The security exercise is not open.');
  const question=SECURITY_QUESTIONS.find(q=>q.id===body.id);
  if(!question||!question.options.some(o=>o.id===body.answer))throw httpError(400,'Choose a valid response.');
  run('INSERT INTO security_answers VALUES(?,?,?,?) ON CONFLICT(player_id,question_id) DO UPDATE SET answer_id=excluded.answer_id,updated_at=excluded.updated_at',player.id,question.id,body.answer,at());return {ok:true};
 }
 if(op==='claimTask'){
  if(g.round!==4)throw httpError(409,'Tasks are not active');
  const t=row('SELECT * FROM tasks WHERE id=?',clean(body.id));if(!t||t.village_id!==player.village_id||t.done)throw httpError(400,'Task unavailable');
  if(t.assigned_to&&t.assigned_to!==player.id)throw httpError(409,'Already claimed by another player');
  run('UPDATE tasks SET assigned_to=? WHERE id=?',player.id,t.id);return {ok:true};
 }
 if(op==='releaseTask'){
  if(g.round!==4)throw httpError(409,'Tasks are not active');
  run('UPDATE tasks SET assigned_to=NULL WHERE id=? AND assigned_to=? AND done=0',clean(body.id),player.id);return {ok:true};
 }
 if(op==='helpTask'){
  if(g.round!==4)throw httpError(409,'Tasks are not active');
  const t=row('SELECT * FROM tasks WHERE id=?',clean(body.id));if(!t||t.village_id!==player.village_id||!t.assigned_to||t.done)throw httpError(400,'Task unavailable');
  const last=row("SELECT at FROM events WHERE village_id=? AND kind='help' AND details=? ORDER BY id DESC LIMIT 1",player.village_id,`${player.id}:${t.id}`);
  if(last&&at()-last.at<60000)throw httpError(429,'You can help this task again after one minute');
  if(t.assigned_to===player.id)throw httpError(409,'Help is for a teammate’s task. Your own task progresses automatically.');
  const bonus=player.role===t.required_role?7:3;run('UPDATE tasks SET progress=MIN(100,progress+?),done=CASE WHEN progress+?>=100 THEN 1 ELSE done END WHERE id=?',bonus,bonus,t.id);logEvent(4,player.village_id,'help',`${player.name} assisted with ${t.title}`,`${player.id}:${t.id}`);return {ok:true};
 }
 throw httpError(400,'Unknown action');
}
const json=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
async function bodyJson(req){let s='';for await(const chunk of req){s+=chunk;if(s.length>45000)throw httpError(413,'Request too large');}try{const value=JSON.parse(s||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw httpError(400,'Expected a JSON object');}}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
async function handler(req,res){try{
 const url=new URL(req.url,'http://localhost'),path=url.pathname;
 if(req.method==='GET'&&path==='/healthz')return json(res,200,{ok:!!row('SELECT id FROM game WHERE id=1'),app:'digital-village'});
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 if(path.startsWith('/api/')){
  const a=auth(req);
  if(req.method==='GET'&&path==='/api/state')return json(res,200,currentState(a,Number(url.searchParams.get('history')||0)));
  if(req.method==='GET'&&path==='/api/reports'){
   if(!a)throw httpError(401,'Please sign in');
   const requested=Number(url.searchParams.get('round'));
   const record=requested?row('SELECT data FROM round_reports WHERE round=?',requested):row('SELECT data FROM round_reports ORDER BY round DESC LIMIT 1');
   if(!record)throw httpError(404,'This round does not have a saved report yet.');
   return json(res,200,JSON.parse(record.data));
  }
  if(req.method==='GET'&&path==='/api/invite.svg'){
   requireAdmin(a);const target=invitationUrl();if(!target)throw httpError(503,'Set PUBLIC_BASE_URL before sharing the game.');
   const {default:QRCode}=await import('qrcode');
   const svg=await QRCode.toString(target,{type:'svg',errorCorrectionLevel:'M',margin:4,width:256});
   res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'private, no-store'});return res.end(svg);
  }
  if(req.method!=='POST')throw httpError(405,'Method not allowed');
  const origin=req.headers.origin;if(origin){const o=new URL(origin);const expected=(process.env.PUBLIC_BASE_URL?new URL(process.env.PUBLIC_BASE_URL).host:req.headers.host);if(o.host!==expected)throw httpError(403,'Invalid request origin');}
  const b=await bodyJson(req);
  if(path==='/api/register'){throttle(req,'register',80,3600000);const result=await register(b);return json(res,result.queued?202:200,result);}
  if(path==='/api/login'){throttle(req,'login',300,900000);return json(res,200,login(b.email,b.pin,res,req));}
  if(path==='/api/admin/login'){
   const inp=Buffer.from(clean(b.password)),exp=Buffer.from(ADMIN_PASSWORD);
   if(inp.length!==exp.length||!timingSafeEqual(inp,exp)){throttle(req,'admin',6,900000);throw httpError(401,'Invalid host password');}
   startSession(res,req,null,true);return json(res,200,{ok:true});
  }
  if(path==='/api/logout'){const token=parseCookie(req);if(token)run('DELETE FROM sessions WHERE token_hash=?',sha(token));res.setHeader('Set-Cookie','dv_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');return json(res,200,{ok:true});}
  if(path==='/api/action')return json(res,200,await doAction(a,b));
  if(path==='/api/admin/delete-data'){
   requireAdmin(a);throttle(req,'wipe-data',3,3600000);
   if(pinDeliveries.size||securityDelivery||mailQueue.active)throw httpError(409,'Email is being processed. Wait for it to finish before erasing accounts.');
   if(b.confirm!=='DELETE ALL PLAYER DATA')throw httpError(400,'Confirmation mismatch');
   const got=Buffer.from(clean(b.password)),expected=Buffer.from(ADMIN_PASSWORD);
   if(got.length!==expected.length||!timingSafeEqual(got,expected))throw httpError(403,'Host password is incorrect');
   tx(()=>{for(const table of ['mail_jobs','mail_provider_refs','mail_deliveries','security_answers','round_reports','round_starts','crisis_losses','news_choices','news_context','news_sources','news','posts','tasks','investments','snapshots','events','outbox','sessions','players'])run(`DELETE FROM ${table}`);for(const v of VILLAGES)run('UPDATE villages SET budget=?,youth=?,internet=?,education=?,services=?,jobs=?,trust=? WHERE id=?',v.budget,v.youth,v.internet,v.education,v.services,v.jobs,v.trust,v.id);run("UPDATE game SET round=0,phase='waiting',started_at=0,elapsed_ms=0,last_sim_at=0,crisis_fired=0,tickets_fired=0,news_revealed=0,media_revealed=0,festival_resolved=0,security_sent=0,last_dynamic_event_at=0 WHERE id=1");});
   res.setHeader('Set-Cookie','dv_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
   return json(res,200,{ok:true});
  }
  if(path==='/api/admin/enrol'){
   requireAdmin(a);throttle(req,'host-enrol',60,3600000);
   if(b.present!==true)throw httpError(400,'Confirm the participant is present and their identity has been checked.');
   const account=reservePlayer(b);logEvent(getGame().round,null,'admin','Host enrolled a present participant','A recovery PIN was handed over without relying on email.');
   return json(res,200,{ok:true,pin:account.pin,email:account.email,name:account.name});
  }
  if(path==='/api/admin/test-email'){
   requireAdmin(a);throttle(req,'mail-test',3,900000);const email=clean(b.email).toLowerCase();
   if(!EMAIL_PATTERN.test(email)||email.length>150)throw httpError(400,'Enter the address where you will check the test message.');
   if(!mailSettings.real)throw httpError(503,'Configure a real sender before testing delivery. Rehearsal outbox is not real email.');
   const sent=await sendEmail(email,'Digital Village — delivery check','This is the requested Digital Village delivery test. If you can read this message, confirm receipt in the host checklist. No PIN is included.','test');
   if(sent.status==='queued')return json(res,202,{ok:true,queued:true,message:'Test request saved; delivery is pending and will be retried for up to 15 minutes. This is not a successful delivery yet.'});
   if(sent.status!=='accepted')throw httpError(503,'The provider did not accept the test email. Check the delivery diagnostics below.');
   return json(res,200,{ok:true,message:'The email service accepted the test. Confirm that it actually arrived in your inbox or spam folder.'});
  }
  if(path==='/api/admin/issue-pin'){
   requireAdmin(a);const p=row('SELECT id,email FROM players WHERE id=?',clean(b.playerId));if(!p)throw httpError(404,'Player not found');
   if(pinDeliveries.has(p.id))throw retryError('A PIN email is still being processed for this player. Please wait.',2);
   const pin=tx(()=>newPin(p.id));logEvent(getGame().round,null,'admin','Emergency PIN issued',`Recovery requested for account ${p.id}.`);
   return json(res,200,{ok:true,pin,email:p.email});
  }
  if(path==='/api/resend'){
   throttle(req,'resend',50,900000);const result=await resendPin(b.email);return json(res,result.queued?202:200,result);
  }
  throw httpError(404,'Unknown endpoint');
 }
 if(req.method!=='GET'&&req.method!=='HEAD')throw httpError(405,'Method not allowed');
 const file=path==='/'?'index.html':path.slice(1);
 if(!['index.html','app.js','report-ui.js','style.css','favicon.svg'].includes(file))throw httpError(404,'Not found');
 const content=await readFile(join(ROOT,'public',file));res.writeHead(200,{'Content-Type':mime[extname(file)],'Cache-Control':file==='index.html'?'no-store':'public, max-age=120','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:content);
 }catch(e){const code=e.status||500;if(code>=500)console.error(e);if(e.retryAfter)res.setHeader('Retry-After',String(e.retryAfter));json(res,code,{error:e.status?e.message:'Server error',...(e.retryAfter?{retryAfter:e.retryAfter}:{})});}}
// Persisted rounds resume under host control, without simulating hours of downtime.
const recovered=getGame();
if(recovered.phase==='playing')tx(()=>{
 run("UPDATE game SET phase='paused',elapsed_ms=? WHERE id=1",Math.max(0,recovered.last_sim_at-recovered.started_at));
 logEvent(recovered.round,null,'recovery','Server restarted — simulation paused','The host can resume from the last saved simulation tick.');
});
if(getGame().round===5&&!getGame().security_sent&&getGame().phase!=='ended')securityDelivery=sendSecurityNotifications().catch(()=>console.error('Security notification setup remains incomplete.')).finally(()=>{securityDelivery=null;});
const worldClock=process.env.NODE_ENV==='test'?null:setInterval(()=>{try{advanceWorld();}catch(e){console.error('World tick failed:',e.message);}},1000);
worldClock?.unref();
const server=createServer(handler);
const mailClock=process.env.NODE_ENV==='test'?null:setInterval(()=>void mailQueue.drain().catch(()=>console.error('Mail queue check failed; saved requests remain pending.')),1000);
mailClock?.unref();
server.on('close',()=>{clearInterval(worldClock);clearInterval(mailClock);mailQueue.close();});
if(process.env.NODE_ENV!=='test')server.listen(PORT,HOST,()=>console.log(`Digital Village listening at http://${HOST}:${PORT}; dev email outbox: ${DEV_MAIL?'on':'off'}`));
export {handler,server,db,advanceWorld};
