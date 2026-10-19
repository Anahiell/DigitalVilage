import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Real handler + isolated on-disk SQLite; no listener, network provider or production data.
export async function handlerFixture(t,{fakeClock=false}={}){
 const directory=await mkdtemp(join(tmpdir(),'dv-handler-')),dbPath=join(directory,'session.db');
 const base='http://localhost:43111',password='handler-host-password-0123456789',secret='handler-pepper-01234567890123456789';
 let clock=Date.now(),app;
 if(fakeClock)t.mock.method(Date,'now',()=>clock);
 Object.assign(process.env,{NODE_ENV:'test',DB_PATH:dbPath,ADMIN_PASSWORD:password,PIN_PEPPER:secret,DEV_EMAIL_OUTBOX:'1',SMTP_EMAIL:'',SMTP_APP_PASSWORD:'',RESEND_API_KEY:'',EMAIL_FROM:'',EXERCISE_SMTP_EMAIL:'',EXERCISE_SMTP_APP_PASSWORD:'',PUBLIC_BASE_URL:base});
 const open=async()=>{app=await import('../server.js?fixture='+randomUUID());};
 const close=()=>{app.server.emit('close');app.db.close();};
 t.after(async()=>{close();await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 await open();
 async function handle(path,method='GET',body='',headers={}){
  const req=Readable.from(body?[body]:[]);
  Object.assign(req,{url:path,method,headers:{host:new URL(base).host,...headers},socket:{remoteAddress:'127.0.0.1'}});
  let status=200,content='';const responseHeaders={};
  await app.handler(req,{setHeader:(k,v)=>{responseHeaders[k.toLowerCase()]=v;},writeHead:(s,h)=>{status=s;for(const [k,v] of Object.entries(h||{}))responseHeaders[k.toLowerCase()]=v;},end:value=>{content=value||'';}});
  return {status,headers:responseHeaders,body:content};
 }
 async function request(path,body,cookie){
  const result=await handle(path,body===undefined?'GET':'POST',body===undefined?'':JSON.stringify(body),{...(body===undefined?{}:{'content-type':'application/json',origin:base}),...(cookie?{cookie}:{})});
  const content=String(result.body);
  return {...result,data:result.headers['content-type']?.includes('application/json')?JSON.parse(content):content,cookie:result.headers['set-cookie']?.split(';')[0]};
 }
 const admin=(await request('/api/admin/login',{password})).cookie;
 return {base,password,secret,admin,request,handle,dbPath,get db(){return app.db;},get mailQueue(){return app.mailQueue;},
  state:async(cookie=admin)=>(await request('/api/state',undefined,cookie)).data,
  action:(op,body={},cookie=admin)=>request('/api/action',{op,...body},cookie),
  tick(ms){if(!fakeClock)throw Error('Fake clock required');clock+=ms;app.advanceWorld();},
  async restart(){await app.mailQueue.drain();close();await open();}
 };
}
