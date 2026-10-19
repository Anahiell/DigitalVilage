import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {chromium,expect} from '@playwright/test';

test('browser participant tab, readiness, personal link tracking and resend',{timeout:45000},async t=>{
 const base='http://localhost:43111';
 Object.assign(process.env,{NODE_ENV:'test',DB_PATH:':memory:',ADMIN_PASSWORD:'browser-monitor-admin-0123456789',PIN_PEPPER:'browser-monitor-pepper-0123456789',DEV_EMAIL_OUTBOX:'1',SMTP_EMAIL:'',SMTP_APP_PASSWORD:'',RESEND_API_KEY:'',EMAIL_FROM:'',EXERCISE_SMTP_EMAIL:'',EXERCISE_SMTP_APP_PASSWORD:'',PUBLIC_BASE_URL:base});
 const {handler,server,db,mailQueue}=await import('../server.js');
 t.after(()=>{server.emit('close');db.close();});
 async function handle(url,method='GET',body='',headers={}){
  const req=Readable.from(body?[body]:[]);Object.assign(req,{url,method,headers:{host:'localhost:43111',...headers},socket:{remoteAddress:'127.0.0.1'}});
  let status=200,result='';const responseHeaders={};
  await handler(req,{setHeader:(k,v)=>{responseHeaders[k.toLowerCase()]=v;},writeHead:(s,h)=>{status=s;for(const [k,v] of Object.entries(h||{}))responseHeaders[k.toLowerCase()]=v;},end:value=>{result=value||'';}});
  return {status,headers:responseHeaders,body:result};
 }
 const post=async(path,body,cookie)=>{const response=await handle(path,'POST',JSON.stringify(body),cookie?{cookie}:{});return {...response,data:JSON.parse(response.body)};};
 const login=await post('/api/admin/login',{password:process.env.ADMIN_PASSWORD}),admin=login.headers['set-cookie'].split(';')[0];
 const account=await post('/api/admin/enrol',{name:'Ready Browser Player',email:'browser-monitor@test.example',village:'green-valley',role:'mayor',present:true},admin);
 const browser=await chromium.launch({timeout:15000});t.after(()=>browser.close());
 async function context(){const context=await browser.newContext();await context.route('**/*',async route=>{const request=route.request();const url=new URL(request.url());const response=await handle(url.pathname+url.search,request.method(),request.postData()||'',request.headers());await route.fulfill(response);});return context;}
 const playerContext=await context(),hostContext=await context();
 await hostContext.addCookies([{name:'dv_session',value:admin.split('=')[1],url:base}]);
 const player=await playerContext.newPage(),host=await hostContext.newPage(),errors=[];
 for(const page of [player,host]){page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));}
 await player.goto(base);await player.getByRole('button',{name:'Sign in',exact:true}).click();
 await player.locator('#login-form [name=email]').fill('browser-monitor@test.example');await player.locator('#login-form [name=pin]').fill(account.data.pin);await player.locator('#login-form button[type=submit]').click();
 await expect(player.getByRole('button',{name:'I’m ready',exact:true})).toBeVisible();await player.getByRole('button',{name:'I’m ready',exact:true}).click();
 await expect(player.locator('[data-action=set-ready]')).toHaveAttribute('aria-pressed','true');
 await host.goto(base);await host.locator('[data-view=participants]').first().click();
 await expect(host.getByRole('heading',{name:'Participants & readiness'})).toBeVisible();
 await expect(host.getByRole('cell',{name:'Ready',exact:true})).toBeVisible();await expect(host.getByRole('cell',{name:'Online',exact:false}).first()).toBeVisible();
 await post('/api/action',{op:'start'},admin);for(let n=0;n<4;n++)await post('/api/action',{op:'next'},admin);await new Promise(r=>setImmediate(r));
 const message=db.prepare("SELECT body FROM outbox WHERE email='browser-monitor@test.example' AND subject LIKE 'Important:%'").get();const url=message.body.match(/http:\/\/localhost:43111\/phishing\?t=[a-f0-9]{64}/)[0];
 await player.goto(url);await expect(player.getByRole('heading',{name:'Oops, hello! This was phishing.'})).toBeVisible();
 await expect.poll(()=>db.prepare('SELECT open_count FROM exercise_tracking').get().open_count).toBe(1);
 await host.reload();await host.locator('[data-view=participants]').first().click();await expect(host.getByRole('cell',{name:/Opened/})).toBeVisible();
 db.exec('UPDATE exercise_tracking SET last_sent_at=last_sent_at-91000');await host.reload();await host.locator('[data-view=participants]').first().click();
 await host.getByRole('button',{name:'Resend exercise'}).click();await expect(host.getByRole('button',{name:'Queued / sending'})).toBeDisabled();
 await mailQueue.drain();await host.reload();await host.locator('[data-view=participants]').first().click();await expect(host.getByRole('button',{name:'Wait 90 seconds'})).toBeDisabled();
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE subject LIKE 'Important:%'").get().n,2);assert.deepEqual(errors,[]);
});
