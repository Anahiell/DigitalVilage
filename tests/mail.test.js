import test from 'node:test';
import assert from 'node:assert/strict';
import {createMailer,mailConfiguration} from '../mailer.js';
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
