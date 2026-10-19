import {fileURLToPath} from 'node:url';
// Rehearsal load test: 30 users on one IP, no real mail or production data.
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomInt} from 'node:crypto';
import assert from 'node:assert/strict';
import {VILLAGES,ROLES} from '../data.js';
const hourly=process.env.DV_LOAD_HOUR==='1',pollLat=[];
const temp=await mkdtemp(join(tmpdir(),'dv-load-')),port=randomInt(32000,55000);
const base='http://127.0.0.1:'+port,pass='admin-test-password-0123456789';
const child=spawn(process.execPath,['server.js'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DB_PATH:join(temp,'test.db'),NODE_ENV:'development',ADMIN_PASSWORD:pass,PIN_PEPPER:'load-pepper-12345678901234567890',DEV_EMAIL_OUTBOX:'1',SMTP_EMAIL:'',SMTP_APP_PASSWORD:'',RESEND_API_KEY:'',EMAIL_FROM:'',EXERCISE_SMTP_EMAIL:'',EXERCISE_SMTP_APP_PASSWORD:'',PUBLIC_BASE_URL:base},stdio:['ignore','pipe','pipe']});
let err='',reqs=0;const lat=[];child.stderr.on('data',b=>err+=b);
const api=async(route,body,cookie,status=200)=>{const tick=performance.now();const r=await fetch(base+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();lat.push(performance.now()-tick);if(route==='state')pollLat.push(performance.now()-tick);reqs++;assert.equal(r.status,status,route+': '+JSON.stringify(d));return {...d,cookie:r.headers.get('set-cookie')?.split(';')[0]};};
try{
 let online=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok){online=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}assert.ok(online,err);
 const admin=(await api('admin/login',{password:pass})).cookie;
 const users=Array.from({length:30},(_,i)=>({name:'Participant '+i,email:'load'+i+'@example.invalid',village:VILLAGES[Math.floor(i/8)].id,role:ROLES[i%8].id,consentEmail:false}));
 await Promise.all(users.map(u=>api('register',u)));
 await api('register',{...users[0],email:'duplicate@example.invalid'},undefined,409);
 const messages=(await api('state',undefined,admin)).outbox;assert.equal(messages.length,30);
 const pins=Object.fromEntries(messages.map(m=>[m.email,m.body.split('PIN is: ')[1].slice(0,6)]));
 const logins=await Promise.all(users.map(async u=>({user:u,cookie:(await api('login',{email:u.email,pin:pins[u.email]})).cookie})));
 await api('action',{op:'start',workshopMode:hourly},admin);
 for(let wave=0;wave<8;wave++){if(hourly&&wave)await new Promise(r=>setTimeout(r,1000));const data=await Promise.all(logins.map(u=>api('state',undefined,u.cookie)));assert.ok(data.every(s=>s.game.round===1))}
 const mayor=logins.find(l=>l.user.role==='mayor');await api('action',{op:'invest',id:'fiber'},mayor.cookie);await api('action',{op:'grant',amount:3000,village:'green-valley'},admin);
 for(let r=2;r<=5;r++){await api('action',{op:'next'},admin);const data=await Promise.all(logins.map(u=>api('state',undefined,u.cookie)));assert.ok(data.every(s=>s.game.round===r))}
 const state=await api('state',undefined,admin);assert.equal(state.stats.verified,30);
 await api('action',{op:'pause'},admin);const paused=await Promise.all(logins.map(u=>api('state',undefined,u.cookie)));assert.ok(paused.every(s=>s.game.phase==='paused'));
 await api('action',{op:'resume'},admin);await api('action',{op:'end'},admin);
 const final=await Promise.all(logins.map(u=>api('state',undefined,u.cookie)));assert.ok(final.every(s=>s.finalReport?.player.name===s.me.name));
 await Promise.all(logins.map(u=>api('action',{op:'acknowledgeReport'},u.cookie)));
 const sessionId=final[0].game.sessionId;
 // Wait for the exercise batch to finish before reset; all traffic remains local.
 for(let n=0;n<60;n++){if((await api('state',undefined,admin)).mailQueue.pending===0)break;await new Promise(r=>setTimeout(r,100));}
 const reset={confirm:'RESET FINISHED GAME',password:pass,sessionId};
 await api('admin/reset-game',reset,admin);await api('admin/reset-game',reset,admin,409);
 const archives=await Promise.all(logins.map(u=>api('final-report',undefined,u.cookie)));assert.ok(archives.every((r,i)=>r.player.name===logins[i].user.name));
 assert.equal((await api('state',undefined,admin)).stats.registered,0);
 lat.sort((a,b)=>a-b);pollLat.sort((a,b)=>a-b);const p=n=>Number(lat[Math.ceil(lat.length*n/100)-1].toFixed(1));
 console.log(JSON.stringify({players:30,hourProfile:hourly,pollIntervalMs:hourly?1000:null,stateP95Ms:Number(pollLat[Math.ceil(pollLat.length*.95)-1].toFixed(1)),requests:reqs,errors:0,p50Ms:p(50),p95Ms:p(95),p99Ms:p(99),maxMs:p(100),sharedIp:true,passed:true},null,2));
}catch(e){console.error(e.stack,err);process.exitCode=1}
finally{child.kill();await new Promise(r=>setTimeout(r,200));await rm(temp,{recursive:true,force:true});}
