import test from 'node:test';
import assert from 'node:assert/strict';
import {createMailer,createWorkshopMailer,mailConfiguration} from '../mailer.js';
const smtpEnv={SMTP_EMAIL:'sender@example.invalid',SMTP_APP_PASSWORD:'synthetic-value'};

test('real SMTP retries a transient error and never falls back to a fake outbox',async()=>{
 let calls=0,outbox=0;const logs=[];
 const mail=createMailer({env:{...smtpEnv,DEV_EMAIL_OUTBOX:'1'},record:entry=>logs.push(entry),writeOutbox:()=>outbox++,wait:async()=>{},transportFactory:()=>({async sendMail(message){calls++;if(calls===1)throw Object.assign(Error('Temporary failure'),{responseCode:451});return {accepted:[message.to],messageId:'accepted'};}})});
 assert.equal(await mail.send({to:'person@example.invalid',subject:'PIN',body:'123456'}),true);assert.equal(calls,2);assert.equal(outbox,0);assert.equal(logs.at(-1).status,'accepted');assert.equal(logs.at(-1).attempts,2);assert.equal(JSON.stringify(logs).includes('123456'),false);
});
test('permanent authentication failure is visible and cannot pretend delivery',async()=>{
 const logs=[];let outbox=0;
 const mail=createMailer({env:{...smtpEnv,DEV_EMAIL_OUTBOX:'1'},record:entry=>logs.push(entry),writeOutbox:()=>outbox++,transportFactory:()=>({async sendMail(){throw Object.assign(Error('Invalid login'),{code:'EAUTH'});}})});
 assert.equal(await mail.send({to:'person@example.invalid',subject:'PIN',body:'123456'}),false);assert.equal(outbox,0);assert.equal(logs.at(-1).code,'authentication_failed');
});
test('HTTP retries reuse one idempotency key; configured SMTP is a real fallback',async()=>{
 const requests=[],logs=[];let calls=0;
 const env={...smtpEnv,RESEND_API_KEY:'synthetic-key',EMAIL_FROM:'Workshop <game@example.invalid>'};
 const mail=createMailer({env,record:entry=>logs.push(entry),wait:async()=>{},request:async(url,options)=>{requests.push({url,options});calls++;return new Response(JSON.stringify({message:'Transient failure'}),{status:503});},transportFactory:()=>({async sendMail(message){return {accepted:[message.to]};}})});
 assert.equal(await mail.send({to:'person@example.invalid',subject:'PIN',body:'654321'}),true);assert.equal(calls,2);assert.equal(requests[0].options.headers['Idempotency-Key'],requests[1].options.headers['Idempotency-Key']);assert.equal(requests[0].url,'https://api.resend.com/emails');assert.equal(JSON.parse(requests[0].options.body).text,'654321');assert.equal(logs.at(-1).provider,'smtp');
});
test('only an explicit rehearsal configuration creates test mail',async()=>{
 let outbox=0;const mail=createMailer({env:{DEV_EMAIL_OUTBOX:'1'},writeOutbox:()=>outbox++});assert.equal(await mail.send({to:'person@example.invalid',subject:'PIN',body:'123456'}),true);assert.equal(outbox,1);
 assert.equal(mailConfiguration({RESEND_API_KEY:'partial'}).configured,false);assert.ok(mailConfiguration({RESEND_API_KEY:'partial'}).issues.length);
});

test('a local audit failure after provider acceptance does not become a permanent email rejection or trigger another provider',async()=>{
 let fallback=0;const mail=createMailer({env:{...smtpEnv,...{RESEND_API_KEY:'synthetic-key',EMAIL_FROM:'Village <village@example.invalid>'}},request:async()=>new Response('{"id":"accepted-id"}',{status:200}),record:entry=>{if(entry.status==='accepted')throw Error('Synthetic audit database failure');},transportFactory:()=>({async sendMail(){fallback++;return {accepted:['person@example.invalid']};}})});
 await assert.rejects(mail.sendDetailed({to:'person@example.invalid',subject:'PIN',body:'654321'}),/Synthetic audit/);assert.equal(fallback,0);
});

test('PINs and opted-in exercise mail use their selected accounts, including sender-specific tests',async()=>{
 const sent=[],env={...smtpEnv,EXERCISE_SMTP_EMAIL:'teaching@example.invalid',EXERCISE_SMTP_APP_PASSWORD:'synthetic-teaching-password'};
 const mail=createWorkshopMailer({env,transportFactory:config=>({async sendMail(message){sent.push({account:config.auth.user,...message});return {accepted:[message.to]};}})});
 assert.equal(mail.exerciseSeparate,true);
 for(const kind of ['pin','exercise','exercise-test','test'])assert.equal(await mail.send({to:'person@example.invalid',subject:'Workshop',body:'Synthetic test',kind}),true);
 assert.deepEqual(sent.map(m=>m.account),[smtpEnv.SMTP_EMAIL,env.EXERCISE_SMTP_EMAIL,env.EXERCISE_SMTP_EMAIL,smtpEnv.SMTP_EMAIL]);
 assert.ok(sent.every(m=>m.from.includes(m.account)));
 const shared=createWorkshopMailer({env:smtpEnv});assert.equal(shared.exerciseRequested,false);assert.equal(shared.exerciseSeparate,false);assert.equal(shared.configFor('exercise').real,true);
 const same=createWorkshopMailer({env:{...env,EXERCISE_SMTP_EMAIL:smtpEnv.SMTP_EMAIL}});assert.equal(same.exerciseSeparate,false);
});

test('broken or incomplete separate exercise credentials never fall back into the PIN sender',async()=>{
 let primary=0,teaching=0;
 const options={env:{...smtpEnv,RESEND_API_KEY:'synthetic-api-key',EMAIL_FROM:'PIN <pin@example.invalid>',EXERCISE_SMTP_EMAIL:'teaching@example.invalid',EXERCISE_SMTP_APP_PASSWORD:'synthetic-teaching-password'},request:async()=>{primary++;return new Response('{"id":"accepted"}');},transportFactory:()=>({async sendMail(){teaching++;throw Object.assign(Error('Synthetic rejected teaching account'),{code:'EAUTH'});}})};
 const mail=createWorkshopMailer(options),message={to:'person@example.invalid',subject:'Exercise',body:'Synthetic test',kind:'exercise'};
 assert.equal(await mail.send(message),false);assert.equal(primary,0);assert.equal(teaching,1);
 assert.equal(await mail.send({...message,kind:'pin'}),true);assert.equal(primary,1);
 const incomplete=createWorkshopMailer({...options,env:{...options.env,EXERCISE_SMTP_APP_PASSWORD:''}});
 assert.equal(incomplete.exerciseRequested,true);assert.equal(incomplete.configFor('exercise').real,false);
 assert.equal(await incomplete.send(message),false);assert.equal(primary,1);assert.equal(teaching,1);
});
