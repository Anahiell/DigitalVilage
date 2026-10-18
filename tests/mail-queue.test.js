import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMailer} from '../mailer.js';
import {createMailQueue} from '../mail-queue.js';
const secret='persistent-mail-queue-secret-0123456789';
const message={to:'test@example.invalid',subject:'PIN',body:'Your PIN is: 654321',kind:'pin'};
const env={RESEND_API_KEY:'synthetic-key',EMAIL_FROM:'Village <village@example.invalid>'};

async function temporary(t){const directory=await mkdtemp(join(tmpdir(),'dv-queue-'));t.after(()=>rm(directory,{recursive:true,force:true}));return join(directory,'world.db');}

test('encrypted mail survives reopening SQLite and retries with the same provider key exactly once after acceptance',async t=>{
 const path=await temporary(t),requests=[],logs=[];let clock=1000000;
 let db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL;');
 const first=createMailer({env,record:entry=>logs.push(entry),wait:async()=>{},request:async(url,options)=>{requests.push(options.headers['Idempotency-Key']);return new Response('{}',{status:503});}});
 let queue=createMailQueue({db,secret,mailer:first,record:entry=>logs.push(entry),now:()=>clock});
 const id=queue.enqueue(message,{playerId:'player',pinLookup:'fingerprint'});
 assert.equal((await queue.wait(id)).status,'queued');assert.equal(requests.length,2);
 assert.equal(db.prepare('SELECT cycles FROM mail_jobs').get().cycles,1);
 assert.equal(db.prepare('SELECT payload FROM mail_jobs').get().payload.includes(message.body),false);
 assert.equal(JSON.stringify(logs).includes('654321'),false);
 await queue.drain();assert.equal(requests.length,2,'Retry respects the persisted backoff.');
 queue.close();db.close();
 assert.equal((await readFile(path)).includes(Buffer.from(message.body)),false);
 db=new DatabaseSync(path);db.exec('CREATE TABLE confirmations(value TEXT);');
 const next=createMailer({env,record:entry=>logs.push(entry),wait:async()=>{},request:async(url,options)=>{requests.push(options.headers['Idempotency-Key']);assert.equal(JSON.parse(options.body).text,message.body);return new Response(JSON.stringify({id:'provider-message'}),{status:200});}});
 queue=createMailQueue({db,secret,mailer:next,now:()=>clock,onAccepted:()=>db.prepare('INSERT INTO confirmations VALUES(?)').run('confirmed')});
 clock+=10001;await queue.drain();await queue.drain();
 assert.equal(requests.length,3);assert.ok(requests.every(key=>key===id));
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM confirmations').get().n,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mail_jobs').get().n,0);
 assert.equal(logs.at(-1).providerId,'provider-message');assert.equal(logs.at(-1).attempts,3);
 queue.close();db.close();
});

test('permanent errors stop, expired jobs do not send, host recovery cancels pending PINs and a wrong key fails safely',async t=>{
 const path=await temporary(t),db=new DatabaseSync(path);t.after(()=>db.close());let clock=0,sends=0;const failures=[];
 const mailer={config:{real:true,mode:'smtp'},async sendDetailed(){sends++;return {ok:false,retryable:false,code:'recipient_rejected',attempts:1};}};
 let queue=createMailQueue({db,secret,mailer,now:()=>clock,maxAge:100,onFailed:(context,code)=>failures.push({context,code})});
 const rejected=queue.enqueue(message,{playerId:'one'});assert.equal((await queue.wait(rejected)).status,'failed');await queue.drain();assert.equal(sends,1);
 queue.enqueue(message,{playerId:'two'});clock=101;await queue.drain();assert.equal(sends,1);assert.equal(failures.at(-1).code,'queue_expired');
 queue.enqueue(message,{playerId:'three'});assert.equal(queue.pendingPlayer('three'),true);queue.cancelPlayer('three');assert.equal(queue.pendingPlayer('three'),false);await queue.drain();assert.equal(sends,1);
 queue.enqueue(message,{playerId:'four',pinLookup:'new-fingerprint'});queue.close();
 queue=createMailQueue({db,secret:secret+'changed',mailer,onFailed:(context,code)=>failures.push({context,code})});await queue.drain();
 assert.equal(sends,1);assert.equal(failures.at(-1).code,'queue_key_or_payload_invalid');assert.equal(failures.at(-1).context.playerId,'four');
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mail_jobs').get().n,0);queue.close();
});

test('a provider acknowledgment followed by a failed local transaction is recovered without a partial PIN update',async t=>{
 const path=await temporary(t),db=new DatabaseSync(path);t.after(()=>db.close());db.exec('CREATE TABLE confirmation(value TEXT);');let failures=0,requests=0,crash=true;const keys=[];
 const mailer=createMailer({env,wait:async()=>{},request:async(url,options)=>{requests++;keys.push(options.headers['Idempotency-Key']);return new Response('{"id":"same-provider-id"}',{status:200});}});
 const queue=createMailQueue({db,secret,mailer,onError:()=>failures++,onAccepted:()=>{db.exec("INSERT INTO confirmation VALUES('new PIN')");if(crash)throw Error('Synthetic interruption before commit');}});
 const id=queue.enqueue(message);assert.equal((await queue.wait(id)).status,'queued');assert.equal(failures,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM confirmation').get().n,0,'The whole local acknowledgment transaction rolls back.');
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mail_jobs').get().n,1);
 crash=false;await queue.drain();assert.equal(db.prepare('SELECT COUNT(*) AS n FROM confirmation').get().n,1);
 assert.equal(requests,2);assert.equal(keys[0],keys[1]);queue.close();
});

test('a saved real email cannot be silently diverted into rehearsal after a configuration change',async t=>{
 const path=await temporary(t),db=new DatabaseSync(path);t.after(()=>db.close());let fakeSent=0;
 const queue1=createMailQueue({db,secret,mailer:{config:{real:true,mode:'smtp'}}});queue1.enqueue(message);queue1.close();
 const queue2=createMailQueue({db,secret,mailer:{config:{real:false,mode:'rehearsal'},async sendDetailed(){fakeSent++;return {ok:true};}}});
 await queue2.drain();assert.equal(fakeSent,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mail_jobs').get().n,1);queue2.close();
});

test('expiry takes priority over a later retry deadline',async t=>{
 const path=await temporary(t),db=new DatabaseSync(path);t.after(()=>db.close());let clock=0,sends=0,expired=false;
 const queue=createMailQueue({db,secret,now:()=>clock,maxAge:100,mailer:{config:{real:true,mode:'smtp'},async sendDetailed(){sends++;return {ok:false,retryable:true,code:'connection_failed',attempts:1};}},onFailed:(context,code)=>{expired=code==='queue_expired';}});
 const id=queue.enqueue(message);await queue.wait(id);assert.ok(db.prepare('SELECT next_at FROM mail_jobs').get().next_at>100);
 clock=101;await queue.drain();assert.equal(sends,1);assert.equal(expired,true);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mail_jobs').get().n,0);queue.close();
});

test('a failed terminal audit cannot delete a registration and then report a nonexistent saved request',async t=>{
 const path=await temporary(t),db=new DatabaseSync(path);t.after(()=>db.close());db.exec("CREATE TABLE registrations(id TEXT);INSERT INTO registrations VALUES('person');");let auditBroken=true;
 const queue=createMailQueue({db,secret,mailer:{config:{real:true,mode:'smtp'},async sendDetailed(){return {ok:false,retryable:false,code:'recipient_rejected',attempts:1};}},record:entry=>{if(entry.status==='failed'&&auditBroken)throw Error('Synthetic audit failure');},onFailed:()=>db.exec('DELETE FROM registrations')});
 const id=queue.enqueue(message);assert.equal((await queue.wait(id)).status,'queued');
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM registrations').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mail_jobs').get().n,1);
 auditBroken=false;await queue.drain();assert.equal(db.prepare('SELECT COUNT(*) AS n FROM registrations').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mail_jobs').get().n,0);queue.close();
});

test('an exercise batch reserves a dispatch slot for a newly requested PIN and queued PINs go first',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const started=[],release=[];
 const mailer={config:{real:true,mode:'smtp'},async sendDetailed(mail){started.push(mail.kind);await new Promise(resolve=>release.push(resolve));return {ok:true,attempts:1};}};
 const queue=createMailQueue({db,secret,mailer});t.after(()=>queue.close());
 const exercises=Array.from({length:4},()=>queue.enqueue({...message,kind:'exercise'}));
 const active=exercises.slice(0,3).map(id=>queue.wait(id));
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(started,['exercise','exercise','exercise']);
 assert.equal((await queue.wait(exercises[3])).status,'queued');
 const pin=queue.enqueue(message),pinWork=queue.wait(pin);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(started.at(-1),'pin');assert.equal(queue.active,4);
 release.splice(0).forEach(done=>done());await Promise.all([...active,pinWork]);
 queue.enqueue(message);const drained=queue.drain();
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(started.slice(4),['pin','exercise'],'A newer PIN starts before the older saved exercise.');
 release.splice(0).forEach(done=>done());await drained;
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mail_jobs').get().n,0);
});

test('queue safety checks the selected exercise sender rather than assuming PIN configuration',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let sent=0,available=true;
 const mailer={config:{real:true,mode:'smtp'},configFor:kind=>({real:kind==='exercise'?available:true,mode:'smtp'}),async sendDetailed(){sent++;return {ok:true,attempts:1};}};
 const queue=createMailQueue({db,secret,mailer});t.after(()=>queue.close());
 const id=queue.enqueue({...message,kind:'exercise'});available=false;
 assert.equal((await queue.wait(id)).status,'queued');assert.equal(sent,0);
 assert.equal((await queue.wait(queue.enqueue(message))).status,'accepted');assert.equal(sent,1);
});
