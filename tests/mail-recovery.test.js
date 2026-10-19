import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {rehearsal} from './helpers.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let n=0;n<120;n++){if(check())return;await sleep(50);}assert.fail('Mail state did not reach the expected checkpoint.');}

test('registration and PIN replacement recover after process termination; host rescue supersedes delayed mail',async t=>{
 const app=await rehearsal(t);await app.stop();const db=new DatabaseSync(app.dbPath);t.after(()=>db.close());
 const capture=app.dbPath+'.capture',real={DEV_EMAIL_OUTBOX:'0',SMTP_EMAIL:'synthetic@example.invalid',SMTP_APP_PASSWORD:'synthetic-password',DV_SYNTHETIC_MAIL_CAPTURE:capture};
 await app.start({...real,DV_SYNTHETIC_SMTP_MODE:'hold'},true);
 const registration=app.request('/api/register',{name:'Recovery Participant',email:'recover@test.example',village:'green-valley',role:'mayor'}).catch(()=>null);
 await until(()=>db.prepare("SELECT 1 FROM mail_deliveries WHERE status='sending'").get());
 const firstJob=db.prepare('SELECT id,payload FROM mail_jobs').get();assert.ok(firstJob);
 await app.stop();await registration;
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM players').get().n,1);
 await app.start({...real,DV_SYNTHETIC_SMTP_MODE:'success'},true);
 await until(()=>db.prepare('SELECT COUNT(*) AS n FROM mail_jobs').get().n===0);
 let messages=(await readFile(capture,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(messages.length,1);assert.match(messages[0].messageId,new RegExp(firstJob.id));
 const firstPin=messages[0].text.match(/PIN is: (\d{6})/)[1];
 assert.equal(firstJob.payload.includes(firstPin),false);
 assert.equal((await app.request('/api/login',{email:'recover@test.example',pin:firstPin})).status,200);
 db.exec('UPDATE players SET pin_sent_at=pin_sent_at-91000');
 await app.stop();await app.start({...real,DV_SYNTHETIC_SMTP_MODE:'hold'},true);
 const resend=app.request('/api/resend',{email:'recover@test.example'}).catch(()=>null);
 await until(()=>db.prepare('SELECT COUNT(*) AS n FROM mail_jobs').get().n===1);
 const secondJob=db.prepare('SELECT id FROM mail_jobs').get().id;
 assert.equal((await app.request('/api/login',{email:'recover@test.example',pin:firstPin})).status,200,'Existing PIN remains usable while a replacement is being sent.');
 await app.stop();await resend;
 await app.start({...real,DV_SYNTHETIC_SMTP_MODE:'success'},true);
 await until(()=>db.prepare('SELECT COUNT(*) AS n FROM mail_jobs').get().n===0);
 messages=(await readFile(capture,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(messages.length,2);assert.match(messages[1].messageId,new RegExp(secondJob));
 const nextPin=messages[1].text.match(/PIN is: (\d{6})/)[1];assert.notEqual(nextPin,firstPin);
 assert.equal((await app.request('/api/login',{email:'recover@test.example',pin:nextPin})).status,200);
 assert.equal((await app.request('/api/login',{email:'recover@test.example',pin:firstPin})).status,401);
 db.exec('UPDATE players SET pin_sent_at=pin_sent_at-91000');
 await app.stop();await app.start({...real,DV_SYNTHETIC_SMTP_MODE:'transient'},true);
 const pending=await app.request('/api/resend',{email:'recover@test.example'});assert.equal(pending.status,202);assert.equal(pending.data.queued,true);assert.match(pending.data.message,/previous PIN still works/);
 const admin=(await app.request('/api/admin/login',{password:app.password})).cookie;
 const state=(await app.request('/api/state',undefined,admin)).data;assert.equal(state.mailQueue.pending,1);assert.equal(state.mailDeliveries[0].status,'queued');
 assert.equal((await app.request('/api/resend',{email:'recover@test.example'})).status,429);
 const rescued=await app.request('/api/admin/issue-pin',{playerId:db.prepare('SELECT id FROM players').get().id},admin);assert.equal(rescued.status,200);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mail_jobs').get().n,0);assert.equal((await app.request('/api/login',{email:'recover@test.example',pin:rescued.data.pin})).status,200);
 await app.stop();await app.start({...real,DV_SYNTHETIC_SMTP_MODE:'success'},true);await sleep(1100);
 messages=(await readFile(capture,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(messages.length,2,'Cancelled replacement is never sent later.');
 const deliveries=(await app.request('/api/state',undefined,admin)).data.mailDeliveries;assert.ok(deliveries.some(d=>d.status==='cancelled'&&d.error_code==='host_recovery'));
});

test('a queued registration keeps its place, expires visibly and releases the role without sending stale mail',async t=>{
 const app=await rehearsal(t);await app.stop();const db=new DatabaseSync(app.dbPath);t.after(()=>db.close());
 await app.start({DEV_EMAIL_OUTBOX:'0',SMTP_EMAIL:'synthetic@example.invalid',SMTP_APP_PASSWORD:'synthetic-password',DV_SYNTHETIC_SMTP_MODE:'transient'},true);
 const person={name:'Delayed Participant',email:'delay@test.example',village:'riverstone',role:'mayor'};
 const result=await app.request('/api/register',person);assert.equal(result.status,202);assert.equal(result.data.queued,true);assert.match(result.data.message,/Do not register again/);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM players').get().n,1);
 assert.equal((await app.request('/api/register',{...person,email:'other@test.example'})).status,409);
 const publicState=(await app.request('/api/state')).data;assert.equal(publicState.mailQueue,undefined);assert.equal(publicState.mailDeliveries,undefined);
 db.exec('UPDATE mail_jobs SET expires_at=0,next_at=0');
 await until(()=>db.prepare('SELECT COUNT(*) AS n FROM mail_jobs').get().n===0);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM players').get().n,0);
 const admin=(await app.request('/api/admin/login',{password:app.password})).cookie;
 assert.equal((await app.request('/api/state',undefined,admin)).data.mailDeliveries[0].status,'expired');
 const enrolled=await app.request('/api/admin/enrol',{...person,present:true},admin);assert.equal(enrolled.status,200);
 assert.equal((await app.request('/api/login',{email:person.email,pin:enrolled.data.pin})).status,200);
});

test('successful host diagnostics do not exhaust login attempts; incorrect passwords remain limited',async t=>{
 const app=await rehearsal(t);
 for(let n=0;n<10;n++)assert.equal((await app.request('/api/admin/login',{password:app.password})).status,200);
 for(let n=0;n<6;n++)assert.equal((await app.request('/api/admin/login',{password:'incorrect-password'})).status,401);
 assert.equal((await app.request('/api/admin/login',{password:'incorrect-password'})).status,429);
 assert.equal((await app.request('/api/admin/login',{password:app.password})).status,200);
});

test('real-mode registration, both sender tests and round-five exercise for everyone use the correct synthetic SMTP accounts',async t=>{
 const app=await rehearsal(t);await app.stop();const capture=app.dbPath+'.capture',db=new DatabaseSync(app.dbPath);t.after(()=>db.close());
 const primary='pins@example.invalid',exercise='teaching@example.invalid';
 await app.start({DEV_EMAIL_OUTBOX:'0',SMTP_EMAIL:primary,SMTP_APP_PASSWORD:'synthetic-pin-password',EXERCISE_SMTP_EMAIL:exercise,EXERCISE_SMTP_APP_PASSWORD:'synthetic-exercise-password',DV_SYNTHETIC_SMTP_MODE:'success',DV_SYNTHETIC_MAIL_CAPTURE:capture},true);
 const readMail=async()=>(await readFile(capture,'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal((await app.request('/api/register',{name:'Consenting Participant',email:'consent@test.example',village:'green-valley',role:'mayor',consentEmail:true})).status,200);
 const registration=(await readMail())[0];assert.ok(registration.from.includes(primary));
 assert.equal((await app.request('/api/login',{email:'consent@test.example',pin:registration.text.match(/PIN is: (\d{6})/)[1]})).status,200);
 const admin=(await app.request('/api/admin/login',{password:app.password})).cookie;
 const other=await app.request('/api/admin/enrol',{name:'No Email Exercise',email:'no-consent@test.example',village:'riverstone',role:'mayor',present:true,consentEmail:false},admin);
 assert.equal((await app.request('/api/login',{email:other.data.email,pin:other.data.pin})).status,200);
 assert.equal((await app.request('/api/admin/test-email',{email:'owner@test.example',sender:'exercise'},admin)).status,200);
 assert.equal((await app.request('/api/admin/test-email',{email:'owner@test.example',sender:'pin'},admin)).status,200);
 const state=(await app.request('/api/state',undefined,admin)).data;assert.equal(state.mailConfiguration.exercise.separate,true);assert.equal(state.mailConfiguration.exercise.real,true);assert.equal(JSON.stringify(state).includes('synthetic-exercise-password'),false);
 assert.equal((await app.request('/api/state')).data.mailConfiguration,undefined);
 assert.equal((await app.request('/api/action',{op:'start'},admin)).status,200);
 for(let n=0;n<4;n++)assert.equal((await app.request('/api/action',{op:'next'},admin)).status,200);
 await until(()=>db.prepare("SELECT COUNT(*) AS n FROM mail_deliveries WHERE kind='exercise' AND status='accepted'").get().n===2);
 const sent=await readMail();assert.equal(sent.length,5);
 const exercises=sent.slice(3);assert.ok(exercises.every(m=>m.from===`Digital Village <${exercise}>`));
 assert.deepEqual(exercises.map(m=>m.to).sort(),['consent@test.example','no-consent@test.example']);
 assert.ok(exercises.every(m=>m.text.includes('/phishing')&&m.text.includes('No passwords will be requested')));
 const reveal=await app.request('/phishing');assert.equal(reveal.status,200);assert.match(reveal.data,/Это был фишинг/);

});
