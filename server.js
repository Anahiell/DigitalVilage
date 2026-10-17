import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {existsSync, mkdirSync} from 'node:fs';
import {join, extname, resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, randomInt, scryptSync, createHash, timingSafeEqual} from 'node:crypto';
import {VILLAGES,ROLES,INVESTMENTS,ROUNDS,MEDIA_ASSETS,NEWS_TEMPLATES,FESTIVAL_TASKS} from './data.js';
const ROOT=process.cwd(), HOST=process.env.HOST||'127.0.0.1',PORT=Number(process.env.PORT||3000);
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'', PIN_PEPPER=process.env.PIN_PEPPER||'';
if(!ADMIN_PASSWORD||ADMIN_PASSWORD.includes('CHANGE_ME')||ADMIN_PASSWORD.length<14) throw Error('Set ADMIN_PASSWORD with at least 14 characters in .env');
if(!PIN_PEPPER||PIN_PEPPER.includes('CHANGE_ME')||PIN_PEPPER.length<20) throw Error('Set PIN_PEPPER with at least 20 random characters in .env');
const DEV_MAIL=process.env.DEV_EMAIL_OUTBOX==='1';
const ipBuckets=new Map();
function throttle(req,group,max,windowMs){
 const ip=String((process.env.TRUST_PROXY==='1'?req.headers['x-forwarded-for']:null)||req.socket.remoteAddress||'local').split(',')[0].trim();
 const key=group+':'+ip,now=at(),old=ipBuckets.get(key)||[];
 const recent=old.filter(t=>now-t<windowMs);if(recent.length>=max)throw httpError(429,'Too many requests. Please wait.');
 recent.push(now);ipBuckets.set(key,recent);
 if(ipBuckets.size>2000)for(const [k,v] of ipBuckets)if(v.every(t=>now-t>3600000))ipBuckets.delete(k);
}
const DB_DIR=join(ROOT,'storage'); mkdirSync(DB_DIR,{recursive:true});
const db=new DatabaseSync(process.env.DB_PATH||join(DB_DIR,'village.db'));
db.exec('PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS game (
 id INTEGER PRIMARY KEY CHECK(id=1), round INTEGER NOT NULL DEFAULT 0,
 phase TEXT NOT NULL DEFAULT 'waiting', started_at INTEGER NOT NULL DEFAULT 0,
 elapsed_ms INTEGER NOT NULL DEFAULT 0, last_sim_at INTEGER NOT NULL DEFAULT 0,
 crisis_fired INTEGER NOT NULL DEFAULT 0, tickets_fired INTEGER NOT NULL DEFAULT 0,
 news_revealed INTEGER NOT NULL DEFAULT 0, media_revealed INTEGER NOT NULL DEFAULT 0,
 festival_resolved INTEGER NOT NULL DEFAULT 0, security_sent INTEGER NOT NULL DEFAULT 0
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
CREATE TABLE IF NOT EXISTS outbox (
 id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,at INTEGER NOT NULL
);
`);
const at=()=>Date.now(), sha=x=>createHash('sha256').update(x).digest('hex');
function tx(fn){db.exec('BEGIN IMMEDIATE');try{const a=fn();db.exec('COMMIT');return a;}catch(e){db.exec('ROLLBACK');throw e;}}
function row(q,...a){return db.prepare(q).get(...a);} function all(q,...a){return db.prepare(q).all(...a);} function run(q,...a){return db.prepare(q).run(...a);}
if(!row('SELECT id FROM game WHERE id=1')) tx(()=>{
 run('INSERT INTO game(id) VALUES (1)');
 for(const v of VILLAGES) run('INSERT INTO villages VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',v.id,v.name,v.emoji,v.description,v.budget,v.youth,v.internet,v.education,v.services,v.jobs,v.trust,v.youth);
 for(const [vi,v] of VILLAGES.entries()) NEWS_TEMPLATES.forEach(([h,b,truth],i)=>{
  const fake=!truth;
  run('INSERT INTO news VALUES(?,?,?,?,?,?,?)',`${v.id}-n${i+1}`,v.id,h,b,truth?1:0,fake?['Assistant Mayor A. North','Anonymous News Desk','Special Press Secretary'][i%3]:'OFFICIAL_MAYOR',fake?`${v.id.slice(0,2).toUpperCase()}-OLD-${(i+11)%87}`:`${v.id.slice(0,3).toUpperCase()}-OFFICIAL`);
 });
});
const httpError=(status,message)=>Object.assign(new Error(message),{status});
const clean=s=>String(s??'').trim();
function hashPin(pin){const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(pin+PIN_PEPPER,salt,32).toString('hex')}`;}
function verifyPin(pin,stored){const [salt,hash]=(stored||'').split(':');if(!salt||!hash)return false;const expected=Buffer.from(hash,'hex'), actual=scryptSync(pin+PIN_PEPPER,salt,32);return expected.length===actual.length&&timingSafeEqual(expected,actual);}
function generatePin(){for(let i=0;i<30;i++){const pin=String(randomInt(100000,1000000)),fingerprint=sha(PIN_PEPPER+pin);if(!row('SELECT id FROM players WHERE pin_lookup=?',fingerprint)) return {pin,fingerprint};}throw httpError(503,'Could not generate PIN');}
function parseCookie(req){const raw=req.headers.cookie||'';const m=raw.match(/(?:^|;\s*)dv_session=([a-f0-9]{64})/);return m?.[1]||'';}
function auth(req){const t=parseCookie(req);if(!t)return null;const s=row('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?',sha(t),at());if(!s)return null;if(s.admin)return {admin:true};const player=row('SELECT id,name,email,village_id,role,verified,consent_email FROM players WHERE id=?',s.player_id);return player?{admin:false,player}:null;}
function cookie(token,req){const secure=(process.env.TRUST_PROXY==='1'&&req.headers['x-forwarded-proto']==='https')||req.socket.encrypted;return `dv_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Number(process.env.SESSION_DAYS||2)*86400}${secure?'; Secure':''}`;}
function startSession(res,req,playerId=null,admin=false){const token=randomBytes(32).toString('hex');run('INSERT INTO sessions VALUES(?,?,?,?)',sha(token),playerId,admin?1:0,at()+Number(process.env.SESSION_DAYS||2)*86400000);res.setHeader('Set-Cookie',cookie(token,req));}
function requirePlayer(a){if(!a||a.admin||!a.player)throw httpError(401,'Please sign in');return a.player;}
function requireAdmin(a){if(!a?.admin)throw httpError(403,'Host access required');}
function logEvent(round,villageId,kind,title,details=''){run('INSERT INTO events(at,round,village_id,kind,title,details) VALUES(?,?,?,?,?,?)',at(),round,villageId,kind,title,details);}
function snapshot(v,round,ts){run('INSERT INTO snapshots(village_id,at,round,budget,youth,trust,internet,services,education,jobs) VALUES(?,?,?,?,?,?,?,?,?,?)',v.id,ts,round,v.budget,v.youth,v.trust,v.internet,v.services,v.education,v.jobs);}
function clamp(v,min=0,max=100){return Math.min(max,Math.max(min,v));}
function roundElapsed(g,now=at()){return g.phase==='playing'?Math.max(0,now-g.started_at):g.elapsed_ms;}
function getGame(){return row('SELECT * FROM game WHERE id=1');}
function recordBaseline(round){for(const v of all('SELECT * FROM villages'))snapshot(v,round,at());}
function addTasks(type){FESTIVAL_TASKS.filter(t=>t.type===type).forEach((t,i)=>{for(const v of VILLAGES){const id=`${v.id}-${type}-${i}`;run('INSERT OR IGNORE INTO tasks(id,village_id,title,type,required_role,minutes,description) VALUES (?,?,?,?,?,?,?)',id,v.id,t.title,t.type,t.role,t.minutes,t.description);}});}
function applyCrisis(g){for(const v of all('SELECT * FROM villages')){const cut=Math.round(v.budget*.30);run('UPDATE villages SET budget=MAX(0,budget-?) WHERE id=?',cut,v.id);logEvent(g.round,v.id,'shock','Regional funding cut by 30%',`Budget reduced by €${cut.toLocaleString('en-US')}.`);}run('UPDATE game SET crisis_fired=1 WHERE id=1');}
function advanceWorld(){let g=getGame();if(g.phase!=='playing')return;
 const now=at(),n=Math.min(360,Math.floor(Math.max(0,now-g.last_sim_at)/10000)),elapsed=roundElapsed(g,now);
 if(!n && !(g.round===1&&!g.crisis_fired&&elapsed>=600000) && !(g.round===4&&!g.tickets_fired&&elapsed>=240000))return;
 tx(()=>{
 g=getGame();if(g.phase!=='playing')return;
 const nt=Math.min(360,Math.floor(Math.max(0,now-g.last_sim_at)/10000));
 for(let step=0;step<nt;step++){
  for(const v of all('SELECT * FROM villages')){
   // Ten real seconds represent one simulated reporting period. Every metric responds to the current infrastructure mix.
   const attractiveness=(v.internet*.23+v.education*.24+v.services*.23+v.jobs*.30);
   const migration=clamp((attractiveness-50)*.006+(v.trust-50)*.003,-.32,.32);
   const operating=155+v.internet*.92+v.education*.75+v.services*1.05+v.jobs*.45;
   const revenue=80+v.youth*.56+v.jobs*2.4+v.trust*.45;
   const budget=Math.max(0,v.budget+revenue-operating);
   const youth=Math.max(25,v.youth+migration-(budget===0?.15:0));
   const trust=clamp(v.trust+(v.services>55?.035:-.025)+(budget===0?-.08:0));
   run('UPDATE villages SET budget=?,youth=?,trust=? WHERE id=?',budget,youth,trust,v.id);
   snapshot({...v,budget,youth,trust},g.round,g.last_sim_at+(step+1)*10000);
  }
  if(g.round===4){for(const t of all('SELECT * FROM tasks WHERE assigned_to IS NOT NULL AND done=0')){
   const p=row('SELECT role FROM players WHERE id=?',t.assigned_to);
   const match=p?.role===t.required_role||p?.role==='mayor';
   const competing=row('SELECT COUNT(*) AS n FROM tasks WHERE assigned_to=? AND done=0',t.assigned_to).n;
   const multiplier=match?1:0.35;const rate=(100/(t.minutes*6))*multiplier/Math.max(1,competing);
   const progress=Math.min(100,t.progress+rate);
   run('UPDATE tasks SET progress=?,done=? WHERE id=?',progress,progress>=100?1:0,t.id);
  }}
 }
 if(nt)run('UPDATE game SET last_sim_at=? WHERE id=1',g.last_sim_at+nt*10000);
 if(g.round===1&&!g.crisis_fired&&elapsed>=600000)applyCrisis(g);
 if(g.round===4&&!g.tickets_fired&&elapsed>=240000){addTasks('red');run('UPDATE game SET tickets_fired=1 WHERE id=1');logEvent(4,null,'crisis','Emergency alerts: pipe failure and speaker cancellation','Critical tickets have arrived. Assign the right people to solve them.');}
 });
}
async function sendEmail(to,subject,body){if(process.env.SMTP_EMAIL&&process.env.SMTP_APP_PASSWORD){
 try{const {default:nodemailer}=await import('nodemailer');const transport=nodemailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:process.env.SMTP_EMAIL,pass:process.env.SMTP_APP_PASSWORD}});await transport.sendMail({from:`Digital Village <${process.env.SMTP_EMAIL}>`,to,subject,text:body});return true;}catch(e){console.error('Mail failed:',e.message);return false;}
 }
 if(DEV_MAIL){run('INSERT INTO outbox(email,subject,body,at) VALUES(?,?,?,?)',to,subject,body,at());return true;}
 return false;
}
function newPin(id){const {pin,fingerprint}=generatePin();run('UPDATE players SET pin_hash=?,pin_lookup=?,attempts=0,locked_until=0,pin_sent_at=? WHERE id=?',hashPin(pin),fingerprint,at(),id);return pin;}
async function register(payload){let name=clean(payload.name),email=clean(payload.email).toLowerCase(),village=clean(payload.village),role=clean(payload.role);
 if(name.length<2||name.length>70||!/^\S+@\S+\.\S+$/.test(email)||email.length>150)throw httpError(400,'Enter a valid name and email');
 if(!VILLAGES.some(v=>v.id===village)||!ROLES.some(r=>r.id===role))throw httpError(400,'Choose a village and role');
 if(!DEV_MAIL&&!(process.env.SMTP_EMAIL&&process.env.SMTP_APP_PASSWORD))throw httpError(503,'Email delivery is not configured. Ask the host for help.');
 const id=randomBytes(12).toString('hex');const {pin,fingerprint}=generatePin();
 try{tx(()=>{run('DELETE FROM players WHERE verified=0 AND created_at<?',at()-25*60000);
 run('INSERT INTO players(id,name,email,village_id,role,pin_hash,pin_lookup,consent_email,created_at,pin_sent_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,name,email,village,role,hashPin(pin),fingerprint,payload.consentEmail===true?1:0,at(),at());});}
 catch(e){if(/UNIQUE/i.test(e.message))throw httpError(409,'Email already registered or that role is occupied');throw e;}
 const ok=await sendEmail(email,'Your Digital Village login PIN',`Welcome, ${name}!\n\nYour Digital Village login PIN is: ${pin}\n\nUse your email and PIN to sign in. Keep this PIN private.\n\nThis message is for the educational Digital Village simulation.`);
 if(!ok){run('DELETE FROM players WHERE id=? AND verified=0',id);throw httpError(503,'Could not deliver PIN. Ask the host for an emergency login code.');}
 return {ok:true,message:'Check your email for your personal six-digit PIN.'};
}
function login(email,pin,res,req){email=clean(email).toLowerCase();pin=clean(pin);
 const p=row('SELECT * FROM players WHERE email=?',email);if(!p||!/^\d{6}$/.test(pin))throw httpError(401,'Email or PIN incorrect');
 if(p.locked_until>at())throw httpError(429,'Too many attempts. Wait 15 minutes or ask the host.');
 if(!verifyPin(pin,p.pin_hash)){const attempts=p.attempts+1;run('UPDATE players SET attempts=?,locked_until=? WHERE id=?',attempts,attempts>=5?at()+900000:0,p.id);throw httpError(401,'Email or PIN incorrect');}
 run('UPDATE players SET verified=1,attempts=0,locked_until=0,last_seen=? WHERE id=?',at(),p.id);startSession(res,req,p.id,false);return {ok:true};
}
function currentState(a){advanceWorld();const g=getGame(),villages=all('SELECT * FROM villages');
 const time=roundElapsed(g);const base={privacyContact:process.env.PRIVACY_CONTACT||'',game:{round:g.round,phase:g.phase,elapsedMs:time,durationMs:(ROUNDS[g.round-1]?.duration||0)*1000,newsRevealed:!!g.news_revealed,mediaRevealed:!!g.media_revealed,crisisFired:!!g.crisis_fired},rounds:ROUNDS,villages:villages.map(v=>({...v,budget:Math.round(v.budget),youth:Math.round(v.youth),trust:Math.round(v.trust)})),investments:INVESTMENTS,roles:ROLES,assets:MEDIA_ASSETS.map(x=>({id:x.id,label:x.label,symbol:x.symbol,kind:x.kind,color:x.color,...(g.media_revealed||a?.admin?{allowed:x.allowed}:{})})),events:all('SELECT * FROM events ORDER BY id DESC LIMIT 24'),slots:all('SELECT village_id,role,verified FROM players').map(p=>({village:p.village_id,role:p.role,verified:!!p.verified}))};
 if(!a)return {...base,restricted:true};
 const person=a.player; if(person)run('UPDATE players SET last_seen=? WHERE id=?',at(),person.id);
 const showNews=g.round>=2 || a.admin;
 if(showNews){const mayorByVillage=Object.fromEntries(all("SELECT village_id,name FROM players WHERE role='mayor' AND verified=1").map(x=>[x.village_id,x.name]));
 base.news=all('SELECT * FROM news').map(x=>({id:x.id,sourceVillage:x.source_village,headline:x.headline,body:x.body,signer:x.signer==='OFFICIAL_MAYOR'?(mayorByVillage[x.source_village]||'Official Village Council'):x.signer,seal:x.seal,...(g.news_revealed||a.admin?{authentic:!!x.authentic}:{})}));
 base.choices=all('SELECT * FROM news_choices');}
 base.posts=all('SELECT * FROM posts').map(p=>({...p,assetIds:JSON.parse(p.asset_ids)}));
 if(g.round>=4||a.admin)base.tasks=all('SELECT * FROM tasks');
 base.histories=Object.fromEntries(villages.map(v=>[v.id,all('SELECT at,budget,youth,trust,internet,jobs,services,education FROM snapshots WHERE village_id=? ORDER BY id DESC LIMIT 150',v.id).reverse()]));
 base.people=all('SELECT id,name,village_id,role,verified,last_seen FROM players');
 if(person)base.me=person;
 if(a.admin){base.admin=true;base.outbox=DEV_MAIL?all('SELECT id,email,subject,body,at FROM outbox ORDER BY id DESC LIMIT 50'):[];base.stats={registered:base.people.length,verified:base.people.filter(p=>p.verified).length,active:base.people.filter(p=>p.last_seen>at()-35000).length};}
 return base;
}
function canInvest(p){return ['mayor','finance','digital'].includes(p.role);}
function resolveNews(){const g=getGame();if(g.news_revealed)return;
 for(const v of VILLAGES){const chosen=all('SELECT n.authentic,n.headline FROM news_choices c JOIN news n ON n.id=c.news_id WHERE c.village_id=?',v.id);let delta=0,trust=0;for(const n of chosen){delta+=n.authentic?1:-3;trust+=n.authentic?1:-3;}if(chosen.length){run('UPDATE villages SET youth=MAX(25,youth+?),trust=MAX(0,MIN(100,trust+?)) WHERE id=?',delta,trust,v.id);logEvent(g.round,v.id,'news','News review completed',`Youth ${delta>=0?'+':''}${delta}; trust ${trust>=0?'+':''}${trust}.`);}}
 run('UPDATE game SET news_revealed=1 WHERE id=1');recordBaseline(g.round);
}
function resolveMedia(){const g=getGame();if(g.media_revealed)return;
 for(const p of all('SELECT * FROM posts')){const ids=JSON.parse(p.asset_ids);const violations=ids.filter(id=>MEDIA_ASSETS.some(a=>a.id===id&&!a.allowed)).length;const good=ids.length-violations;
  const budgetDelta=good*650-violations*2500;const trustDelta=good*1-violations*4;const youthDelta=violations?-violations:Math.max(1,Math.round(good/2));
  run('UPDATE villages SET budget=MAX(0,budget+?),trust=MAX(0,MIN(100,trust+?)),youth=MAX(25,youth+?) WHERE id=?',budgetDelta,trustDelta,youthDelta,p.village_id);
  logEvent(g.round,p.village_id,'media','Tourism campaign evaluated',`${violations} problematic asset(s). Budget ${budgetDelta>=0?'+':''}€${budgetDelta}.`);
 }
 run('UPDATE game SET media_revealed=1 WHERE id=1');recordBaseline(g.round);
}
function resolveFestival(){const g=getGame();if(g.festival_resolved)return;
 for(const v of VILLAGES){const tasks=all('SELECT * FROM tasks WHERE village_id=?',v.id);const blue=tasks.filter(t=>t.type==='blue'),red=tasks.filter(t=>t.type==='red');const doneBlue=blue.filter(t=>t.done).length,doneRed=red.filter(t=>t.done).length;
 const success=doneBlue>=3&&doneRed===red.length;const deltaYouth=success?12:doneBlue>=2?3:-8;const deltaBudget=success?12000:doneBlue>=2?1000:-8500;const deltaTrust=success?8:doneBlue>=2?0:-7;
 run('UPDATE villages SET youth=MAX(25,youth+?),budget=MAX(0,budget+?),trust=MAX(0,MIN(100,trust+?)) WHERE id=?',deltaYouth,deltaBudget,deltaTrust,v.id);
 logEvent(4,v.id,'festival',success?'Successful youth festival':doneBlue>=2?'Festival completed with difficulties':'Festival unsuccessful',`Completed ${doneBlue}/${blue.length} standard and ${doneRed}/${red.length} urgent tasks. Youth ${deltaYouth>=0?'+':''}${deltaYouth}.`);
 }
 run('UPDATE game SET festival_resolved=1 WHERE id=1');recordBaseline(4);
}
async function doAction(a,body){const op=clean(body.op),g=getGame(),p=a?.player;
 if(op==='start'||op==='next'||op==='pause'||op==='resume'||op==='grant'||op==='shock'||op==='revealNews'||op==='revealMedia'||op==='triggerTicket'||op==='end'){
  requireAdmin(a);advanceWorld();const g=getGame();
  if(op==='start'||op==='next'){
   if(op==='start'&&g.round!==0)throw httpError(400,'Game already started');
   if(op==='next'&&(g.round<1||g.round>=5))throw httpError(400,'Cannot advance the game');
   if(op==='next'&&g.round===2&&!g.news_revealed)resolveNews();
   if(op==='next'&&g.round===3&&!g.media_revealed)resolveMedia();
   if(op==='next'&&g.round===4&&!g.festival_resolved)resolveFestival();
   const next=g.round+1;
   run("UPDATE game SET round=?,phase='playing',started_at=?,elapsed_ms=0,last_sim_at=?,crisis_fired=0,tickets_fired=0 WHERE id=1",next,at(),at());
   if(next===4)addTasks('blue');
   logEvent(next,null,'round',`Round ${next} started`,ROUNDS[next-1].name);recordBaseline(next);
   if(next===5){const consent=all('SELECT name,email FROM players WHERE verified=1 AND consent_email=1');for(const x of consent){await sendEmail(x.email,'Important: Digital Village account notification',`Hello ${x.name},\n\nA new security message is waiting for you. Review it here: ${process.env.PUBLIC_BASE_URL||'http://localhost:'+PORT}/?security=1\n\nThis is part of the consented Digital Village educational security simulation. No passwords will be requested.`);}run('UPDATE game SET security_sent=1 WHERE id=1');}
  }
  if(op==='pause'&&g.phase==='playing')run("UPDATE game SET phase='paused',elapsed_ms=? WHERE id=1",roundElapsed(g));
  if(op==='resume'&&g.phase==='paused')run("UPDATE game SET phase='playing',started_at=?,last_sim_at=? WHERE id=1",at()-g.elapsed_ms,at());
  if(op==='shock'&&g.round===1&&!g.crisis_fired)tx(()=>applyCrisis(g));
  if(op==='triggerTicket'&&g.round===4&&!g.tickets_fired)tx(()=>{addTasks('red');run('UPDATE game SET tickets_fired=1 WHERE id=1');logEvent(4,null,'crisis','Urgent festival problems reported');});
  if(op==='revealNews'&&g.round>=2)tx(resolveNews);
  if(op==='revealMedia'&&g.round>=3)tx(resolveMedia);
  if(op==='grant'){
   const amount=Number(body.amount),v=clean(body.village);
   if(!VILLAGES.some(x=>x.id===v)||!Number.isFinite(amount)||amount<1||amount>250000)throw httpError(400,'Invalid grant (maximum €250,000)');
   tx(()=>{run('UPDATE villages SET budget=budget+? WHERE id=?',Math.floor(amount),v);logEvent(g.round,v,'grant','Regional investment awarded',`+€${Math.floor(amount).toLocaleString('en-US')} from the game host.`);recordBaseline(g.round);});
  }
  if(op==='end'){if(g.round===4&&!g.festival_resolved)tx(resolveFestival);run("UPDATE game SET phase='ended' WHERE id=1");logEvent(g.round,null,'round','Simulation finished');}
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
  const count=row('SELECT COUNT(*) AS c FROM news_choices WHERE village_id=?',player.village_id).c;if(count>=6)throw httpError(409,'Your village has already selected six articles');
  run('INSERT OR IGNORE INTO news_choices VALUES (?,?)',player.village_id,n.id);return {ok:true};
 }
 if(op==='unchooseNews'){
  if(g.round!==2||g.news_revealed)throw httpError(409,'News selection is closed');
  run('DELETE FROM news_choices WHERE village_id=? AND news_id=?',player.village_id,clean(body.id));return {ok:true};
 }
 if(op==='publish'){
  if(g.round!==3||g.media_revealed)throw httpError(409,'The content editor is closed');
  if(!['mayor','media','advisor-1','advisor-2','advisor-3'].includes(player.role))throw httpError(403,'Ask the media team to publish');
  const title=clean(body.title),content=clean(body.body),ids=Array.isArray(body.assets)?[...new Set(body.assets)].slice(0,5):[];
  if(title.length<5||title.length>100||content.length<20||content.length>1200)throw httpError(400,'Write a title and 20–1200 characters of text');
  if(ids.some(id=>!MEDIA_ASSETS.some(x=>x.id===id)))throw httpError(400,'Invalid assets');
  run('INSERT INTO posts VALUES(?,?,?,?,?) ON CONFLICT(village_id) DO UPDATE SET title=excluded.title,body=excluded.body,asset_ids=excluded.asset_ids,updated_at=excluded.updated_at',player.village_id,title,content,JSON.stringify(ids),at());return {ok:true};
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
  const bonus=player.role===t.required_role?7:3;run('UPDATE tasks SET progress=MIN(100,progress+?),done=CASE WHEN progress+?>=100 THEN 1 ELSE done END WHERE id=?',bonus,bonus,t.id);logEvent(4,player.village_id,'help',`${player.name} assisted with ${t.title}`,`${player.id}:${t.id}`);return {ok:true};
 }
 throw httpError(400,'Unknown action');
}
const json=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
async function bodyJson(req){let s='';for await(const chunk of req){s+=chunk;if(s.length>45000)throw httpError(413,'Request too large');}try{return JSON.parse(s||'{}');}catch{throw httpError(400,'Invalid JSON');}}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
async function handler(req,res){try{
 const url=new URL(req.url,'http://localhost'),path=url.pathname;
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 if(path.startsWith('/api/')){
  const a=auth(req);
  if(req.method==='GET'&&path==='/api/state')return json(res,200,currentState(a));
  if(req.method!=='POST')throw httpError(405,'Method not allowed');
  const origin=req.headers.origin;if(origin){const o=new URL(origin);const expected=(process.env.PUBLIC_BASE_URL?new URL(process.env.PUBLIC_BASE_URL).host:req.headers.host);if(o.host!==expected)throw httpError(403,'Invalid request origin');}
  const b=await bodyJson(req);
  if(path==='/api/register'){throttle(req,'register',12,3600000);return json(res,200,await register(b));}
  if(path==='/api/login'){throttle(req,'login',30,900000);return json(res,200,login(b.email,b.pin,res,req));}
  if(path==='/api/admin/login'){
   throttle(req,'admin',6,900000);
   const inp=Buffer.from(clean(b.password)),exp=Buffer.from(ADMIN_PASSWORD);
   if(inp.length!==exp.length||!timingSafeEqual(inp,exp))throw httpError(401,'Invalid host password');
   startSession(res,req,null,true);return json(res,200,{ok:true});
  }
  if(path==='/api/logout'){const token=parseCookie(req);if(token)run('DELETE FROM sessions WHERE token_hash=?',sha(token));res.setHeader('Set-Cookie','dv_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');return json(res,200,{ok:true});}
  if(path==='/api/action')return json(res,200,await doAction(a,b));
  if(path==='/api/admin/delete-data'){
   requireAdmin(a);throttle(req,'wipe-data',3,3600000);
   if(b.confirm!=='DELETE ALL PLAYER DATA')throw httpError(400,'Confirmation mismatch');
   const got=Buffer.from(clean(b.password)),expected=Buffer.from(ADMIN_PASSWORD);
   if(got.length!==expected.length||!timingSafeEqual(got,expected))throw httpError(403,'Host password is incorrect');
   tx(()=>{for(const table of ['news_choices','posts','tasks','investments','snapshots','events','outbox','sessions','players'])run(`DELETE FROM ${table}`);for(const v of VILLAGES)run('UPDATE villages SET budget=?,youth=?,internet=?,education=?,services=?,jobs=?,trust=? WHERE id=?',v.budget,v.youth,v.internet,v.education,v.services,v.jobs,v.trust,v.id);run("UPDATE game SET round=0,phase='waiting',started_at=0,elapsed_ms=0,last_sim_at=0,crisis_fired=0,tickets_fired=0,news_revealed=0,media_revealed=0,festival_resolved=0,security_sent=0 WHERE id=1");});
   res.setHeader('Set-Cookie','dv_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
   return json(res,200,{ok:true});
  }
  if(path==='/api/admin/issue-pin'){
   requireAdmin(a);const p=row('SELECT id,email FROM players WHERE id=?',clean(b.playerId));if(!p)throw httpError(404,'Player not found');
   const pin=tx(()=>newPin(p.id));logEvent(getGame().round,null,'admin','Emergency PIN issued',`Recovery requested for account ${p.id}.`);
   return json(res,200,{ok:true,pin,email:p.email});
  }
  if(path==='/api/resend'){
   throttle(req,'resend',6,900000);const email=clean(b.email).toLowerCase();const p=row('SELECT * FROM players WHERE email=?',email);
   if(p&&at()-p.pin_sent_at>90000){
    const pin=tx(()=>newPin(p.id));
    const sent=await sendEmail(p.email,'Your Digital Village login PIN',`Your new Digital Village login PIN is ${pin}. Keep it private.`);
    if(!sent)run('UPDATE players SET pin_hash=?,pin_lookup=?,pin_sent_at=?,attempts=?,locked_until=? WHERE id=?',p.pin_hash,p.pin_lookup,p.pin_sent_at,p.attempts,p.locked_until,p.id);
   }
   return json(res,200,{ok:true,message:'If your email is registered, a new PIN has been sent.'});
  }
  throw httpError(404,'Unknown endpoint');
 }
 if(req.method!=='GET'&&req.method!=='HEAD')throw httpError(405,'Method not allowed');
 const file=path==='/'?'index.html':path.slice(1);
 if(!['index.html','app.js','style.css','favicon.svg'].includes(file))throw httpError(404,'Not found');
 const content=await readFile(join(ROOT,'public',file));res.writeHead(200,{'Content-Type':mime[extname(file)],'Cache-Control':file==='index.html'?'no-store':'public, max-age=120','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:content);
 }catch(e){const code=e.status||500;if(code>=500)console.error(e);json(res,code,{error:code>=500?'Server error':e.message});}}
const server=createServer(handler);
if(process.env.NODE_ENV!=='test')server.listen(PORT,HOST,()=>console.log(`Digital Village listening at http://${HOST}:${PORT}; dev email outbox: ${DEV_MAIL?'on':'off'}`));
export {handler,server,db,advanceWorld};