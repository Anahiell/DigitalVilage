import {after} from 'node:test';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomInt} from 'node:crypto';

const directories=[];
after(async()=>{for(const directory of directories)await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function rehearsal(t){
 const directory=await mkdtemp(join(tmpdir(),'dv-reliability-'));
 directories.push(directory);
 const port=randomInt(32000,55000),base=`http://127.0.0.1:${port}`;
 const password='reliability-host-password-0123456789',dbPath=join(directory,'world.db');
 // Test-only SMTP failure, intercepted before Nodemailer can contact any provider.
 await writeFile(join(directory,'smtp-register.mjs'),`import {register} from 'node:module';register(new URL('./smtp-hook.mjs',import.meta.url));`);
 await writeFile(join(directory,'smtp-hook.mjs'),`export async function resolve(name,context,next){if(name==='nodemailer')return {url:'test:smtp-failure',shortCircuit:true};return next(name,context);}
export async function load(url,context,next){if(url==='test:smtp-failure')return {format:'module',shortCircuit:true,source:"import {appendFileSync} from 'node:fs';export default {createTransport(){return {async sendMail(message){const mode=process.env.DV_SYNTHETIC_SMTP_MODE;if(mode==='hold')await new Promise(r=>setTimeout(r,60000));if(mode==='success'){appendFileSync(process.env.DV_SYNTHETIC_MAIL_CAPTURE,JSON.stringify(message)+String.fromCharCode(10));return {accepted:[message.to],messageId:message.messageId};}await new Promise(r=>setTimeout(r,mode==='transient'?20:1000));throw Object.assign(Error('Synthetic SMTP rejection'),mode==='transient'?{code:'ECONNECTION'}:{});}}}}"};return next(url,context);}`);
 let child,stderr='';
 const env={...process.env,HOST:'127.0.0.1',PORT:String(port),DB_PATH:dbPath,ADMIN_PASSWORD:password,PIN_PEPPER:'reliability-pepper-01234567890123456789',DEV_EMAIL_OUTBOX:'1',SMTP_EMAIL:'',SMTP_APP_PASSWORD:'',RESEND_API_KEY:'',EMAIL_FROM:'',EXERCISE_SMTP_EMAIL:'',EXERCISE_SMTP_APP_PASSWORD:'',PUBLIC_BASE_URL:base,NODE_ENV:'development'};
 async function stop(){if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}}
 async function start(overrides={},failMail=false){
  stderr='';child=spawn(process.execPath,[...(failMail?['--import',pathToFileURL(join(directory,'smtp-register.mjs')).href]:[]),'server.js'],{cwd:process.cwd(),env:{...env,...overrides},stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',chunk=>stderr+=chunk);
  for(let i=0;i<100;i++){
   if(child.exitCode!==null)throw Error(stderr);
   try{if((await fetch(base+'/healthz')).ok)return;}catch{}
   await sleep(40);
  }
  throw Error('Server did not start: '+stderr);
 }
 async function request(path,body,cookie){
  const res=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=res.headers.get('content-type')?.includes('application/json')?await res.json():await res.text();
  return {status:res.status,data,headers:res.headers,cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 t.after(async()=>{await stop();});
 await start();
 return {request,stop,start,dbPath,password,base};
}
